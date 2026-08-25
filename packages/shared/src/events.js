// @ts-check

/**
 * Telemetry event contract. See docs/telemetry-model.md for the reasoning.
 *
 * This is the single definition of the schema version. It is stamped on every
 * event, so a second copy of the constant elsewhere would eventually drift and
 * leave the study data claiming two different shapes for the same run.
 */
export const SCHEMA_VERSION = 1;

export const EVENT_TYPES = /** @type {const} */ ([
  "challenge.started",
  "challenge.attempted",
  "challenge.completed",
  "challenge.abandoned",
  "hint.requested",
  "xp.awarded",
  "badge.earned",
  "mastery.updated",
  "recommendation.served",
  "session.started",
  "session.ended"
]);

/** @typedef {(typeof EVENT_TYPES)[number]} TelemetryEventType */

/**
 * Fields present on every telemetry event.
 *
 * `subjectId` is an opaque pseudonym. The mapping to a real participant is held
 * outside this database, in the researcher's custody, per the approved ethics
 * protocol -- the application cannot re-identify anyone.
 *
 * @typedef {object} EventBase
 * @property {number} schemaVersion
 * @property {string} subjectId
 * @property {string} sessionId
 * @property {number} seq
 *   Per-subject monotonic counter. BKT is sequential, and timestamps are not
 *   reliable for ordering: clocks skew and millisecond values collide.
 * @property {Date|string} occurredAt
 * @property {boolean} isStudyParticipant
 *   False for ordinary platform users, whose events are operational only and are
 *   excluded from research data.
 */

/**
 * @typedef {object} ChallengeAttemptedPayload
 * @property {string} challengeId
 * @property {import("./skills.js").TopLevelSkill} skill
 * @property {import("./skills.js").SubSkill} [subSkill]
 * @property {number} attemptNo
 * @property {boolean} correct
 * @property {import("./skills.js").Validator} validator
 * @property {string[]} failedRules
 *   Rule ids only. Structured, so no raw learner code is ever stored.
 * @property {string} submissionHash
 *   Detects resubmits without retaining the code itself.
 * @property {number} durationMs
 * @property {boolean} countsForBkt
 */

/**
 * @typedef {object} ChallengeCompletedPayload
 * @property {string} challengeId
 * @property {import("./skills.js").TopLevelSkill} skill
 * @property {number} totalAttempts
 * @property {number} hintsUsed
 * @property {number} totalDurationMs
 * @property {number} xpAwarded
 */

/**
 * @typedef {object} XpAwardedPayload
 * @property {number} amount
 * @property {"completion"|"first-attempt-bonus"|"streak"} reason
 *   Deliberately no speed-based reason: time-on-task is an engagement metric, so
 *   paying XP for elapsed time would confound it. See deviations D5.
 * @property {number} runningTotal
 */

/**
 * @typedef {object} MasteryUpdatedPayload
 * @property {import("./skills.js").TopLevelSkill} skill
 * @property {number} pMasteryBefore
 * @property {number} pMasteryAfter
 * @property {boolean|null} triggeredByCorrect
 */

/**
 * @typedef {object} RecommendationServedPayload
 * @property {string} challengeId
 * @property {import("./skills.js").TopLevelSkill} skill
 * @property {number} pMastery
 * @property {"bkt-adaptive"|"linear-fallback"} policy
 * @property {boolean|null} wasFollowed
 *   Whether the learner actually took the recommendation. Without this there is no
 *   way to show adaptive sequencing changed behaviour -- only that predictions were
 *   accurate. Backfilled when the next challenge.started arrives.
 */

/**
 * An event that has been written to the log, and therefore has its position in the
 * per-subject sequence.
 * @typedef {EventBase & { type: TelemetryEventType, payload: Record<string, any> }} TelemetryEvent
 */

/**
 * An event that has been constructed but not yet appended.
 *
 * `seq` is deliberately absent: it is allocated by the append, not by the code that
 * builds the event, because ordering is a property of the log rather than of the
 * thing being logged. Keeping the two shapes distinct means a draft can never be
 * mistaken for a written record, or read as though its position were meaningful.
 *
 * @typedef {Omit<EventBase, "seq"> & { type: TelemetryEventType, payload: Record<string, any> }} DraftEvent
 */

/**
 * BKT trains on unaided first attempts only.
 *
 * Later attempts and hint-assisted successes are still recorded for engagement
 * analysis, but they are not evidence about latent skill: a learner who was told
 * the answer has not demonstrated it. This exclusion must be stated in the
 * Methodology chapter, since it is a modelling choice a marker can question.
 *
 * @param {{ attemptNo: number, hintsUsed: number }} attempt
 * @returns {boolean}
 */
export function countsForBkt(attempt) {
  return attempt.attemptNo === 1 && attempt.hintsUsed === 0;
}

/**
 * Select the BKT training observations from a raw event log.
 * @param {TelemetryEvent[]} events
 * @returns {TelemetryEvent[]}
 */
export function bktObservations(events) {
  return events.filter(e => e.type === "challenge.attempted" && e.payload.countsForBkt === true);
}
