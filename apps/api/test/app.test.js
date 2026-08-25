import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "test-secret-not-a-real-key";
// MONGODB_URI is deliberately left unset. Anything that reaches the database in
// these tests is, by definition, doing so before it should.
delete process.env.MONGODB_URI;

const { createApp } = await import("../src/app.js");

let server, base;

before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once("listening", r));
  const addr = /** @type {import("node:net").AddressInfo} */ (server.address());
  base = `http://localhost:${addr.port}`;
});

after(() => server.close());

const post = (path, opts = {}) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
    body: opts.body ?? "{}"
  });

const token = claims =>
  jwt.sign({ sub: "subj_x", sid: "sess_x", study: true, ...claims }, process.env.JWT_SECRET);

describe("middleware ordering", () => {
  test("health answers without a database", async () => {
    // A liveness probe that depends on Mongo cannot tell you the process is up.
    const r = await fetch(base + "/api/health");
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
  });

  test("a request with no token is rejected before any database work", async () => {
    // If auth ran after the connection middleware this would be a 500, and an
    // anonymous caller could make the service open connections on their behalf.
    const r = await post("/api/challenges/sec-104/attempt");
    assert.equal(r.status, 401);
  });

  test("a forged token is rejected", async () => {
    const r = await post("/api/challenges/sec-104/attempt", {
      headers: { authorization: "Bearer garbage" }
    });
    assert.equal(r.status, 401);
  });

  test("a token signed with the wrong key is rejected", async () => {
    const forged = jwt.sign({ sub: "subj_x", sid: "sess_x" }, "not-the-right-secret");
    const r = await post("/api/challenges/sec-104/attempt", {
      headers: { authorization: `Bearer ${forged}` }
    });
    assert.equal(r.status, 401);
  });

  test("a token missing its session claim is rejected", async () => {
    const r = await post("/api/challenges/sec-104/attempt", {
      headers: { authorization: `Bearer ${jwt.sign({ sub: "subj_x" }, process.env.JWT_SECRET)}` }
    });
    assert.equal(r.status, 401);
  });
});

describe("error responses", () => {
  test("internal failures do not leak details to the caller", async () => {
    // With MONGODB_URI unset this reaches the connection middleware and fails.
    const r = await post("/api/challenges/sec-104/attempt", {
      headers: { authorization: `Bearer ${token()}` }
    });
    assert.equal(r.status, 500);
    const body = await r.json();
    assert.equal(body.error, "Something went wrong on our side.");
    assert.ok(!JSON.stringify(body).includes("MONGODB_URI"));
  });
});
