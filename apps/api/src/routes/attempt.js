// @ts-check
import { Router } from "express";
import { Challenge, Progress } from "../models/index.js";
import { append, countAttempts, countHints } from "../telemetry.js";
import { resolveAttempt } from "../attempt-logic.js";

export const attemptRouter = Router();

/** @typedef {import("../attempt-logic.js").ChallengeDef & Record<string, any>} LeanChallenge */

/**
 * @typedef {object} LeanProgress
 * @property {number} [xp]
 * @property {string[]} [solvedChallenges]
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
attemptRouter.post("/challenges/:id/attempt", async (req, res, next) => {
  try {
    const { subjectId, sessionId, isStudyParticipant } = req.auth;
    const { source, durationMs = 0 } = req.body ?? {};

    if (typeof source !== "string" || !source.trim()) {
      return res.status(400).json({ error: "A patch is required." });
    }
    if (Buffer.byteLength(source, "utf8") > MAX_SUBMISSION_BYTES) {
      // Parsing is CPU-bound and this runs in a function with a hard time limit.
      return res.status(413).json({ error: "That patch is too large to check." });
    }

    const challenge = /** @type {LeanChallenge | null} */ (
      await Challenge.findOne({ id: req.params.id }).lean()
    );
    if (!challenge) return res.status(404).json({ error: "No such challenge." });

    const [priorAttempts, hintsUsed, progress] = await Promise.all([
      countAttempts(subjectId, challenge.id),
      countHints(subjectId, challenge.id),
      /** @type {Promise<LeanProgress | null>} */ (Progress.findOne({ subjectId }).lean())
    ]);

    const alreadySolved = !!progress?.solvedChallenges?.includes(challenge.id);

    const outcome = resolveAttempt(challenge, source, {
      subjectId,
      sessionId,
      isStudyParticipant,
      priorAttempts,
      hintsUsed,
      durationMs,
      alreadySolved,
      runningXp: progress?.xp ?? 0
    });

    const written = await append(subjectId, outcome.events);

    // Projection catches up after the log, never before it. If this write fails the
    // log is still correct and the projection can be rebuilt; the reverse is not true.
    if (outcome.xpAwarded || outcome.newlySolved) {
      await Progress.findOneAndUpdate(
        { subjectId },
        {
          $inc: { xp: outcome.xpAwarded },
          ...(outcome.newlySolved ? { $addToSet: { solvedChallenges: challenge.id } } : {}),
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
      // Surfaced so the client can explain why an attempt did or did not move the
      // character sheet, rather than the mastery bar appearing to freeze at random.
      countedForMastery: outcome.bktObservation !== null
    });
  } catch (err) {
    next(err);
  }
});
