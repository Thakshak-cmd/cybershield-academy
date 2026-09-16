// @ts-check
import { Router } from "express";
import { SCHEMA_VERSION, deriveStreaks } from "@cybershield/shared";
import { earnedBadges } from "../../../../content/badges.js";
import { Challenge, Event, Progress } from "../models/index.js";
import { append, countAttempts, countHints, eventsFor } from "../telemetry.js";
import { resolveAttempt } from "../attempt-logic.js";

export const attemptRouter = Router();

/** @typedef {import("../attempt-logic.js").ChallengeDef & Record<string, any>} LeanChallenge */

/**
 * @typedef {object} LeanProgress
 * @property {number} [xp]
 * @property {string[]} [solvedChallenges]
 * @property {string[]} [badges]
 */

const MAX_SUBMISSION_BYTES = 20_000;

/**
 * POST /api/challenges/:id/attempt
 *
 * Runs the submitted patch through the validator, appends the resulting events to
 * the log, and updates the derived progress projection.
 *
 * The response carries the structured verdict only. The submitted source is used
 * for validation and then dropped -- it is never persisted, only its hash.
 */
/**
 * Which badges this learner now qualifies for that they did not already hold.
 *
 * @param {{ subjectId: string, clearedAfter: string[], already: string[] }} input
 */
async function awardBadges({ subjectId, clearedAfter, already }) {
  const [catalogue, unaidedFirstAttempts] = await Promise.all([
    /** @type {Promise<Record<string, any>[]>} */ (
      Challenge.find({}, { id: 1, skill: 1, isBoss: 1 }).lean()
    ),
    Event.countDocuments({
      subjectId,
      type: "challenge.attempted",
      "payload.countsForBkt": true,
      "payload.correct": true
    })
  ]);

  const earned = earnedBadges({
    cleared: clearedAfter,
    mastery: {},
    catalogue: catalogue.map(c => ({ id: c.id, skill: c.skill, isBoss: !!c.isBoss })),
    unaidedFirstAttempts
  });

  return earned.filter(id => !already.includes(id));
}

attemptRouter.post("/challenges/:id/attempt", async (req, res, next) => {
  try {
    const { subjectId, sessionId, isStudyParticipant } = req.auth;
    const { source, lines, durationMs = 0 } = req.body ?? {};

    const challenge = /** @type {LeanChallenge | null} */ (
      await Challenge.findOne({ id: req.params.id }).lean()
    );
    if (!challenge) return res.status(404).json({ error: "No such challenge." });

    /** @type {string | number[]} */
    let submission;
    if (challenge.format === "spot") {
      if (!Array.isArray(lines) || !lines.length) {
        return res.status(400).json({ error: "Choose a line." });
      }
      if (lines.length > 50 || !lines.every(n => Number.isInteger(n))) {
        return res.status(400).json({ error: "Those line numbers don't make sense." });
      }
      submission = lines;
    } else {
      if (typeof source !== "string" || !source.trim()) {
        return res.status(400).json({ error: "A patch is required." });
      }
      if (Buffer.byteLength(source, "utf8") > MAX_SUBMISSION_BYTES) {
        // Parsing is CPU-bound and this runs in a function with a hard time limit.
        return res.status(413).json({ error: "That patch is too large to check." });
      }
      submission = source;
    }

    const [priorAttempts, hintsUsed, progress] = await Promise.all([
      countAttempts(subjectId, challenge.id),
      countHints(subjectId, challenge.id),
      /** @type {Promise<LeanProgress | null>} */ (Progress.findOne({ subjectId }).lean())
    ]);

    const alreadySolved = !!progress?.solvedChallenges?.includes(challenge.id);

    const outcome = resolveAttempt(challenge, submission, {
      subjectId,
      sessionId,
      isStudyParticipant,
      priorAttempts,
      hintsUsed,
      durationMs,
      alreadySolved,
      runningXp: progress?.xp ?? 0
    });

    // Badges are awarded from the full history rather than from this attempt, so
    // a rule change backfills for learners who already qualified and nothing can
    // be earned twice. See content/badges.js.
    const newBadges = outcome.newlySolved
      ? await awardBadges({
          subjectId,
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

    // Projection catches up after the log, never before it. If this write fails the
    // log is still correct and the projection can be rebuilt; the reverse is not true.
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

    res.json({
      passed: outcome.verdict.passed,
      parseError: outcome.verdict.parseError,
      security: outcome.verdict.security,
      functional: outcome.verdict.functional,
      failedRules: outcome.verdict.failedRules,
      attemptNo: priorAttempts + 1,
      xpAwarded: outcome.xpAwarded,
      newBadges,
      streak: deriveStreaks(await eventsFor(subjectId)).solve,
      // Surfaced so the client can explain why an attempt did or did not move the
      // character sheet, rather than the mastery bar appearing to freeze at random.
      countedForMastery: outcome.bktObservation !== null
    });
  } catch (err) {
    next(err);
  }
});
