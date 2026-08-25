import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

/**
 * Auth routes against a real MongoDB.
 *
 * These check the properties an attacker would probe, not the happy path: whether
 * responses distinguish a wrong password from an unknown account, whether repeated
 * guessing is bounded, and whether anything sensitive comes back in a response
 * body. On a platform about secure coding, getting this wrong would undercut the
 * whole artefact.
 */

let mongod, models, server, base;

const GOOD_PASSWORD = "correct horse battery staple";

before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("cybershield_auth_test");
  process.env.JWT_SECRET = "test-secret-not-a-real-key";
  process.env.STUDY_ENROLMENT_CODE = "AURORA-2026";

  const db = await import("../src/db.js");
  await db.connect();
  models = await import("../src/models/index.js");
  await models.User.syncIndexes();

  const { createApp } = await import("../src/app.js");
  server = createApp().listen(0);
  await new Promise(r => server.once("listening", r));
  const addr = /** @type {import("node:net").AddressInfo} */ (server.address());
  base = `http://localhost:${addr.port}`;
});

after(async () => {
  server.close();
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([models.User.deleteMany({}), models.Event.deleteMany({}), models.Counter.deleteMany({})]);
});

const post = (path, body, headers = {}) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });

const register = (handle, password = GOOD_PASSWORD, studyCode) =>
  post("/api/auth/register", { handle, password, studyCode });

describe("registration", () => {
  test("creates an account and returns a token", async () => {
    const res = await register("defender");
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.token);
    assert.equal(body.handle, "defender");
    assert.equal(body.isStudyParticipant, false);
  });

  test("stores a hash, never the password", async () => {
    await register("defender");
    const user = await models.User.findOne({ handle: "defender" }).lean();
    assert.ok(!JSON.stringify(user).includes(GOOD_PASSWORD));
    assert.match(user.passwordHash, /^scrypt\$1\$/);
  });

  test("the response never contains the hash", async () => {
    const body = await (await register("defender")).text();
    assert.ok(!body.includes("passwordHash"));
    assert.ok(!body.includes("scrypt$"));
  });

  test("the subject id is unrelated to the handle", async () => {
    await register("defender");
    const user = await models.User.findOne({ handle: "defender" }).lean();
    assert.ok(!user.subjectId.includes("defender"));
    assert.match(user.subjectId, /^subj_[0-9a-f]{24}$/);
  });

  test("a duplicate handle is refused", async () => {
    await register("defender");
    const res = await register("defender");
    assert.equal(res.status, 409);
  });

  test("handles differing only in case collide", async () => {
    await register("defender");
    assert.equal((await register("DEFENDER")).status, 409);
  });

  test("rejects a weak password before doing any work", async () => {
    const res = await register("defender", "short");
    assert.equal(res.status, 400);
    assert.equal(await models.User.countDocuments({}), 0);
  });

  test("rejects an email as a handle, and says why", async () => {
    const res = await register("someone@example.com");
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /email/i);
  });

  test("emits session.started", async () => {
    await register("defender");
    const user = await models.User.findOne({ handle: "defender" }).lean();
    const events = await models.Event.find({ subjectId: user.subjectId }).lean();
    assert.deepEqual(events.map(e => e.type), ["session.started"]);
  });
});

describe("study enrolment", () => {
  test("the right code enrols a participant", async () => {
    const body = await (await register("participant", GOOD_PASSWORD, "AURORA-2026")).json();
    assert.equal(body.isStudyParticipant, true);
  });

  test("a wrong or absent code does not", async () => {
    // Otherwise a stranger could mark themselves as study data and contaminate
    // the results of the one study that gets to run.
    const guessed = await (await register("guesser", GOOD_PASSWORD, "guess")).json();
    const absent = await (await register("nocode", GOOD_PASSWORD)).json();
    assert.equal(guessed.isStudyParticipant, false);
    assert.equal(absent.isStudyParticipant, false);
  });

  test("the flag reaches the token", async () => {
    const { token } = await (await register("participant", GOOD_PASSWORD, "AURORA-2026")).json();
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    assert.equal(claims.study, true);
    assert.ok(!("handle" in claims), "the handle must not travel in the token");
  });
});

