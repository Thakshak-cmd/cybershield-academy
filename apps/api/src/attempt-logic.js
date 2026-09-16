// @ts-check
import { createHash } from "node:crypto";
import { validate, validateSpot } from "@cybershield/validator";
import { SCHEMA_VERSION, countsForBkt } from "@cybershield/shared";

export { SCHEMA_VERSION };

/** @typedef {import("@cybershield/shared").DraftEvent} DraftEvent */

/**
 * @typedef {object} ChallengeDef
 * @property {string} id
 * @property {string} [format]
 * @property {number[]} [flawedLines]
 * @property {string} [vulnerable]
 * @property {import("@cybershield/shared").TopLevelSkill} skill
 * @property {import("@cybershield/shared").SubSkill} [subSkill]
 * @property {import("@cybershield/shared").Validator} validator
 * @property {{ firstAttempt?: number, withHints?: number, retry?: number }} [xp]
 */

/**
 * @typedef {object} AttemptContext
 * @property {string} subjectId
 * @property {string} sessionId
 * @property {boolean} [isStudyParticipant]
 * @property {number} [priorAttempts]
 * @property {number} [hintsUsed]
 * @property {number} [durationMs]
 * @property {boolean} [alreadySolved]
 * @property {number} [runningXp]
 * @property {Date} [occurredAt]
 */

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
/**
 * @param {ChallengeDef} challenge
 * @param {{ attemptNo: number, hintsUsed: number, passed: boolean }} attempt
 * @returns {number}
 */
export function xpFor(challenge, { attemptNo, hintsUsed, passed }) {
  if (!passed) return 0;
  const table = challenge.xp || {};
  if (hintsUsed > 0) return table.withHints ?? 60;
  if (attemptNo === 1) return table.firstAttempt ?? 120;
  return table.retry ?? 40;
}

/**
 * Stable fingerprint of a submission, so resubmits are detectable without keeping
 * the code itself.
 * @param {string} source
 * @returns {string}
 */
export function fingerprint(source) {
  return createHash("sha256").update(source, "utf8").digest("hex").slice(0, 16);
}

/**
 * Re-exported so callers have one obvious place to ask the question. The rule
 * itself lives in @cybershield/shared alongside the event contract it constrains.
 */
export const isBktObservation = countsForBkt;

/**
 * @param {ChallengeDef} challenge
 * @param {string | number[]} submission  a patch, or the lines chosen for a spot item
 * @param {AttemptContext} context
 */
export function resolveAttempt(challenge, submission, context) {
  const {
    subjectId, sessionId, isStudyParticipant = false,
    priorAttempts = 0, hintsUsed = 0, durationMs = 0,
    alreadySolved = false, runningXp = 0,
    occurredAt = new Date()
  } = context;

  // A spot item is answered with line numbers, everything else with a patch. Both
  // produce the same verdict shape, so nothing downstream needs to know which.
  const isSpot = challenge.format === "spot";
  const verdict = isSpot
    ? validateSpot(/** @type {any} */ (challenge), /** @type {number[]} */ (submission))
    : validate(challenge, /** @type {string} */ (submission));
  const source = isSpot ? JSON.stringify(submission) : /** @type {string} */ (submission);
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

  /** @type {DraftEvent[]} */
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
