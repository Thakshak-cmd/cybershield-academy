import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createShareGate, readCookie } from "../src/share-gate.js";

/**
 * The password in front of a shared preview. It is the only thing between a
 * forwarded link and the platform, so its behaviour is pinned down here.
 */
async function gated(options = {}) {
  let clock = 1_000_000;
  const app = express();
  app.use("/__share", express.urlencoded({ extended: false }));
  app.use(createShareGate({ password: "correct-horse", now: () => clock, ...options }).middleware);
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.get("/api/secret", (req, res) => res.json({ secret: true }));
  app.get(/.*/, (req, res) => res.send("the app"));
  const srv = app.listen(0);
  await new Promise(r => srv.once("listening", r));
  const base = `http://localhost:${/** @type {import("node:net").AddressInfo} */ (srv.address()).port}`;
  const login = (password, headers = {}) => fetch(base + "/__share", {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams({ password })
  });
  return { base, login, close: () => srv.close(), advance: ms => { clock += ms; } };
}

/** @returns {string} */
const cookieFrom = res => readCookie(res.headers.get("set-cookie")?.split(";")[0], "cs_share") ?? "";
/** @param {Response} res @param {string} name */
const header = (res, name) => res.headers.get(name) ?? "";

describe("the share gate", () => {
  test("turns away anyone without the password, page or API", async () => {
    const { base, close } = await gated();
    const page = await fetch(base + "/", { redirect: "manual" });
    const api = await fetch(base + "/api/secret");
    close();
    assert.equal(page.status, 303);
    assert.equal(page.headers.get("location"), "/__share");
    assert.equal(api.status, 401);
  });

  test("leaves the health check open, and nothing else", async () => {
    const { base, close } = await gated();
    const res = await fetch(base + "/api/health");
    close();
    assert.equal(res.status, 200);
  });

  test("a wrong password is refused", async () => {
    const { login, close } = await gated();
    const res = await login("wrong-horse");
    close();
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("set-cookie"), null);
  });

  test("the right password lets the browser in", async () => {
    const { base, login, close } = await gated();
    const res = await login("correct-horse");
    const cookie = cookieFrom(res);
    const page = await fetch(base + "/", { headers: { cookie: `cs_share=${cookie}` } });
    const api = await fetch(base + "/api/secret", { headers: { cookie: `cs_share=${cookie}` } });
    close();
    assert.equal(res.status, 303);
    assert.match(header(res, "set-cookie"), /HttpOnly/i);
    assert.equal(await page.text(), "the app");
    assert.equal(api.status, 200);
  });

  test("the cookie is Secure when the visitor came over HTTPS", async () => {
    const { login, close } = await gated();
    const res = await login("correct-horse", { "x-forwarded-proto": "https" });
    close();
    assert.match(header(res, "set-cookie"), /Secure/i);
  });

  test("a forged or altered cookie is refused", async () => {
    const { base, login, close } = await gated();
    const real = cookieFrom(await login("correct-horse"));
    const [expiry] = real.split(".");
    const forged = `${Number(expiry) + 1e9}.${real.split(".")[1]}`;
    const res = await fetch(base + "/api/secret", { headers: { cookie: `cs_share=${forged}` } });
    close();
    assert.equal(res.status, 401);
  });

  test("a session expires", async () => {
    const { base, login, close, advance } = await gated();
    const cookie = cookieFrom(await login("correct-horse"));
    advance(13 * 60 * 60 * 1000);
    const res = await fetch(base + "/api/secret", { headers: { cookie: `cs_share=${cookie}` } });
    close();
    assert.equal(res.status, 401);
  });

  test("guessing is rate-limited per visitor", async () => {
    const { login, close } = await gated({ maxAttempts: 3 });
    const who = { "cf-connecting-ip": "203.0.113.9" };
    for (let i = 0; i < 3; i++) assert.equal((await login("nope", who)).status, 401);
    const blocked = await login("correct-horse", who);
    const someoneElse = await login("correct-horse", { "cf-connecting-ip": "203.0.113.10" });
    close();
    assert.equal(blocked.status, 429, "even the right password waits out the lockout");
    assert.equal(someoneElse.status, 303);
  });

  test("tells search engines to stay away and keeps the link out of Referer headers", async () => {
    const { base, close } = await gated();
    const res = await fetch(base + "/__share");
    close();
    assert.match(header(res, "x-robots-tag"), /noindex/);
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  });

  test("refuses a weak password at start-up", () => {
    assert.throws(() => createShareGate({ password: "short" }), /at least 8/);
  });
});
