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
 * @property {string} reason
 *   Human-readable justification, shown in the interface so the learner is not
 *   simply handed a challenge with no explanation.
 *
 * Note there is no `wasFollowed` field. Whether the learner took the
 * recommendation is derived from the log by `deriveFollowed` -- storing it would
 * mean going back and editing an event, which the append-only rule forbids.
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


/**
 * Pair each recommendation with what the learner did next.
 *
 * Derived rather than stored: the log is append-only, so an event cannot be
 * revisited once written. For each `recommendation.served`, the first
 * `challenge.started` after it in sequence order decides the outcome.
 *
 * A recommendation with nothing after it is `followed: null`, not `false`. The
 * learner did not decline it -- the session ended, and treating that as a refusal
 * would bias the follow rate downward by exactly one per session.
 *
 * @param {TelemetryEvent[]} events  any order; sorted by seq internally
 * @returns {{ seq: number, recommended: string, started: string|null, followed: boolean|null }[]}
 */
export function deriveFollowed(events) {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  /** @type {{ seq: number, recommended: string, started: string|null, followed: boolean|null }[]} */
  const out = [];

  for (let i = 0; i < ordered.length; i++) {
    const e = ordered[i];
    if (e.type !== "recommendation.served") continue;

    const next = ordered.slice(i + 1).find(x => x.type === "challenge.started");
    out.push({
      seq: e.seq,
      recommended: e.payload.challengeId,
      started: next ? next.payload.challengeId : null,
      followed: next ? next.payload.challengeId === e.payload.challengeId : null
    });
  }
  return out;
}

/**
 * Share of recommendations the learner acted on.
 *
 * Recommendations with no subsequent start are excluded rather than counted as
 * refusals. Returns NaN when nothing is resolvable, so an empty result cannot be
 * mistaken for a follow rate of zero.
 *
 * @param {TelemetryEvent[]} events
 * @returns {number}
 */
export function followRate(events) {
  const resolved = deriveFollowed(events).filter(r => r.followed !== null);
  if (!resolved.length) return NaN;
  return resolved.filter(r => r.followed).length / resolved.length;
}

/**
 * Streaks, derived from the log.
 *
 * Two kinds. The solve streak is consecutive unaided first-attempt successes,
 * broken by an unaided first-attempt failure -- hint-assisted and retry solves
 * neither extend nor break it, since they are not evidence about skill. The day
 * streak is consecutive calendar days with at least one attempt.
 *
 * Neither is stored. A stored counter is the denormalised state the append-only
 * model exists to avoid, and one that drifted from the log would be a silent lie
 * on the character sheet.
 *
 * @param {TelemetryEvent[]} events
 * @param {{ now?: Date }} [opts]
 * @returns {{ solve: number, bestSolve: number, days: number }}
 */
export function deriveStreaks(events, { now = new Date() } = {}) {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);

  let solve = 0;
  let bestSolve = 0;
  for (const e of ordered) {
    if (e.type !== "challenge.attempted" || !e.payload.countsForBkt) continue;
    if (e.payload.correct) {
      solve++;
      bestSolve = Math.max(bestSolve, solve);
    } else {
      solve = 0;
    }
  }

  // Day streak: walk back from today over the set of active days.
  const days = new Set(
    ordered
      .filter(e => e.type === "challenge.attempted")
      .map(e => dayKey(new Date(e.occurredAt)))
  );
  let dayStreak = 0;
  const cursor = new Date(now);
  // A learner who has not yet acted today still holds yesterday's streak.
  if (!days.has(dayKey(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (days.has(dayKey(cursor))) {
    dayStreak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return { solve, bestSolve, days: dayStreak };
}

/** @param {Date} d */
function dayKey(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Milliseconds from signing in to the first thing the learner actually did.
 *
 * The metric behind "first line of code in two minutes". Measured per session
 * from `session.started` to the first `challenge.attempted`; a session with no
 * attempt contributes nothing rather than an infinite value.
 *
 * @param {TelemetryEvent[]} events
 * @returns {{ sessionId: string, ms: number }[]}
 */
export function timeToFirstAction(events) {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  /** @type {Map<string, Date>} */
  const started = new Map();
  /** @type {{ sessionId: string, ms: number }[]} */
  const out = [];
  const seen = new Set();

  for (const e of ordered) {
    if (e.type === "session.started") started.set(e.sessionId, new Date(e.occurredAt));
    if (e.type === "challenge.attempted" && !seen.has(e.sessionId)) {
      const t0 = started.get(e.sessionId);
      if (t0) {
        out.push({ sessionId: e.sessionId, ms: new Date(e.occurredAt).getTime() - t0.getTime() });
        seen.add(e.sessionId);
      }
    }
  }
  return out;
}
