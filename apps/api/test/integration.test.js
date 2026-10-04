import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

/**
 * Integration tests against a real MongoDB.
 *
 * Everything up to this point was exercised with the data layer stubbed out, which
 * verifies decisions but not persistence. The properties that matter here --
 * atomic sequence allocation, the unique (subjectId, seq) index, concurrent
 * writers -- only exist in the database, so a fake cannot show they hold.
 *
 * mongodb-memory-server runs a genuine mongod, so this is the real storage engine
 * rather than an emulation. No Atlas cluster required.
 */

/** @type {MongoMemoryServer} */
let mongod;
let models, telemetry, attemptLogic;

before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("cybershield_test");
  process.env.JWT_SECRET = "test-secret-not-a-real-key";

  const db = await import("../src/db.js");
  await db.connect();

  models = await import("../src/models/index.js");
  telemetry = await import("../src/telemetry.js");
  attemptLogic = await import("../src/attempt-logic.js");

  // Indexes are declared on the schema but only exist once built.
  await Promise.all([
    models.Event.syncIndexes(),
    models.Challenge.syncIndexes(),
    models.Progress.syncIndexes()
  ]);
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    models.Event.deleteMany({}),
    models.Counter.deleteMany({}),
    models.Progress.deleteMany({}),
    models.Challenge.deleteMany({})
  ]);
});

const draft = (type, payload = {}) => ({
  schemaVersion: 1,
  subjectId: "subj_1",
  sessionId: "sess_1",
  occurredAt: new Date(),
  isStudyParticipant: true,
  type,
  payload
});

describe("sequence allocation", () => {
  test("assigns consecutive numbers starting at 1", async () => {
    const written = await telemetry.append("subj_1", [
      draft("session.started"),
      draft("challenge.started", { challengeId: "a" })
    ]);
    assert.deepEqual(written.map(e => e.seq), [1, 2]);
  });

  test("continues across separate appends", async () => {
    await telemetry.append("subj_1", [draft("session.started")]);
    const second = await telemetry.append("subj_1", [draft("challenge.started", { challengeId: "a" })]);
    assert.equal(second[0].seq, 2);
  });

  test("each subject has its own sequence", async () => {
    await telemetry.append("subj_1", [draft("session.started")]);
    const other = await telemetry.append("subj_2", [{ ...draft("session.started"), subjectId: "subj_2" }]);
    assert.equal(other[0].seq, 1);
  });

  test("concurrent appends never collide", async () => {
    // The reason reservation is a single atomic $inc rather than read-then-write.
    // Two serverless invocations for the same learner are not hypothetical.
    const batches = Array.from({ length: 25 }, (_, i) =>
      telemetry.append("subj_1", [draft("challenge.started", { challengeId: `c${i}` })])
    );
    const results = await Promise.all(batches);
    const seqs = results.flat().map(e => e.seq).sort((a, b) => a - b);

    assert.deepEqual(seqs, Array.from({ length: 25 }, (_, i) => i + 1),
      "sequence numbers must be a contiguous run with no gaps or repeats");
  });

  test("the database refuses a duplicate (subjectId, seq)", async () => {
    // The unique index is the last line of defence if reservation is ever bypassed.
    await telemetry.append("subj_1", [draft("session.started")]);
    await assert.rejects(
      () => models.Event.create({ ...draft("session.started"), seq: 1 }),
      /duplicate key/i
    );
  });
});

