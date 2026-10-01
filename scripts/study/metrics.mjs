// @ts-check
import { bktObservations, derivePosture, followRate, timeToFirstAction } from "@cybershield/shared";

/**
 * Per-participant engagement measures, derived from the event log.
 *
 * Every measure that the platform already defines -- follow-through, time to
 * first action, posture, what counts as a BKT observation -- is computed by the
 * same shared function the platform uses, so the number in the dissertation is
 * the number the platform meant. Nothing here is a second definition.
 */

/**
 * @typedef {{ id: string, skill: string, isDrill?: boolean, isBoss?: boolean }} CatalogueEntry
 * @param {any[]} events      one participant's events
 * @param {CatalogueEntry[]} catalogue
 */
export function participantMetrics(events, catalogue) {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const at = e => new Date(e.occurredAt).getTime();
  const holes = new Set(catalogue.filter(c => !c.isDrill && !c.isBoss).map(c => c.id));
  const drills = new Set(catalogue.filter(c => c.isDrill).map(c => c.id));
  const bosses = new Set(catalogue.filter(c => c.isBoss).map(c => c.id));
  const of = type => ordered.filter(e => e.type === type);

  // Active time: first to last event of each session. A gap inside a session
  // still counts, which overstates time for anyone who walked away mid-session;
  // the report says so rather than guessing at an idle threshold.
  /** @type {Map<string, { first: number, last: number }>} */
  const sessions = new Map();
  for (const e of ordered) {
    const s = sessions.get(e.sessionId) ?? { first: at(e), last: at(e) };
    s.first = Math.min(s.first, at(e));
    s.last = Math.max(s.last, at(e));
    sessions.set(e.sessionId, s);
  }
  const activeMinutes = [...sessions.values()].reduce((m, s) => m + (s.last - s.first) / 60000, 0);

  const completed = of("challenge.completed");
  const completedIds = new Set(completed.map(e => e.payload.challengeId));

  // Time on task: from the last time the challenge was opened to its completion.
  const timeOnTask = completed.map(c => {
    const opened = ordered.filter(e => e.type === "challenge.started" &&
      e.payload.challengeId === c.payload.challengeId && e.seq < c.seq).pop();
    return opened ? (at(c) - at(opened)) / 1000 : null;
  }).filter(v => v !== null);

  const observations = bktObservations(ordered);
  const firstAnswers = new Map();
  for (const e of of("lesson.checked")) {
    const key = `${e.payload.lessonId}:${e.payload.questionId}`;
    if (!firstAnswers.has(key)) firstAnswers.set(key, !!e.payload.correct);
  }
  const lessonsDone = of("lesson.completed").filter(e => !e.payload.reread);
  const follow = followRate(ordered);
  const ttfa = timeToFirstAction(ordered)[0];

  return {
    sessions: sessions.size,
    activeMinutes: round(activeMinutes, 1),
    challengesStarted: new Set(of("challenge.started").map(e => e.payload.challengeId)).size,
    challengesCompleted: completedIds.size,
    holesClosed: [...completedIds].filter(id => holes.has(id)).length,
    drillsCleared: [...completedIds].filter(id => drills.has(id)).length,
    capstoneHeld: [...completedIds].some(id => bosses.has(id)),
    attempts: of("challenge.attempted").length,
    bktObservations: observations.length,
    firstAttemptCorrectRate: rate(observations.filter(e => e.payload.correct).length, observations.length),
    attemptsPerCompletion: mean(completed.map(e => e.payload.totalAttempts ?? 1)),
    hintsRequested: of("hint.requested").length,
    hintedCompletions: completed.filter(e => (e.payload.hintsUsed ?? 0) > 0).length,
    medianTimeOnTaskSec: median(timeOnTask),
    followRate: Number.isNaN(follow) ? null : round(follow, 3),
    timeToFirstActionSec: ttfa ? round(ttfa.ms / 1000, 1) : null,
    lessonsCompleted: lessonsDone.length,
    meanLessonMinutes: mean(lessonsDone.map(e => (e.payload.durationMs ?? 0) / 60000)),
    lessonReveals: of("lesson.revealed").length,
    lessonCheckFirstTryRate: rate([...firstAnswers.values()].filter(Boolean).length, firstAnswers.size),
    xp: of("xp.awarded").reduce((s, e) => s + (e.payload.amount ?? 0), 0),
    finalPosture: derivePosture(ordered, {
      holes: [...holes], capstones: [...bosses]
    }).score
  };
}

/**
 * One sequence per skill of unaided first-attempt correctness, in log order.
 * Exactly what BKT trained on during the session, and so what it is scored on.
 *
 * @param {string} subject
 * @param {any[]} events
 */
export function bktSequences(subject, events) {
  /** @type {Record<string, boolean[]>} */
  const bySkill = {};
  for (const e of bktObservations([...events].sort((a, b) => a.seq - b.seq))) {
    (bySkill[e.payload.skill] ??= []).push(!!e.payload.correct);
  }
  return Object.entries(bySkill).map(([skill, observations]) => ({ subject, skill, observations }));
}

/** n, mean, sample SD, median, min, max of the finite values. */
export function describe(values) {
  const xs = values.filter(v => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  const n = xs.length;
  if (!n) return { n: 0, mean: null, sd: null, median: null, min: null, max: null };
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1)) : null;
  return { n, mean: m, sd, median: median(xs), min: xs[0], max: xs[n - 1] };
}

function median(values) {
  const xs = [...values].sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}
function mean(values) {
  return values.length ? round(values.reduce((a, b) => a + b, 0) / values.length, 2) : null;
}
function rate(hits, total) {
  return total ? round(hits / total, 3) : null;
}
function round(x, dp) {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}
