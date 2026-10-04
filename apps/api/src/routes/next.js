// @ts-check
import { Router } from "express";
import { SCHEMA_VERSION, deriveStreaks, derivePosture, recentActivity } from "@cybershield/shared";
import { Challenge, Progress } from "../models/index.js";
import { append as defaultAppend, bktObservationsFor as defaultObservations, eventsFor as defaultEvents,
         countHints as defaultCountHints, countAttempts as defaultCountAttempts,
         lessonsCompleted as defaultLessonsCompleted } from "../telemetry.js";
import { lessonForSkill } from "../../../../content/lessons.js";
import { recordAttempt as defaultRecordAttempt, postureCatalogue } from "../record-attempt.js";
import { BADGES } from "../../../../content/badges.js";
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
 *   loadTitles?: (ids: string[]) => Promise<Record<string, { title: string, tier: string }>>,
 *   loadEvents?: (subjectId: string) => Promise<import("@cybershield/shared").TelemetryEvent[]>,
 *   countHints?: (subjectId: string, challengeId: string) => Promise<number>,
 *   countAttempts?: (subjectId: string, challengeId: string) => Promise<number>,
 *   recordAttempt?: typeof defaultRecordAttempt,
 *   loadLessonsDone?: (subjectId: string) => Promise<string[]>
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
  const loadEvents = deps.loadEvents ?? defaultEvents;
  const countHints = deps.countHints ?? defaultCountHints;
  const countAttempts = deps.countAttempts ?? defaultCountAttempts;
  const recordAttempt = deps.recordAttempt ?? defaultRecordAttempt;
  const loadLessonsDone = deps.loadLessonsDone ?? defaultLessonsCompleted;

  /**
   * The lesson a learner must finish before this challenge, if any.
   *
   * Required the first time, for everyone, so every participant receives the
   * same instruction before their first ticket in a skill -- the within-subjects
   * design needs the intervention to be one thing, not whatever each learner
   * chose to read. The capstone has no lesson of its own: it is only reachable
   * once all three skills are strong, by which point all three are done.
   *
   * @param {string} subjectId
   * @param {LeanChallenge} challenge
   */
  async function lessonDue(subjectId, challenge) {
    if (challenge.isBoss) return null;
    const lesson = lessonForSkill(challenge.skill);
    if (!lesson) return null;
    const done = await loadLessonsDone(subjectId);
    return done.includes(lesson.id) ? null : lesson;
  }

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

      const due = await lessonDue(subjectId, challenge);

      res.json({
        challenge: publicChallenge(challenge),
        // Present when the learner has to take this skill's briefing first. The
        // recommendation stands: the ticket that follows the lesson is this one.
        lesson: due ? { id: due.id, title: due.title, skill: due.skill, from: due.from } : null,
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

      const due = await lessonDue(subjectId, challenge);
      if (due) {
        return res.status(409).json({
          error: `Take the briefing on ${due.title.toLowerCase()} first.`,
          lessonRequired: due.id
        });
      }

      const revealed = await countHints(subjectId, challenge.id);

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

      res.json({
        challenge: publicChallenge(challenge),
        hints: (challenge.hints || []).slice(0, revealed)
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/challenges/:id/hint
   *
   * Reveal the next hint, and record that it was taken.
   *
   * Hints used to be shown by the browser from a fixture and never reported, so
   * the server always believed none had been used. That was not cosmetic: a
   * hint-assisted solve was recorded as unaided, so the knowledge-tracing model
   * counted "I was told the answer" as evidence of mastery, XP paid the unaided
   * rate, and the streak and "No Hints Needed" badge counted assisted solves.
   * Hints are therefore issued here, one at a time, each leaving an event -- the
   * log is the only place attempt-time decisions can read from.
   */
  router.post("/challenges/:id/hint", async (req, res, next) => {
    try {
      const { subjectId, sessionId, isStudyParticipant } = req.auth;
      const challenge = await findChallenge(req.params.id);
      if (!challenge) return res.status(404).json({ error: "No such challenge." });

      const hints = challenge.hints || [];
      const [taken, attempts] = await Promise.all([
        countHints(subjectId, challenge.id),
        countAttempts(subjectId, challenge.id)
      ]);

      if (taken >= hints.length) {
        return res.json({ hints, remaining: 0 });
      }

      await append(subjectId, [{
        schemaVersion: SCHEMA_VERSION,
        subjectId,
        sessionId,
        occurredAt: new Date(),
        isStudyParticipant,
        type: "hint.requested",
        payload: {
          challengeId: challenge.id,
          skill: challenge.skill,
          hintLevel: taken + 1,
          attemptNo: attempts + 1
        }
      }]);

      res.json({ hints: hints.slice(0, taken + 1), remaining: hints.length - taken - 1 });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Whether this learner has earned the capstone.
   *
   * Enforced here, not only drawn on the progress screen: the header links to the
   * encounter from the start, and a participant who opened it in minute one would
   * produce capstone data that measures nothing about transfer. Fails closed --
   * without the model there is no evidence the gate was reached.
   *
   * @param {string} subjectId
   */
  async function capstoneOpen(subjectId) {
    const { capstoneUnlocked } = await ml.mastery(await loadState(subjectId));
    return capstoneUnlocked;
  }

  const LOCKED = {
    error: "The Aurora Breach is still locked. Build up all three skills first -- your character sheet shows how close you are.",
    locked: true
  };

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
      if (!(await capstoneOpen(req.auth.subjectId))) return res.status(403).json(LOCKED);
      res.json({ boss: publicBoss(boss) });
    } catch (err) {
      if (err instanceof MlServiceError) {
        return res.status(503).json({ error: "The adaptive layer is unavailable, so the capstone cannot be opened." });
      }
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
      if (!(await capstoneOpen(req.auth.subjectId))) return res.status(403).json(LOCKED);

      // Through the same path as every other attempt, so beating the capstone
      // completes it, pays XP, and can award the badge that needs it.
      const { outcome, body } = await recordAttempt({
        auth: req.auth, challenge: boss, submission: sources, durationMs
      });
      const stages = /** @type {NonNullable<typeof outcome.stages>} */ (outcome.stages);

      res.json({
        ...body,
        compromised: stages.compromised,
        secured: stages.secured,
        stages: stages.stages.map(st => ({
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
      if (err instanceof MlServiceError) {
        return res.status(503).json({ error: "The adaptive layer is unavailable, so the capstone cannot be scored." });
      }
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

      const [progress, events] = await Promise.all([loadProgress(subjectId), loadEvents(subjectId)]);

      res.json({
        streaks: deriveStreaks(events),
        // Derived from the log like the streaks: a projection of what the learner
        // did, never a number stored alongside it that could drift.
        posture: derivePosture(events, postureCatalogue(state.candidates.map(c => ({
          id: c.challenge_id, isDrill: !!c.is_drill, isBoss: !!c.is_boss
        })))),
        // The shift log on the briefing screen. Derived like everything else here.
        recent: recentActivity(events),
        mastery,
        unlocked,
        capstoneUnlocked,
        cleared: state.cleared,
        xp: progress?.xp ?? 0,
        badges: progress?.badges ?? [],
        allBadges: BADGES.map(b => ({
          id: b.id, name: b.name, description: b.description, art: b.art, skill: b.skill
        })),
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
      Challenge.find({}, { id: 1, skill: 1, tier: 1, masteryRequired: 1, isDrill: 1, isBoss: 1, isCapstone: 1, requires: 1 }).lean()
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
      is_capstone: !!c.isCapstone,
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
    // For a spot item, how many lines to pick -- never which. decoyLines stay
    // server-side too: shipping "why line 3 is wrong" gives the answer away by
    // elimination.
    flawedCount: challenge.format === "spot" ? (challenge.flawedLines || []).length : undefined,
    // A review ships the proposal and the reasons to choose from -- never
    // whether the proposal is sound, which reason is right, or why the others
    // are wrong. Any of those is the answer.
    proposed: challenge.format === "review" ? challenge.proposed : undefined,
    prAuthor: challenge.format === "review" ? challenge.prAuthor : undefined,
    reasons: challenge.format === "review"
      ? (challenge.reasons || []).map(r => ({ id: r.id, text: r.text }))
      : undefined,
    attackCount: (challenge.attackSuite || []).length,
    functionalCount: (challenge.functionalSuite || []).length,
    hintCount: (challenge.hints || []).length
  };
}