describe("the event log", () => {
  test("stores and reads back in sequence order", async () => {
    await telemetry.append("subj_1", [
      draft("challenge.started", { challengeId: "a" }),
      draft("challenge.attempted", { challengeId: "a", attemptNo: 1, correct: false, countsForBkt: true }),
      draft("challenge.attempted", { challengeId: "a", attemptNo: 2, correct: true, countsForBkt: false })
    ]);
    const rows = await models.Event.find({ subjectId: "subj_1" }).sort({ seq: 1 }).lean();
    assert.deepEqual(rows.map(r => r.type),
      ["challenge.started", "challenge.attempted", "challenge.attempted"]);
  });

  test("counts prior attempts for a challenge", async () => {
    await telemetry.append("subj_1", [
      draft("challenge.attempted", { challengeId: "a" }),
      draft("challenge.attempted", { challengeId: "a" }),
      draft("challenge.attempted", { challengeId: "b" })
    ]);
    assert.equal(await telemetry.countAttempts("subj_1", "a"), 2);
    assert.equal(await telemetry.countAttempts("subj_1", "b"), 1);
  });

  test("selects only BKT-eligible observations, in order", async () => {
    await telemetry.append("subj_1", [
      draft("challenge.attempted", { skill: "sqli", correct: true, countsForBkt: true }),
      draft("challenge.attempted", { skill: "sqli", correct: false, countsForBkt: false }),
      draft("challenge.attempted", { skill: "xss", correct: false, countsForBkt: true }),
      draft("hint.requested", { challengeId: "a" })
    ]);
    const obs = await telemetry.bktObservationsFor("subj_1");
    assert.deepEqual(obs, [
      { skill: "sqli", correct: true },
      { skill: "xss", correct: false }
    ]);
  });

  test("an empty history is an empty array, not an error", async () => {
    assert.deepEqual(await telemetry.bktObservationsFor("nobody"), []);
  });
});

describe("seeding", () => {
  test("loads the challenge files and is repeatable", async () => {
    const { seed } = await import("../src/seed.js");
    const first = await seed();
    assert.ok(first.includes("sec-101"));
    assert.ok(first.includes("sec-104"));

    // Re-seeding is the normal authoring loop, so it must not duplicate.
    await seed();
    assert.equal(await models.Challenge.countDocuments({ id: "sec-104" }), 1);
  });

  test("the capstone keeps its flag through seeding", async () => {
    // Mongoose drops fields its schema does not declare, silently. Without the
    // flag the model gates the capstone as an SQL-only boss.
    const { seed } = await import("../src/seed.js");
    await seed();
    const cap = await models.Challenge.findOne({ id: "sec-900" }).lean();
    assert.equal(cap.isCapstone, true);
  });

  test("every skill has a challenge a brand-new learner can reach", async () => {
    // A catalogue where the cheapest challenge costs more than the starting prior
    // strands every new user on an empty screen. Caught by the smoke test, not by
    // unit tests, whose fixture trees always had a drill at 0.0.
    const { seed } = await import("../src/seed.js");
    await seed();

    const PRIOR = 0.15;
    const skills = await models.Challenge.distinct("skill");
    for (const skill of skills) {
      const entry = await models.Challenge.findOne({
        skill, masteryRequired: { $lte: PRIOR }, requires: null
      }).lean();
      assert.ok(entry, `skill "${skill}" has no reachable entry challenge`);
    }
  });

  test("the seeded challenge validates a real patch end to end", async () => {
    const { seed } = await import("../src/seed.js");
    await seed();

    const challenge = await models.Challenge.findOne({ id: "sec-104" }).lean();
    const outcome = attemptLogic.resolveAttempt(
      challenge,
      "app.post('/x', async (req,res) => { const {email,password}=req.body;" +
      " const sql='SELECT id, role FROM users WHERE email = ? AND password_hash = ?';" +
      " const [u] = await db.query(sql,[email,sha256(password)]); });",
      { subjectId: "subj_1", sessionId: "sess_1" }
    );

    // Proves the round trip through Mongo preserves everything the validator
    // needs -- rules, meta, xp table -- not just the fields the UI reads.
    assert.equal(outcome.verdict.passed, true);
    assert.equal(outcome.xpAwarded, 120);
  });
});

