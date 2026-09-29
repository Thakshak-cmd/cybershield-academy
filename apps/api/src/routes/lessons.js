// @ts-check
import { Router } from "express";
import { SCHEMA_VERSION } from "@cybershield/shared";
import { validate } from "@cybershield/validator";
import { LESSONS, lessonById } from "../../../../content/lessons.js";
import { fingerprint } from "../attempt-logic.js";
import { append as defaultAppend, lessonsCompleted as defaultLessonsCompleted,
         lessonPractice as defaultLessonPractice } from "../telemetry.js";
import { Event } from "../models/index.js";

const MAX_SUBMISSION_BYTES = 20_000;
/** Failed tries at the guided fix before "show me" is offered. */
const REVEAL_AFTER = 2;

/**
 * Lessons: the briefing files and the field manual.
 *
 * Every step is recorded, but nothing here is a BKT observation. Reading an
 * explanation, finishing a worked example someone else started, or answering a
 * recall question is not evidence of being able to fix code unaided -- which is
 * what the model estimates. The events exist so the analysis can ask whether
 * taking the lesson predicts the first unaided attempt, not to move mastery.
 *
 * Answers stay on the server until the learner commits to one, as for
 * challenges: the check's correct option, its explanations, and the guided
 * fix's solution are never in the payload that opens the lesson.
 *
 * @param {{
 *   append?: typeof defaultAppend,
 *   loadLessonsDone?: (subjectId: string) => Promise<string[]>,
 *   loadPractice?: (subjectId: string, lessonId: string) => Promise<{ attempts: number, done: boolean }>,
 *   loadChecked?: (subjectId: string, lessonId: string) => Promise<string[]>
 * }} [deps]
 */
