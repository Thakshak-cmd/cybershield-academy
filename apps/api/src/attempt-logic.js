// @ts-check
import { createHash } from "node:crypto";
import { validate, validateReview, validateSpot, validateStages } from "@cybershield/validator";
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
 * @property {Record<string, any>[]} [stages]
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
 * @param {string | number[] | { decision: string, reason?: string } | Record<string, string>} submission
 *   a patch, the lines chosen for a spot item, a review decision, or one patch
 *   per capstone stage
 * @param {AttemptContext} context
 */
export function resolveAttempt(challenge, submission, context) {
  const {
    subjectId, sessionId, isStudyParticipant = false,
    priorAttempts = 0, hintsUsed = 0, durationMs = 0,
    alreadySolved = false, runningXp = 0,
    occurredAt = new Date()
  } = context;

  // Four kinds of answer, one verdict shape, so nothing downstream -- XP, BKT,
  // telemetry, the interface -- needs to know which kind of challenge this was.
  const isSpot = challenge.format === "spot";
  const isReview = challenge.format === "review";
  const isBoss = Array.isArray(challenge.stages) && challenge.stages.length > 0;
  const stages = isBoss
    ? validateStages(/** @type {any} */ (challenge), /** @type {any} */ (submission))
    : null;
  const verdict = stages
    ? combineStages(stages)
    : isSpot
      ? validateSpot(/** @type {any} */ (challenge), /** @type {number[]} */ (submission))
      : isReview
        ? validateReview(/** @type {any} */ (challenge), /** @type {any} */ (submission))
        : validate(challenge, /** @type {string} */ (submission));
  const source = typeof submission === "string" ? submission : JSON.stringify(submission);
  const attemptNo = priorAttempts + 1;
  // The capstone mixes all three skills in one submission, so its outcome is not
  // evidence about any one of them. Letting it into BKT would credit or blame a
  // skill for a stage the learner may not even have attempted.
  const bkt = !isBoss && isBktObservation({ attemptNo, hintsUsed });
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
      countsForBkt: bkt
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
    bktObservation: bkt ? { skill: challenge.skill, correct: passed } : null,
    stages
  };
}

/**
 * One verdict for a multi-stage encounter, in the same shape as every other.
 *
 * Failed rules keep their stage as a prefix so the analysis can ask which
 * technique a learner failed to transfer, not only whether the capstone fell.
 *
 * @param {ReturnType<typeof validateStages>} outcome
 */
export function combineStages(outcome) {
  /** @param {"security"|"functional"} kind */
  const suite = kind => ({
    passed: outcome.stages.reduce((n, st) => n + st[kind].passed, 0),
    total: outcome.stages.reduce((n, st) => n + st[kind].total, 0),
    results: outcome.stages.flatMap(st => st[kind].results)
  });
  const broken = outcome.stages.find(st => st.parseError);
  return {
    passed: outcome.passed,
    parseError: broken?.parseError
      ? { ...broken.parseError, message: `${broken.stageId}: ${broken.parseError.message}` }
      : null,
    security: suite("security"),
    functional: suite("functional"),
    failedRules: outcome.stages.flatMap(st => st.failedRules.map(r => `${st.stageId}:${r}`))
  };
}
