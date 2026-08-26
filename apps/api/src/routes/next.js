// @ts-check
import { Router } from "express";
import { SCHEMA_VERSION } from "@cybershield/shared";
import { Challenge, Progress } from "../models/index.js";
import { append as defaultAppend, bktObservationsFor as defaultObservations } from "../telemetry.js";
import { validateStages } from "@cybershield/validator";
import { createMlClient, MlServiceError } from "../ml-client.js";

/** @typedef {Record<string, any>} LeanChallenge */

/** Parsing is CPU-bound and a boss carries several files, so the cap is per-encounter. */
const MAX_BOSS_BYTES = 80_000;

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
 *   loadState?: (subjectId: string) => Promise<import("../ml-client.js").LearnerState>,
 *   loadProgress?: (subjectId: string) => Promise<{ xp?: number, badges?: string[] }|null>,
 *   loadTitles?: (ids: string[]) => Promise<Record<string, { title: string, tier: string }>>
 * }} [deps]
 */
export function createNextRouter(deps = {}) {
  const router = Router();
  const ml = deps.mlClient ?? createMlClient();
  const append = deps.append ?? defaultAppend;
  const findChallenge = deps.findChallenge ?? (async id =>
    /** @type {LeanChallenge | null} */ (await Challenge.findOne({ id }).lean()));
  const loadState = deps.loadState ?? defaultLoadState;
  const loadProgress = deps.loadProgress ?? defaultLoadProgress;
  const loadTitles = deps.loadTitles ?? defaultLoadTitles;

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

  /**
   * GET /api/boss/:id
   *
   * The encounter, with each stage's brief and starting code. Rules and meta are
   * stripped exactly as they are for an ordinary challenge.
   */
  router.get("/boss/:id", async (req, res, next) => {
    try {
      const boss = await findChallenge(req.params.id);
      if (!boss || !boss.stages) return res.status(404).json({ error: "No such encounter." });
      res.json({ boss: publicBoss(boss) });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/boss/:id/attempt
   *
   * Scores every stage and reports which parts of the system are still reachable.
   * A partial fix is a real outcome, not a failure to be flattened into one bit:
   * seeing two stages held and one open is what teaches that the techniques are
   * not interchangeable.
   */
  router.post("/boss/:id/attempt", async (req, res, next) => {
    try {
      const { subjectId, sessionId, isStudyParticipant } = req.auth;
      const { sources, durationMs = 0 } = req.body ?? {};

      if (!sources || typeof sources !== "object") {
        return res.status(400).json({ error: "Patches are required." });
      }
      const total = Object.values(sources).reduce(
        (n, v) => n + (typeof v === "string" ? Buffer.byteLength(v, "utf8") : 0), 0);
      if (total > MAX_BOSS_BYTES) {
        return res.status(413).json({ error: "Those patches are too large to check." });
      }

      const boss = await findChallenge(req.params.id);
      if (!boss || !boss.stages) return res.status(404).json({ error: "No such encounter." });

      const outcome = validateStages(/** @type {any} */ (boss), sources);

      await append(subjectId, [{
        schemaVersion: SCHEMA_VERSION,
        subjectId, sessionId,
        occurredAt: new Date(),
        isStudyParticipant,
        type: "challenge.attempted",
        payload: {
          challengeId: boss.id,
          skill: boss.skill,
          attemptNo: 1,
          correct: outcome.passed,
          validator: boss.validator,
          // Per stage, so the analysis can ask which technique a learner failed
          // to transfer rather than only whether the boss was beaten.
          failedRules: outcome.stages.flatMap(st => st.failedRules.map(r => `${st.stageId}:${r}`)),
          submissionHash: "",
          durationMs,
          countsForBkt: false
        }
      }]);

      res.json({
        passed: outcome.passed,
        compromised: outcome.compromised,
        secured: outcome.secured,
        stages: outcome.stages.map(st => ({
          stageId: st.stageId,
          component: st.component,
          skill: st.skill,
          attempted: st.attempted,
          passed: st.passed,
          parseError: st.parseError,
          security: st.security,
          functional: st.functional
        }))
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/progress
   *
   * Everything the character sheet and skill tree render: mastery per skill, which
   * nodes are open, which are cleared, and the catalogue they sit in.
   *
   * The tree shape comes from the same challenge documents the policy gates on, so
   * there is no second definition of the tree to drift out of step with the first.
   */
  router.get("/progress", async (req, res, next) => {
    try {
      const { subjectId } = req.auth;
      const state = await loadState(subjectId);

      let mastery = {};
      let unlocked = [];
      let capstoneUnlocked = false;
      let degraded = false;

      try {
        const result = await ml.mastery(state);
        mastery = result.mastery;
        unlocked = result.unlocked;
        capstoneUnlocked = result.capstoneUnlocked;
      } catch (err) {
        if (!(err instanceof MlServiceError)) throw err;
        // The tree is still worth showing without the model: cleared challenges
        // and XP are facts from the log, not predictions. Saying which parts are
        // missing beats an error page that hides progress the learner earned.
        console.error("[api] ml service:", err.message);
        degraded = true;
      }

      const progress = await loadProgress(subjectId);

      res.json({
        mastery,
        unlocked,
        capstoneUnlocked,
        cleared: state.cleared,
        xp: progress?.xp ?? 0,
        badges: progress?.badges ?? [],
        degraded,
        nodes: state.candidates.map(c => ({
          id: c.challenge_id,
          skill: c.skill,
          masteryRequired: c.mastery_required ?? 0,
          isDrill: !!c.is_drill,
          isBoss: !!c.is_boss,
          requires: c.requires ?? null
        })),
        titles: await loadTitles(state.candidates.map(c => c.challenge_id))
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** @param {string} subjectId */
async function defaultLoadProgress(subjectId) {
  return /** @type {Promise<{ xp?: number, badges?: string[] } | null>} */ (
    Progress.findOne({ subjectId }, { xp: 1, badges: 1 }).lean()
  );
}

/**
 * Titles for the tree, keyed by id.
 *
 * Only the title and tier -- the brief, the vulnerable code and everything the
 * validator checks stay behind the challenge endpoint. A tree that shipped full
 * challenge documents would hand over every locked challenge in advance.
 *
 * @param {string[]} ids
 */
async function defaultLoadTitles(ids) {
  const rows = /** @type {Record<string, any>[]} */ (
    await Challenge.find({ id: { $in: ids } }, { id: 1, title: 1, tier: 1, skill: 1 }).lean()
  );
  return Object.fromEntries(rows.map(r => [r.id, { title: r.title, tier: r.tier }]));
}

/**
 * A boss with the answers removed, stage by stage.
 * @param {Record<string, any>} boss
 */
function publicBoss(boss) {
  return {
    id: boss.id,
    title: boss.title,
    brief: boss.brief,
    repo: boss.repo,
    reportedBy: boss.reportedBy,
    skills: boss.skills || [boss.skill],
    hintCount: (boss.hints || []).length,
    stages: (boss.stages || []).map(st => ({
      id: st.id,
      component: st.component,
      skill: st.skill,
      title: st.title,
      brief: st.brief,
      file: st.file,
      vulnerable: st.vulnerable
    }))
  };
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
