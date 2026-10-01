import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { participantMetrics, bktSequences, describe as summarise } from "../../../scripts/study/metrics.mjs";
import { analyse, readOutcomes } from "../../../scripts/study/analyse.mjs";
import { simulate } from "../../../scripts/study/rehearse.mjs";

const CATALOGUE = [
  { id: "sec-101", skill: "sqli" },
  { id: "spot-101", skill: "sqli", isDrill: true },
  { id: "sec-900", skill: "sqli", isBoss: true }
];

let seq = 0;
const ev = (type, payload = {}, minute = 0) => ({
  schemaVersion: 1, subjectId: "s1", sessionId: "a", seq: ++seq, isStudyParticipant: true,
  occurredAt: new Date(Date.UTC(2026, 10, 16, 10, minute)).toISOString(), type, payload
});

describe("participant measures", () => {
  test("come from the log the way the platform defines them", () => {
    seq = 0;
    const events = [
      ev("session.started", {}, 0),
      ev("recommendation.served", { challengeId: "sec-101" }, 1),
      ev("challenge.started", { challengeId: "sec-101" }, 2),
      ev("challenge.attempted", { challengeId: "sec-101", skill: "sqli", attemptNo: 1, correct: false, countsForBkt: true }, 4),
      ev("hint.requested", { challengeId: "sec-101" }, 5),
      ev("challenge.attempted", { challengeId: "sec-101", skill: "sqli", attemptNo: 2, correct: true, countsForBkt: false }, 6),
      ev("challenge.completed", { challengeId: "sec-101", totalAttempts: 2, hintsUsed: 1, xpAwarded: 60 }, 6),
      ev("xp.awarded", { amount: 60 }, 6),
      ev("lesson.checked", { lessonId: "l", questionId: "q", correct: false }, 7),
      ev("lesson.checked", { lessonId: "l", questionId: "q", correct: true }, 7),
      ev("lesson.completed", { lessonId: "l", durationMs: 240000, reread: false }, 8),
      ev("lesson.completed", { lessonId: "l", durationMs: 60000, reread: true }, 9)
    ];
    const m = participantMetrics(events, CATALOGUE);
    assert.equal(m.activeMinutes, 9);
    assert.equal(m.challengesCompleted, 1);
    assert.equal(m.holesClosed, 1);
    assert.equal(m.firstAttemptCorrectRate, 0, "only the unaided first attempt is evidence");
    assert.equal(m.attemptsPerCompletion, 2);
    assert.equal(m.hintedCompletions, 1);
    assert.equal(m.medianTimeOnTaskSec, 240);
    assert.equal(m.followRate, 1);
    assert.equal(m.timeToFirstActionSec, 240);
    assert.equal(m.lessonsCompleted, 1, "a reread is not a second lesson");
    assert.equal(m.meanLessonMinutes, 4);
    assert.equal(m.lessonCheckFirstTryRate, 0, "the first answer counts, not the retry");
    assert.equal(m.xp, 60);
  });

  test("BKT sequences are per skill, in log order, unaided first attempts only", () => {
    seq = 0;
    const seqs = bktSequences("s1", [
      ev("challenge.attempted", { skill: "xss", correct: true, countsForBkt: true }),
      ev("challenge.attempted", { skill: "sqli", correct: false, countsForBkt: true }),
      ev("challenge.attempted", { skill: "sqli", correct: true, countsForBkt: false }),
      ev("challenge.attempted", { skill: "sqli", correct: true, countsForBkt: true })
    ]);
    assert.deepEqual(seqs.map(s => [s.skill, s.observations]), [["xss", [true]], ["sqli", [false, true]]]);
  });

  test("a summary of nothing is empty, not zero", () => {
    assert.equal(summarise([null, NaN]).mean, null);
  });
});

describe("the analysis", () => {
  test("runs end to end on a rehearsal and is stamped synthetic", async () => {
    const data = simulate(6, 3);
    const { results, report, csv } = await analyse(data, {
      synthetic: true,
      outcomes: [{ pre: 3, post: 6 }, { pre: 4, post: 7 }, { pre: 5, post: 5, sus: 80 }],
      testMax: 10
    });
    assert.match(report, /SYNTHETIC DATA/);
    assert.equal(results.participants, 6);
    assert.ok(results.model.literature_priors.n > 0);
    assert.equal(results.outcomes.knowledge.wilcoxon.n_pairs, 3);
    assert.equal(csv.trim().split("\n").length, 7, "a header and one row per participant");
  });

  test("leaves out withdrawn participants even when an old export still holds them", async () => {
    const data = simulate(4, 5);
    const { results } = await analyse(data, { withdrawn: new Set(["synthetic_02"]) });
    assert.equal(results.participants, 3);
    assert.ok(results.manifest.withdrawnAtAnalysis > 0);
  });

  test("reads outcome scores, including raw SUS answers", () => {
    const dir = mkdtempSync(join(tmpdir(), "outcomes-"));
    const path = join(dir, "outcomes.csv");
    writeFileSync(path, "code,pre,post,sus1,sus2,sus3,sus4,sus5,sus6,sus7,sus8,sus9,sus10\nP01,4,7,5,1,5,1,5,1,5,1,5,1\nP02,5,,3,3,3,3,3,3,3,3,3,3\n");
    const rows = readOutcomes(path);
    assert.deepEqual(rows[0].sus_items, [5, 1, 5, 1, 5, 1, 5, 1, 5, 1]);
    assert.equal(rows[1].post, null);
  });
});
