import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";

/**
 * Hints, recorded.
 *
 * These exist because hints were once shown by the browser and never reported,
 * so every hint-assisted solve reached the log as unaided. The knowledge-tracing
 * model then counted being told the answer as evidence of mastery. Each test here
 * pins one consequence of getting that right, against a real database.
 */

let mongod, models, server, base, token;

const GOOD = "app.get('/api/search', async (req, res) => {\n  const { term } = req.query;\n" +
  "  const sql = 'SELECT id, name, price FROM products WHERE name LIKE ?';\n" +
  "  const rows = await db.query(sql, [`%${term}%`]);\n  res.json(rows);\n});";

before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("cybershield_hints");
  process.env.JWT_SECRET = "test-secret-not-a-real-key";
  const db = await import("../src/db.js");
  await db.connect();
  models = await import("../src/models/index.js");
  await models.Event.syncIndexes();
  const { seed } = await import("../src/seed.js");
  await seed();
  const { createApp } = await import("../src/app.js");
  server = createApp().listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://localhost:${/** @type {any} */ (server.address()).port}`;
});

after(async () => {
  server.close();
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([models.Event.deleteMany({}), models.Counter.deleteMany({}), models.Progress.deleteMany({})]);
  token = jwt.sign({ sub: "subj_h", sid: "sess_h", study: true }, process.env.JWT_SECRET);
});

const post = (path, body = {}) => fetch(base + path, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify(body)
}).then(r => r.json());

describe("hints", () => {
  test("come from the challenge being attempted, one at a time", async () => {
    const first = await post("/api/challenges/sec-101/hint");
    assert.equal(first.hints.length, 1);
    assert.match(first.hints[0], /quote/i);          // sec-101's own first hint
    const second = await post("/api/challenges/sec-101/hint");
    assert.equal(second.hints.length, 2);
    assert.equal(second.remaining, 1);
  });

  test("each one leaves an event", async () => {
    await post("/api/challenges/sec-101/hint");
    await post("/api/challenges/sec-101/hint");
    const events = await models.Event.find({ type: "hint.requested" }).sort({ seq: 1 }).lean();
    assert.deepEqual(events.map(e => e.payload.hintLevel), [1, 2]);
  });

  test("a hint-assisted solve is not evidence of mastery", async () => {
    // The bug this file exists for.
    await post("/api/challenges/sec-101/hint");
    const verdict = await post("/api/challenges/sec-101/attempt", { source: GOOD });
    assert.equal(verdict.passed, true);
    assert.equal(verdict.countedForMastery, false);

    const attempted = await models.Event.findOne({ type: "challenge.attempted" }).lean();
    assert.equal(attempted.payload.countsForBkt, false);
  });

  test("a hint-assisted solve pays the hinted rate", async () => {
    await post("/api/challenges/sec-101/hint");
    const verdict = await post("/api/challenges/sec-101/attempt", { source: GOOD });
    assert.equal(verdict.xpAwarded, 40);    // sec-101: firstAttempt 80, withHints 40
  });

  test("an unaided solve is still evidence", async () => {
    const verdict = await post("/api/challenges/sec-101/attempt", { source: GOOD });
    assert.equal(verdict.countedForMastery, true);
    assert.equal(verdict.xpAwarded, 80);
  });

  test("hints for one challenge do not taint another", async () => {
    await post("/api/challenges/sec-201/hint");
    const verdict = await post("/api/challenges/sec-101/attempt", { source: GOOD });
    assert.equal(verdict.countedForMastery, true);
  });

  test("running out of hints is an answer, not an error", async () => {
    for (let i = 0; i < 5; i++) await post("/api/challenges/sec-101/hint");
    const events = await models.Event.countDocuments({ type: "hint.requested" });
    assert.equal(events, 3, "only as many hint events as there are hints");
  });

  test("hints already taken come back on start, so a reload keeps them", async () => {
    await post("/api/challenges/sec-101/hint");
    const started = await post("/api/challenges/sec-101/start");
    assert.equal(started.hints.length, 1);
  });

  test("the answer-bearing hint list is never in the challenge itself", async () => {
    const started = await post("/api/challenges/sec-101/start");
    assert.ok(!("hints" in started.challenge));
    assert.equal(started.hints.length, 0);
  });
});
