import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deriveStreaks, timeToFirstAction } from "@cybershield/shared";

let seq = 0;
const at = (type, payload = {}, iso = "2026-09-16T10:00:00Z", sessionId = "s1") => ({
  schemaVersion: 1, subjectId: "x", sessionId, seq: ++seq, occurredAt: iso,
  isStudyParticipant: true, type, payload
});
const solve = (correct, extra = {}) =>
  at("challenge.attempted", { countsForBkt: true, correct, ...extra });

describe("solve streak", () => {
  test("counts consecutive unaided first-attempt solves", () => {
    seq = 0;
    const s = deriveStreaks([solve(true), solve(true), solve(true)]);
    assert.equal(s.solve, 3);
    assert.equal(s.bestSolve, 3);
  });

  test("an unaided failure breaks it", () => {
    seq = 0;
    const s = deriveStreaks([solve(true), solve(true), solve(false), solve(true)]);
    assert.equal(s.solve, 1);
    assert.equal(s.bestSolve, 2);
  });

  test("hint-assisted and retry solves neither extend nor break it", () => {
    // They are not evidence about skill, so they are invisible to the streak --
    // the same rule BKT applies to its training signal.
    seq = 0;
    const s = deriveStreaks([
      solve(true),
      at("challenge.attempted", { countsForBkt: false, correct: false }),
      at("challenge.attempted", { countsForBkt: false, correct: true }),
      solve(true)
    ]);
    assert.equal(s.solve, 2);
  });

  test("an empty log is zero, not an error", () => {
    assert.deepEqual(deriveStreaks([]), { solve: 0, bestSolve: 0, days: 0 });
  });
});

describe("day streak", () => {
  const now = new Date("2026-09-16T18:00:00Z");

  test("counts consecutive active days ending today", () => {
    seq = 0;
    const s = deriveStreaks([
      solve(true, {}, ), // today
      at("challenge.attempted", { countsForBkt: true, correct: true }, "2026-09-15T09:00:00Z"),
      at("challenge.attempted", { countsForBkt: true, correct: false }, "2026-09-14T09:00:00Z")
    ].map((e, i) => i === 0 ? { ...e, occurredAt: "2026-09-16T10:00:00Z" } : e), { now });
    assert.equal(s.days, 3);
  });

  test("a gap breaks it", () => {
    seq = 0;
    const s = deriveStreaks([
      at("challenge.attempted", { countsForBkt: true, correct: true }, "2026-09-16T10:00:00Z"),
      at("challenge.attempted", { countsForBkt: true, correct: true }, "2026-09-13T10:00:00Z")
    ], { now });
    assert.equal(s.days, 1);
  });

  test("not yet active today still holds yesterday's streak", () => {
    // Otherwise every learner's streak reads zero each morning until they act,
    // which is the opposite of what a streak is for.
    seq = 0;
    const s = deriveStreaks([
      at("challenge.attempted", { countsForBkt: true, correct: true }, "2026-09-15T10:00:00Z"),
      at("challenge.attempted", { countsForBkt: true, correct: true }, "2026-09-14T10:00:00Z")
    ], { now });
    assert.equal(s.days, 2);
  });
});

describe("time to first action", () => {
  test("measures sign-in to first attempt per session", () => {
    seq = 0;
    const r = timeToFirstAction([
      at("session.started", {}, "2026-09-16T10:00:00Z", "a"),
      at("challenge.started", {}, "2026-09-16T10:00:30Z", "a"),
      at("challenge.attempted", { correct: true }, "2026-09-16T10:01:45Z", "a"),
      at("challenge.attempted", { correct: true }, "2026-09-16T10:05:00Z", "a"),  // not first
      at("session.started", {}, "2026-09-16T11:00:00Z", "b"),
      at("challenge.attempted", { correct: false }, "2026-09-16T11:00:20Z", "b")
    ]);
    assert.deepEqual(r, [
      { sessionId: "a", ms: 105_000 },
      { sessionId: "b", ms: 20_000 }
    ]);
  });

  test("a session with no attempt contributes nothing", () => {
    // Not infinity, not zero: it simply has no first action to measure.
    seq = 0;
    const r = timeToFirstAction([at("session.started", {}, "2026-09-16T10:00:00Z", "a")]);
    assert.deepEqual(r, []);
  });
});