describe("a full attempt, persisted", () => {
  test("records the attempt and updates the projection", async () => {
    const { seed } = await import("../src/seed.js");
    await seed();
    const challenge = await models.Challenge.findOne({ id: "sec-104" }).lean();

    const good = "const sql='SELECT id, role FROM users WHERE email = ? AND password_hash = ?';" +
                 " const [u] = await db.query(sql,[email,hash]);";

    const outcome = attemptLogic.resolveAttempt(challenge, good, {
      subjectId: "subj_1", sessionId: "sess_1", isStudyParticipant: true
    });
    await telemetry.append("subj_1", outcome.events);
    await models.Progress.findOneAndUpdate(
      { subjectId: "subj_1" },
      { $inc: { xp: outcome.xpAwarded }, $addToSet: { solvedChallenges: challenge.id } },
      { upsert: true }
    );

    const events = await models.Event.find({ subjectId: "subj_1" }).sort({ seq: 1 }).lean();
    assert.deepEqual(events.map(e => e.type),
      ["challenge.attempted", "challenge.completed", "xp.awarded"]);

    const progress = await models.Progress.findOne({ subjectId: "subj_1" }).lean();
    assert.equal(progress.xp, 120);
    assert.deepEqual(progress.solvedChallenges, ["sec-104"]);
  });

  test("no persisted event contains the submitted source", async () => {
    // The privacy boundary asserted in unit tests, now checked against what
    // actually reached disk.
    const { seed } = await import("../src/seed.js");
    await seed();
    const challenge = await models.Challenge.findOne({ id: "sec-104" }).lean();

    const marker = "SECRET_LEARNER_TOKEN_42";
    const outcome = attemptLogic.resolveAttempt(
      challenge,
      `const ${marker}=1; const sql=\`SELECT id FROM users WHERE email='\${email}'\`; await db.query(sql);`,
      { subjectId: "subj_1", sessionId: "sess_1" }
    );
    await telemetry.append("subj_1", outcome.events);

    const raw = JSON.stringify(await models.Event.find({}).lean());
    assert.ok(!raw.includes(marker), "learner code must never reach the database");
  });
});

describe("the capstone, persisted", () => {
  // It used to have its own route that wrote only the attempt: beating it earned
  // nothing, its badge could never be awarded, and every try claimed to be first.
  test("beating it completes it, pays XP and awards Aurora Held", async () => {
    const { seed } = await import("../src/seed.js");
    const { recordAttempt } = await import("../src/record-attempt.js");
    const { BOSS_REFERENCE_PATCHES } = await import("../../../content/reference-patches.js");
    await seed();

    const boss = await models.Challenge.findOne({ id: "sec-900" }).lean();
    const [winning, partial] = BOSS_REFERENCE_PATCHES["sec-900"];
    const auth = { subjectId: "subj_boss", sessionId: "sess_1", isStudyParticipant: true };

    const miss = await recordAttempt({ auth, challenge: boss, submission: partial.sources });
    assert.equal(miss.body.passed, false);
    assert.equal(miss.body.attemptNo, 1);
    assert.deepEqual(miss.body.posture.incidents.map(i => i.challengeId), ["sec-900"],
      "a failed capstone attempt is an incident");
    assert.equal(miss.body.posture.incident, true);

    const win = await recordAttempt({ auth, challenge: boss, submission: winning.sources });
    assert.equal(win.body.passed, true);
    assert.equal(win.body.attemptNo, 2);
    assert.equal(win.body.xpAwarded, boss.xp.retry);
    assert.ok(win.body.newBadges.includes("aurora-held"));
    assert.equal(win.body.posture.capstoneHeld, true);

    const progress = await models.Progress.findOne({ subjectId: "subj_boss" }).lean();
    assert.deepEqual(progress.solvedChallenges, ["sec-900"]);
    assert.equal(progress.xp, boss.xp.retry);

    const attempts = await models.Event.find({ subjectId: "subj_boss", type: "challenge.attempted" }).lean();
    assert.ok(attempts.every(e => e.payload.countsForBkt === false));
  });
});

describe("lessons, persisted", () => {
  test("completion, practice and the check are read back from the log", async () => {
    const e = (type, payload) => ({ ...draft(type, payload), subjectId: "subj_l" });
    await telemetry.append("subj_l", [
      e("lesson.practised", { lessonId: "lesson-sqli", passed: false }),
      e("lesson.practised", { lessonId: "lesson-sqli", passed: true }),
      e("lesson.checked", { lessonId: "lesson-sqli", questionId: "obrien", correct: true }),
      e("lesson.completed", { lessonId: "lesson-sqli", reread: false }),
      e("lesson.practised", { lessonId: "lesson-xss", passed: false })
    ]);
    assert.deepEqual(await telemetry.lessonsCompleted("subj_l"), ["lesson-sqli"]);
    assert.deepEqual(await telemetry.lessonPractice("subj_l", "lesson-sqli"), { attempts: 2, done: true });
    assert.deepEqual(await telemetry.lessonPractice("subj_l", "lesson-xss"), { attempts: 1, done: false });
    assert.deepEqual(await telemetry.lessonPractice("subj_l", "lesson-csrf"), { attempts: 0, done: false });
    // None of it is evidence for the model.
    assert.deepEqual(await telemetry.bktObservationsFor("subj_l"), []);
  });
});