describe("login", () => {
  test("succeeds with the right password", async () => {
    await register("defender");
    const res = await post("/api/auth/login", { handle: "defender", password: GOOD_PASSWORD });
    assert.equal(res.status, 200);
    assert.ok((await res.json()).token);
  });

  test("gives an identical response for a wrong password and an unknown handle", async () => {
    // Any difference here is a user-enumeration oracle: an attacker learns which
    // handles exist without guessing a single password.
    await register("defender");
    const wrong = await post("/api/auth/login", { handle: "defender", password: "wrong password here" });
    const unknown = await post("/api/auth/login", { handle: "nobodyhome", password: "wrong password here" });

    assert.equal(wrong.status, unknown.status);
    assert.deepEqual(await wrong.json(), await unknown.json());
  });

  test("takes comparable time for a known and an unknown handle", async () => {
    await register("defender");
    const time = async handle => {
      const t = Date.now();
      await post("/api/auth/login", { handle, password: "wrong password here" });
      return Date.now() - t;
    };
    // Warm the code paths so the first-call cost does not skew the comparison.
    await time("defender"); await time("nobodyhome");

    const known = await time("defender");
    const unknown = await time("nobodyhome");
    const ratio = Math.max(known, unknown) / Math.max(1, Math.min(known, unknown));

    // Returning early on an unknown handle would make this ratio enormous, since
    // the known path spends ~270ms in scrypt and the unknown path would spend none.
    assert.ok(ratio < 2.5, `timing differed too much: known ${known}ms vs unknown ${unknown}ms`);
  });

  test("a malformed handle is refused like any bad credential", async () => {
    const res = await post("/api/auth/login", { handle: "!!!", password: GOOD_PASSWORD });
    assert.equal(res.status, 401);
  });

  test("emits session.started with a fresh session id each time", async () => {
    await register("defender");
    await post("/api/auth/login", { handle: "defender", password: GOOD_PASSWORD });
    const user = await models.User.findOne({ handle: "defender" }).lean();
    const events = await models.Event.find({ subjectId: user.subjectId }).sort({ seq: 1 }).lean();
    assert.equal(events.length, 2);
    assert.notEqual(events[0].sessionId, events[1].sessionId);
  });
});

describe("brute-force protection", () => {
  test("locks the account after repeated failures", async () => {
    await register("defender");
    let status = 401;
    for (let i = 0; i < 9 && status === 401; i++) {
      status = (await post("/api/auth/login", { handle: "defender", password: "wrong password here" })).status;
    }
    assert.equal(status, 429, "the account should lock rather than allowing unlimited guesses");
  });

  test("a locked account rejects even the correct password", async () => {
    await register("defender");
    for (let i = 0; i < 8; i++) {
      await post("/api/auth/login", { handle: "defender", password: "wrong password here" });
    }
    const res = await post("/api/auth/login", { handle: "defender", password: GOOD_PASSWORD });
    assert.equal(res.status, 429);
  });

  test("a successful login clears the failure count", async () => {
    await register("defender");
    for (let i = 0; i < 3; i++) {
      await post("/api/auth/login", { handle: "defender", password: "wrong password here" });
    }
    await post("/api/auth/login", { handle: "defender", password: GOOD_PASSWORD });
    const user = await models.User.findOne({ handle: "defender" }).lean();
    assert.equal(user.failedLogins, 0);
  });

  test("the lockout counter lives in the database, not in process memory", async () => {
    // A module-level counter resets whenever a serverless container is recycled,
    // which is constantly - it would protect nothing.
    await register("defender");
    await post("/api/auth/login", { handle: "defender", password: "wrong password here" });
    const user = await models.User.findOne({ handle: "defender" }).lean();
    assert.equal(user.failedLogins, 1);
  });
});

describe("authenticated routes", () => {
  test("a token from registration works immediately", async () => {
    const { token } = await (await register("defender")).json();
    const res = await fetch(base + "/api/auth/me", { headers: { authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
    const me = await res.json();
    assert.equal(me.handle, "defender");
    assert.match(me.subjectId, /^subj_/);
  });

  test("logout records the end of the session", async () => {
    const { token } = await (await register("defender")).json();
    const res = await post("/api/auth/logout", {}, { authorization: `Bearer ${token}` });
    assert.equal(res.status, 200);
    const user = await models.User.findOne({ handle: "defender" }).lean();
    const types = (await models.Event.find({ subjectId: user.subjectId }).sort({ seq: 1 }).lean())
      .map(e => e.type);
    assert.deepEqual(types, ["session.started", "session.ended"]);
  });

  test("register and login stay reachable without a token", async () => {
    assert.notEqual((await register("defender")).status, 401);
    assert.notEqual(
      (await post("/api/auth/login", { handle: "defender", password: GOOD_PASSWORD })).status,
      401
    );
  });

  test("everything else still demands one", async () => {
    assert.equal((await fetch(base + "/api/auth/me")).status, 401);
    assert.equal((await fetch(base + "/api/next")).status, 401);
  });
});
