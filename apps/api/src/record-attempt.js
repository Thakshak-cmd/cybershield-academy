// @ts-check
import { SCHEMA_VERSION, deriveStreaks, postureChange } from "@cybershield/shared";
import { earnedBadges } from "../../../content/badges.js";
import { Challenge, Event, Progress } from "./models/index.js";
import { append, countAttempts, countHints, eventsFor } from "./telemetry.js";
import { resolveAttempt } from "./attempt-logic.js";

/**
 * Record one attempt at anything: a patch, a configuration, a spot item, a
 * review, or the capstone.
 *
 * Every kind of attempt goes through here so that every kind is recorded the same
 * way. The capstone used to have its own route that wrote only the attempt event
 * -- no completion, no XP, no badge -- so beating it earned nothing, "Aurora Held"
 * could never be awarded, and every boss attempt claimed to be the first. One path
 * means a new format cannot quietly skip a step.
 *
 * @param {{
 *   auth: { subjectId: string, sessionId: string, isStudyParticipant: boolean },
 *   challenge: Record<string, any>,
 *   submission: any,
 *   durationMs?: number
 * }} input
 */
export async function recordAttempt({ auth, challenge, submission, durationMs = 0 }) {
  const { subjectId, sessionId, isStudyParticipant } = auth;

  const [priorAttempts, hintsUsed, progress, catalogue] = await Promise.all([
    countAttempts(subjectId, challenge.id),
    countHints(subjectId, challenge.id),
    /** @type {Promise<{ xp?: number, solvedChallenges?: string[], badges?: string[] } | null>} */ (
      Progress.findOne({ subjectId }).lean()
    ),
    /** @type {Promise<Record<string, any>[]>} */ (
      Challenge.find({}, { id: 1, skill: 1, isBoss: 1, isDrill: 1 }).lean()
    )
  ]);

  const alreadySolved = !!progress?.solvedChallenges?.includes(challenge.id);

  const outcome = resolveAttempt(/** @type {any} */ (challenge), submission, {
    subjectId, sessionId, isStudyParticipant,
    priorAttempts, hintsUsed, durationMs, alreadySolved,
    runningXp: progress?.xp ?? 0
  });

  // Badges come from the whole history, not this attempt, so a rule change
  // backfills and nothing is earned twice. See content/badges.js.
  const newBadges = outcome.newlySolved
    ? await awardBadges({
        subjectId,
        catalogue,
        clearedAfter: [...(progress?.solvedChallenges ?? []), challenge.id],
        already: progress?.badges ?? []
      })
    : [];

  const written = await append(subjectId, [
    ...outcome.events,
    ...newBadges.map(id => (/** @type {import("@cybershield/shared").DraftEvent} */ ({
      schemaVersion: SCHEMA_VERSION,
      subjectId, sessionId,
      occurredAt: new Date(),
      isStudyParticipant,
      type: "badge.earned",
      payload: { badgeId: id, skill: challenge.skill }
    })))
  ]);

  // The projection catches up after the log, never before it. If this write
  // fails the log is still right and the projection can be rebuilt; the reverse
  // is not true.
  if (outcome.xpAwarded || outcome.newlySolved || newBadges.length) {
    await Progress.findOneAndUpdate(
      { subjectId },
      {
        $inc: { xp: outcome.xpAwarded },
        ...(outcome.newlySolved ? { $addToSet: { solvedChallenges: challenge.id } } : {}),
        ...(newBadges.length ? { $push: { badges: { $each: newBadges } } } : {}),
        $max: { lastEventSeq: written[written.length - 1].seq },
        $set: { updatedAt: new Date() }
      },
      { upsert: true }
    );
  }

  const events = await eventsFor(subjectId);

  return {
    outcome,
    body: {
      passed: outcome.verdict.passed,
      parseError: outcome.verdict.parseError,
      security: outcome.verdict.security,
      functional: outcome.verdict.functional,
      failedRules: outcome.verdict.failedRules,
      attemptNo: priorAttempts + 1,
      xpAwarded: outcome.xpAwarded,
      newBadges,
      streak: deriveStreaks(events).solve,
      posture: postureChange(events, postureCatalogue(catalogue)),
      // Surfaced so the interface can explain why an attempt did or did not move
      // the character sheet, rather than the mastery bar appearing to freeze.
      countedForMastery: outcome.bktObservation !== null
    }
  };
}

/**
 * Which challenges are real holes in Aurora, for the posture calculation.
 * Drills are practice and the capstone is weighted on its own.
 *
 * @param {Record<string, any>[]} catalogue
 */
export function postureCatalogue(catalogue) {
  return {
    holes: catalogue.filter(c => !c.isDrill && !c.isBoss).map(c => c.id),
    capstones: catalogue.filter(c => c.isBoss).map(c => c.id)
  };
}

/**
 * Badges this learner now qualifies for and does not already hold.
 *
 * @param {{ subjectId: string, catalogue: Record<string, any>[],
 *           clearedAfter: string[], already: string[] }} input
 */
async function awardBadges({ subjectId, catalogue, clearedAfter, already }) {
  const unaidedFirstAttempts = await Event.countDocuments({
    subjectId,
    type: "challenge.attempted",
    "payload.countsForBkt": true,
    "payload.correct": true
  });

  const earned = earnedBadges({
    cleared: clearedAfter,
    mastery: {},
    catalogue: catalogue.map(c => ({ id: c.id, skill: c.skill, isBoss: !!c.isBoss, isDrill: !!c.isDrill })),
    unaidedFirstAttempts
  });

  return earned.filter(id => !already.includes(id));
}
