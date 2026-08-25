// @ts-check
import { Router } from "express";
import { SCHEMA_VERSION } from "@cybershield/shared";
import { Challenge, Progress } from "../models/index.js";
import { append as defaultAppend, bktObservationsFor as defaultObservations } from "../telemetry.js";
import { createMlClient, MlServiceError } from "../ml-client.js";

/** @typedef {Record<string, any>} LeanChallenge */

/**
 * Collaborators are injected rather than imported at the call site.
 *
 * ES module bindings are immutable, so a test cannot swap out an imported
 * function -- and reaching for a mocking library to defeat that would be working
 * around the language rather than the design. Passing them in keeps the route
 * exercisable without Mongo or a running Python service.
 *
 * @param {{
 *   mlClient?: import("../ml-client.js").MlClient,
 *   append?: typeof defaultAppend,
 *   findChallenge?: (id: string) => Promise<LeanChallenge|null>,
 *   loadState?: (subjectId: string) => Promise<import("../ml-client.js").LearnerState>
 * }} [deps]
 */
export function createNextRouter(deps = {}) {
  const router = Router();
  const ml = deps.mlClient ?? createMlClient();
  const append = deps.append ?? defaultAppend;
  const findChallenge = deps.findChallenge ?? (async id =>
    /** @type {LeanChallenge | null} */ (await Challenge.findOne({ id }).lean()));
  const loadState = deps.loadState ?? defaultLoadState;

  /**
   * GET /api/next
   *
   * Asks the BKT service what to serve, records that it was served, and returns it.
   *
   * The event is written before the response goes out. If the write fails the
   * learner gets an error rather than a challenge, which is the right way round:
   * a challenge served but not recorded leaves a gap in the log, and the log is
   * what the study analyses.
   */
  router.get("/next", async (req, res, next) => {
    try {
      const { subjectId, sessionId, isStudyParticipant } = req.auth;

      let rec;
      try {
        rec = await ml.recommend(await loadState(subjectId));
      } catch (err) {
        if (err instanceof MlServiceError) {
          // Distinguished from a 500 so the client can say something true: the
          // adaptive layer is down, not the platform.
          console.error("[api] ml service:", err.message);
          return res.status(503).json({
            error: "The adaptive layer is unavailable. Try again in a moment."
          });
        }
        throw err;
      }

      if (!rec) {
        return res.json({ challenge: null, reason: "Nothing left to serve." });
      }

      const challenge = await findChallenge(rec.challengeId);
      if (!challenge) {
        // The model named something the content store does not have, which means
        // the two are out of sync. Failing loudly beats serving a blank screen.
        console.error(`[api] recommended unknown challenge ${rec.challengeId}`);
        return res.status(500).json({ error: "Something went wrong on our side." });
      }

      await append(subjectId, [{
        schemaVersion: SCHEMA_VERSION,
        subjectId,
        sessionId,
        occurredAt: new Date(),
        isStudyParticipant,
        type: "recommendation.served",
        payload: {
          challengeId: rec.challengeId,
          skill: rec.skill,
          pMastery: rec.pMastery,
          policy: rec.policy,
          reason: rec.reason
        }
      }]);

      res.json({
        challenge: publicChallenge(challenge),
        pMastery: rec.pMastery,
        policy: rec.policy,
        reason: rec.reason,
        mastery: rec.mastery,
        capstoneUnlocked: rec.capstoneUnlocked
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/challenges/:id/start
   *
   * Records that the learner opened a challenge. Deliberately separate from the
   * recommendation: whether the two match is what shows adaptive sequencing
   * changed behaviour, and that only means something if the learner could have
   * opened something else.
   */
  router.post("/challenges/:id/start", async (req, res, next) => {
    try {
      const { subjectId, sessionId, isStudyParticipant } = req.auth;

      const challenge = await findChallenge(req.params.id);
      if (!challenge) return res.status(404).json({ error: "No such challenge." });

      await append(subjectId, [{
        schemaVersion: SCHEMA_VERSION,
        subjectId,
        sessionId,
        occurredAt: new Date(),
        isStudyParticipant,
        type: "challenge.started",
        payload: {
          challengeId: challenge.id,
          skill: challenge.skill,
          subSkill: challenge.subSkill,
          tier: challenge.tier
        }
      }]);

      res.json({ challenge: publicChallenge(challenge) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/**
 * Gather everything the stateless ML service needs to answer.
 *
 * Mastery is not stored and incremented; it is recomputed by replaying the log.
 * A stored value that drifted from the log would be a silent inconsistency
 * between the model and the evidence it claims to summarise, and replaying a few
 * dozen scalar updates costs nothing at this scale.
 *
 * @param {string} subjectId
 * @returns {Promise<import("../ml-client.js").LearnerState>}
 */
async function defaultLoadState(subjectId) {
  const [observations, catalogue, progress] = await Promise.all([
    defaultObservations(subjectId),
    /** @type {Promise<LeanChallenge[]>} */ (
      Challenge.find({}, { id: 1, skill: 1, tier: 1, masteryRequired: 1, isDrill: 1, isBoss: 1, requires: 1 }).lean()
    ),
    /** @type {Promise<{ solvedChallenges?: string[], unlockedNodes?: string[] } | null>} */ (
      Progress.findOne({ subjectId }, { solvedChallenges: 1, unlockedNodes: 1 }).lean()
    )
  ]);

  return {
    observations,
    candidates: catalogue.map(c => ({
      challenge_id: c.id,
      skill: c.skill,
      mastery_required: c.masteryRequired ?? 0,
      is_drill: !!c.isDrill,
      is_boss: !!c.isBoss,
      requires: c.requires ?? null
    })),
    cleared: progress?.solvedChallenges ?? [],
    unlocked: progress?.unlockedNodes ?? []
  };
}

/**
 * Strip the parts of a challenge the learner must not see.
 *
 * `rules` would name the exact structural checks, and `attackSuite` /
 * `functionalSuite` are the test cases. Shipping any of them turns the puzzle into
 * a reading exercise -- and would have been easy to leak by returning the lean
 * document directly.
 *
 * @param {Record<string, any>} challenge
 */
function publicChallenge(challenge) {
  return {
    id: challenge.id,
    title: challenge.title,
    skill: challenge.skill,
    subSkill: challenge.subSkill,
    tier: challenge.tier,
    format: challenge.format,
    repo: challenge.repo,
    file: challenge.file,
    reportedBy: challenge.reportedBy,
    brief: challenge.brief,
    vulnerable: challenge.vulnerable,
    // Counts only, so the interface can show "0/3 repelled" without naming them.
    attackCount: (challenge.attackSuite || []).length,
    functionalCount: (challenge.functionalSuite || []).length,
    hintCount: (challenge.hints || []).length
  };
}
