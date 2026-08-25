import { createHash } from "node:crypto";
import { validate } from "@cybershield/validator";

export const SCHEMA_VERSION = 1;

/**
 * Everything an attempt decides, as a pure function.
 *
 * The database is deliberately absent here: given the challenge, the submission and
 * what already happened, this returns the verdict, the events to append, and the
 * changes to apply. That keeps the interesting behaviour -- scoring, event shape,
 * XP rules -- unit-testable without standing up Mongo, and keeps the route thin.
 */

/**
 * XP for a successful attempt.
 *
 * There is deliberately no speed bonus. The study uses average time-on-task as an
 * engagement metric, so rewarding elapsed time would make that metric measure
 * bonus-farming instead. Efficiency is defined as fewer attempts, which also matches
 * the first-attempt-correctness signal BKT trains on. See docs/deviations D5.
 */
export function xpFor(challenge, { attemptNo, hintsUsed, passed }) {
  if (!passed) return 0;
  const table = challenge.xp || {};
  if (hintsUsed > 0) return table.withHints ?? 60;
  if (attemptNo === 1) return table.firstAttempt ?? 120;
  return table.retry ?? 40;
}

/** Stable fingerprint of a submission, so resubmits are detectable without keeping the code. */
export function fingerprint(source) {
  return createHash("sha256").update(source, "utf8").digest("hex").slice(0, 16);
}

/**
 * BKT trains on unaided first attempts only. Later attempts and hint-assisted
 * successes are still recorded for engagement analysis, but they are not evidence
 * about latent skill -- a learner who was told the answer has not demonstrated it.
 * This exclusion has to be stated in the Methodology chapter.
 */
export function isBktObservation({ attemptNo, hintsUsed }) {
  return attemptNo === 1 && hintsUsed === 0;
}

/**
 * @param {object} challenge   challenge definition
 * @param {string} source      submitted patch
 * @param {object} context     { subjectId, sessionId, isStudyParticipant,
 *                               priorAttempts, hintsUsed, durationMs,
 *                               alreadySolved, runningXp, occurredAt }
 */
export function resolveAttempt(challenge, source, context) {
  const {
    subjectId, sessionId, isStudyParticipant = false,
    priorAttempts = 0, hintsUsed = 0, durationMs = 0,
    alreadySolved = false, runningXp = 0,
    occurredAt = new Date()
  } = context;

  const verdict = validate(challenge, source);
  const attemptNo = priorAttempts + 1;
  const passed = verdict.passed;

  // Re-solving something already cleared earns nothing. Without this, a learner can
  // farm a solved challenge indefinitely and the leaderboard becomes meaningless.
  const xpAwarded = alreadySolved ? 0 : xpFor(challenge, { attemptNo, hintsUsed, passed });

  const base = {
    schemaVersion: SCHEMA_VERSION,
    subjectId,
    sessionId,
    occurredAt,
    isStudyParticipant
  };

  const events = [{
    ...base,
    type: "challenge.attempted",
    payload: {
      challengeId: challenge.id,
      skill: challenge.skill,
      subSkill: challenge.subSkill,
      attemptNo,
      correct: passed,
      validator: challenge.validator,
      // Rule ids only -- never the learner's source. docs/telemetry-model.md.
      failedRules: verdict.failedRules,
      submissionHash: fingerprint(source),
      durationMs,
      countsForBkt: isBktObservation({ attemptNo, hintsUsed })
    }
  }];

  if (passed && !alreadySolved) {
    events.push({
      ...base,
      type: "challenge.completed",
      payload: {
        challengeId: challenge.id,
        skill: challenge.skill,
        totalAttempts: attemptNo,
        hintsUsed,
        totalDurationMs: durationMs,
        xpAwarded
      }
    });

    if (xpAwarded > 0) {
      events.push({
        ...base,
        type: "xp.awarded",
        payload: {
          amount: xpAwarded,
          reason: hintsUsed > 0 ? "completion" : attemptNo === 1 ? "first-attempt-bonus" : "completion",
          runningTotal: runningXp + xpAwarded
        }
      });
    }
  }

  return {
    verdict,
    events,
    xpAwarded,
    newlySolved: passed && !alreadySolved,
    bktObservation: isBktObservation({ attemptNo, hintsUsed })
      ? { skill: challenge.skill, correct: passed }
      : null
  };
}
