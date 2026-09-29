// @ts-check
import { Router } from "express";
import { Challenge } from "../models/index.js";
import { recordAttempt } from "../record-attempt.js";

export const attemptRouter = Router();

/** @typedef {Record<string, any>} LeanChallenge */

const MAX_SUBMISSION_BYTES = 20_000;

/**
 * POST /api/challenges/:id/attempt
 *
 * Checks the submission is the right shape for the challenge's format, then hands
 * it to recordAttempt, which validates it, appends the events, and updates the
 * projection. The response carries the structured verdict only. A submitted patch
 * is used for validation and then dropped -- it is never persisted, only its hash.
 */
attemptRouter.post("/challenges/:id/attempt", async (req, res, next) => {
  try {
    const { source, lines, decision, reason, durationMs = 0 } = req.body ?? {};

    const challenge = /** @type {LeanChallenge | null} */ (
      await Challenge.findOne({ id: req.params.id }).lean()
    );
    if (!challenge) return res.status(404).json({ error: "No such challenge." });

    /** @type {string | number[] | { decision: string, reason?: string }} */
    let submission;
    if (challenge.format === "review") {
      if (decision !== "approve" && decision !== "reject") {
        return res.status(400).json({ error: "Approve or reject the change." });
      }
      if (decision === "reject" && (typeof reason !== "string" || !reason)) {
        return res.status(400).json({ error: "Say why you are rejecting it." });
      }
      submission = { decision, reason: decision === "reject" ? reason : undefined };
    } else if (challenge.format === "spot") {
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

    const { body } = await recordAttempt({ auth: req.auth, challenge, submission, durationMs });
    res.json(body);
  } catch (err) {
    next(err);
  }
});