export function createLessonsRouter(deps = {}) {
  const router = Router();
  const append = deps.append ?? defaultAppend;
  const loadLessonsDone = deps.loadLessonsDone ?? defaultLessonsCompleted;
  const loadPractice = deps.loadPractice ?? defaultLessonPractice;
  const loadChecked = deps.loadChecked ?? defaultLoadChecked;

  /** @param {any} req @param {string} type @param {Record<string, any>} payload */
  const record = (req, type, payload) => {
    const { subjectId, sessionId, isStudyParticipant } = req.auth;
    return append(subjectId, [{
      schemaVersion: SCHEMA_VERSION, subjectId, sessionId,
      occurredAt: new Date(), isStudyParticipant,
      type: /** @type {any} */ (type), payload
    }]);
  };

  /** GET /api/lessons -- the field manual's contents. */
  router.get("/lessons", async (req, res, next) => {
    try {
      const done = await loadLessonsDone(req.auth.subjectId);
      res.json({
        lessons: LESSONS.map(l => ({
          id: l.id, skill: l.skill, title: l.title, from: l.from, completed: done.includes(l.id)
        }))
      });
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/lessons/:id -- open a briefing, first time or reread. */
  router.get("/lessons/:id", async (req, res, next) => {
    try {
      const lesson = lessonById(req.params.id);
      if (!lesson) return res.status(404).json({ error: "No such briefing." });

      const [done, practice] = await Promise.all([
        loadLessonsDone(req.auth.subjectId),
        loadPractice(req.auth.subjectId, lesson.id)
      ]);
      const completed = done.includes(lesson.id);
      await record(req, "lesson.started", { lessonId: lesson.id, skill: lesson.skill, reread: completed });

      res.json({ lesson: publicLesson(lesson), completed, practice });
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/lessons/:id/practice -- the learner's go at the guided fix. */
  router.post("/lessons/:id/practice", async (req, res, next) => {
    try {
      const lesson = lessonById(req.params.id);
      if (!lesson) return res.status(404).json({ error: "No such briefing." });

      const { source } = req.body ?? {};
      if (typeof source !== "string" || !source.trim()) {
        return res.status(400).json({ error: "A patch is required." });
      }
      if (Buffer.byteLength(source, "utf8") > MAX_SUBMISSION_BYTES) {
        return res.status(413).json({ error: "That patch is too large to check." });
      }

      const verdict = validate(
        /** @type {any} */ ({ id: lesson.id, rules: lesson.guided.rules, meta: lesson.guided.meta }),
        source
      );
      const before = await loadPractice(req.auth.subjectId, lesson.id);
      const attemptNo = before.attempts + 1;

      await record(req, "lesson.practised", {
        lessonId: lesson.id, skill: lesson.skill, attemptNo,
        passed: verdict.passed, failedRules: verdict.failedRules,
        // A hash, never the code, as for challenge attempts.
        submissionHash: fingerprint(source)
      });

      res.json({
        passed: verdict.passed,
        parseError: verdict.parseError,
        security: verdict.security,
        functional: verdict.functional,
        failedRules: verdict.failedRules,
        attemptNo,
        canReveal: !verdict.passed && attemptNo >= REVEAL_AFTER
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/lessons/:id/reveal -- "show me".
   *
   * Offered only after real tries. A worked example is supposed to be finished
   * by the learner; handing it over on the first stumble would make the guided
   * step a page to click through. But nobody should be stuck on the lesson
   * either, since it gates their first ticket.
   */
  router.post("/lessons/:id/reveal", async (req, res, next) => {
    try {
      const lesson = lessonById(req.params.id);
      if (!lesson) return res.status(404).json({ error: "No such briefing." });

      const practice = await loadPractice(req.auth.subjectId, lesson.id);
      if (!practice.done && practice.attempts < REVEAL_AFTER) {
        return res.status(409).json({ error: "Have a go first. Marcus has done the hard part." });
      }
      await record(req, "lesson.revealed", { lessonId: lesson.id, skill: lesson.skill });
      res.json({ solution: lesson.guided.solution });
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/lessons/:id/check -- answer one question, get its explanation. */
  router.post("/lessons/:id/check", async (req, res, next) => {
    try {
      const lesson = lessonById(req.params.id);
      if (!lesson) return res.status(404).json({ error: "No such briefing." });

      const { questionId, choice } = req.body ?? {};
      const question = lesson.check.find(q => q.id === questionId);
      if (!question) return res.status(400).json({ error: "No such question." });
      if (!question.options.some(o => o.id === choice)) {
        return res.status(400).json({ error: "Choose one of the options." });
      }

      const correct = choice === question.answer;
      await record(req, "lesson.checked", {
        lessonId: lesson.id, skill: lesson.skill, questionId, choice, correct
      });

      res.json({
        correct,
        explanation: question.explanations[choice],
        // Once the learner has committed, showing the right answer teaches;
        // hiding it would only make them guess again.
        answer: question.answer,
        // Written to be read by someone who picked it, so its "Right." opener
        // would read as praise for the wrong answer shown just above it.
        answerExplanation: correct ? null : question.explanations[question.answer].replace(/^Right\.\s*/, "")
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/lessons/:id/complete -- file it in the manual.
   *
   * Refused until the guided fix is done (or shown) and every question has an
   * answer. The lesson is required so that everyone gets the same instruction;
   * a completion that skipped the practice would not be the same instruction.
   */
  router.post("/lessons/:id/complete", async (req, res, next) => {
    try {
      const lesson = lessonById(req.params.id);
      if (!lesson) return res.status(404).json({ error: "No such briefing." });

      const { subjectId } = req.auth;
      const [practice, checked, done] = await Promise.all([
        loadPractice(subjectId, lesson.id),
        loadChecked(subjectId, lesson.id),
        loadLessonsDone(subjectId)
      ]);
      const reread = done.includes(lesson.id);

      if (!reread) {
        if (!practice.done) {
          return res.status(409).json({ error: "Finish the guided fix first." });
        }
        const unanswered = lesson.check.filter(q => !checked.includes(q.id));
        if (unanswered.length) {
          return res.status(409).json({ error: "Answer the check questions first." });
        }
      }

      const durationMs = Number(req.body?.durationMs) || 0;
      await record(req, "lesson.completed", { lessonId: lesson.id, skill: lesson.skill, durationMs, reread });
      res.json({ completed: true, reread });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/**
 * What the learner may see when a lesson opens.
 *
 * @param {import("../../../../content/lessons.js").Lesson} lesson
 */
export function publicLesson(lesson) {
  const { solution: _solution, rules: _rules, meta: _meta, ...guided } = lesson.guided;
  return {
    id: lesson.id,
    skill: lesson.skill,
    title: lesson.title,
    from: lesson.from,
    opener: lesson.opener,
    theory: lesson.theory,
    demo: lesson.demo,
    guided,
    check: lesson.check.map(q => ({ id: q.id, question: q.question, options: q.options }))
  };
}

/** Question ids this learner has answered for a lesson, at least once. */
async function defaultLoadChecked(subjectId, lessonId) {
  return /** @type {string[]} */ (await Event.distinct("payload.questionId", {
    subjectId, type: "lesson.checked", "payload.lessonId": lessonId
  }));
}
