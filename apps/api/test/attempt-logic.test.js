import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveAttempt, xpFor, fingerprint, isBktObservation } from "../src/attempt-logic.js";

const challenge = JSON.parse(
  readFileSync(new URL("../../../content/challenges/sec-104.json", import.meta.url), "utf8")
);

const GOOD = `
  const sql = 'SELECT id, role FROM users WHERE email = ? AND password_hash = ?';
  const [user] = await db.query(sql, [email, sha256(password)]);`;

const BAD = `
  const safe = email.replace(/'/g, '');
  const sql = \`SELECT id, role FROM users WHERE email = '\${safe}'\`;
  await db.query(sql);`;

const ctx = (over = {}) => ({
  subjectId: "subj_test", sessionId: "sess_1", isStudyParticipant: true, ...over
});

describe("XP rules", () => {
  test("a first-attempt unaided solve earns full XP", () => {
    assert.equal(xpFor(challenge, { attemptNo: 1, hintsUsed: 0, passed: true }), 120);
  });

  test("hints reduce the award regardless of attempt number", () => {
    assert.equal(xpFor(challenge, { attemptNo: 1, hintsUsed: 1, passed: true }), 60);
  });

  test("a later attempt earns the retry rate", () => {
    assert.equal(xpFor(challenge, { attemptNo: 3, hintsUsed: 0, passed: true }), 40);
  });

  test("a failed attempt earns nothing", () => {
    assert.equal(xpFor(challenge, { attemptNo: 1, hintsUsed: 0, passed: false }), 0);
  });

  test("elapsed time never affects the award", () => {
    // Guards deviation D5: time-on-task is an engagement metric, so paying XP for
    // speed would turn that metric into a measure of bonus-farming.
    const slow = xpFor(challenge, { attemptNo: 1, hintsUsed: 0, passed: true, durationMs: 900000 });
    const fast = xpFor(challenge, { attemptNo: 1, hintsUsed: 0, passed: true, durationMs: 900 });
    assert.equal(slow, fast);
  });
});

describe("BKT observation eligibility", () => {
  test("only unaided first attempts count", () => {
    assert.equal(isBktObservation({ attemptNo: 1, hintsUsed: 0 }), true);
    assert.equal(isBktObservation({ attemptNo: 2, hintsUsed: 0 }), false);
    assert.equal(isBktObservation({ attemptNo: 1, hintsUsed: 1 }), false);
  });
});

describe("resolveAttempt", () => {
  test("a passing first attempt emits attempted, completed and xp events", () => {
    const r = resolveAttempt(challenge, GOOD, ctx());
    assert.equal(r.verdict.passed, true);
    assert.deepEqual(r.events.map(e => e.type),
      ["challenge.attempted", "challenge.completed", "xp.awarded"]);
    assert.equal(r.xpAwarded, 120);
    assert.deepEqual(r.bktObservation, { skill: "sqli", correct: true });
  });

  test("a failing attempt emits only the attempt, and still counts for BKT", () => {
    const r = resolveAttempt(challenge, BAD, ctx());
    assert.equal(r.verdict.passed, false);
    assert.deepEqual(r.events.map(e => e.type), ["challenge.attempted"]);
    assert.equal(r.xpAwarded, 0);
    // A wrong first attempt is evidence about skill just as much as a right one.
    assert.deepEqual(r.bktObservation, { skill: "sqli", correct: false });
  });

  test("a hint-assisted solve awards XP but is not evidence of mastery", () => {
    const r = resolveAttempt(challenge, GOOD, ctx({ hintsUsed: 2 }));
    assert.equal(r.xpAwarded, 60);
    assert.equal(r.bktObservation, null);
  });

  test("re-solving a cleared challenge earns nothing", () => {
    const r = resolveAttempt(challenge, GOOD, ctx({ alreadySolved: true, priorAttempts: 4 }));
    assert.equal(r.verdict.passed, true);
    assert.equal(r.xpAwarded, 0);
    assert.equal(r.newlySolved, false);
    // No completed/xp events either -- farming a solved challenge must not
    // inflate the leaderboard or the engagement metrics.
    assert.deepEqual(r.events.map(e => e.type), ["challenge.attempted"]);
  });

  test("running XP total is carried into the xp event", () => {
    const r = resolveAttempt(challenge, GOOD, ctx({ runningXp: 500 }));
    const xp = r.events.find(e => e.type === "xp.awarded");
    assert.equal(xp.payload.runningTotal, 620);
  });

  test("attemptNo follows prior attempts", () => {
    const r = resolveAttempt(challenge, BAD, ctx({ priorAttempts: 2 }));
    assert.equal(r.events[0].payload.attemptNo, 3);
  });

  test("no event carries the learner's source", () => {
    const marker = "SECRET_LEARNER_TOKEN_42";
    const r = resolveAttempt(challenge, `const ${marker} = 1; ${BAD}`, ctx());
    const blob = JSON.stringify(r.events);
    assert.ok(!blob.includes(marker),
      "the event log must never contain submitted code -- docs/telemetry-model.md");
    // The hash is what makes resubmits detectable without retaining the code.
    assert.match(r.events[0].payload.submissionHash, /^[0-9a-f]{16}$/);
  });

  test("identical submissions hash identically, different ones do not", () => {
    assert.equal(fingerprint(GOOD), fingerprint(GOOD));
    assert.notEqual(fingerprint(GOOD), fingerprint(BAD));
  });

  test("every event carries the fields ordering and consent depend on", () => {
    const r = resolveAttempt(challenge, GOOD, ctx());
    for (const e of r.events) {
      assert.equal(e.subjectId, "subj_test");
      assert.equal(e.sessionId, "sess_1");
      assert.equal(e.isStudyParticipant, true);
      assert.equal(e.schemaVersion, 1);
      assert.ok(e.occurredAt instanceof Date);
    }
  });
});
