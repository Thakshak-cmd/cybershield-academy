import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { recentActivity } from "@cybershield/shared";

let seq = 0;
const ev = (type, payload) => ({
  schemaVersion: 1, subjectId: "x", sessionId: "s1", seq: ++seq,
  occurredAt: new Date(Date.UTC(2026, 8, 29, 10, 0, seq)).toISOString(),
  isStudyParticipant: true, type, payload
});

describe("the shift log", () => {
  test("a clearing attempt is one row carrying its XP, newest first", () => {
    seq = 0;
    const rows = recentActivity([
      ev("challenge.started", { challengeId: "a" }),
      ev("challenge.attempted", { challengeId: "a", correct: false }),
      ev("challenge.attempted", { challengeId: "a", correct: true }),
      ev("challenge.completed", { challengeId: "a", xpAwarded: 40 }),
      ev("xp.awarded", { amount: 40 }),
      ev("badge.earned", { badgeId: "first-patch" })
    ]);
    assert.deepEqual(rows.map(r => [r.kind, r.challengeId ?? r.badgeId, r.correct, r.xp]), [
      ["badge", "first-patch", undefined, undefined],
      ["attempt", "a", true, 40],
      ["attempt", "a", false, undefined]
    ]);
  });

  test("keeps only the latest few", () => {
    seq = 0;
    const events = Array.from({ length: 10 }, (_, i) => ev("challenge.attempted", { challengeId: `c${i}`, correct: false }));
    const rows = recentActivity(events, 3);
    assert.deepEqual(rows.map(r => r.challengeId), ["c9", "c8", "c7"]);
  });

  test("a filed lesson is logged, a reread is not", () => {
    seq = 0;
    const rows = recentActivity([
      ev("lesson.completed", { lessonId: "lesson-sqli", reread: false }),
      ev("lesson.completed", { lessonId: "lesson-sqli", reread: true })
    ]);
    assert.deepEqual(rows.map(r => [r.kind, r.lessonId]), [["lesson", "lesson-sqli"]]);
  });

  test("an empty history is an empty log", () => {
    assert.deepEqual(recentActivity([]), []);
  });
});
