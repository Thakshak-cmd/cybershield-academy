import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createLessonsRouter } from "../src/routes/lessons.js";
import { lessonById } from "../../../content/lessons.js";

/**
 * The lesson routes, with the log held in memory so the rules -- answers stay
 * on the server, practice is never a BKT observation, a lesson cannot be
 * filed without being done -- are checked without a database.
 */
/** @param {{ done?: string[] }} [options] */
async function lessonApp({ done = [] } = {}) {
  /** @type {any[]} */
  const log = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, nxt) => { req.auth = { subjectId: "s", sessionId: "x", isStudyParticipant: true }; nxt(); });
  app.use("/api", createLessonsRouter({
    append: async (_s, ev) => { log.push(...ev); return ev.map((e, i) => ({ ...e, seq: log.length + i })); },
    loadLessonsDone: async () => [...done, ...log.filter(e => e.type === "lesson.completed").map(e => e.payload.lessonId)],
    loadPractice: async (_s, id) => {
      const rows = log.filter(e => ["lesson.practised", "lesson.revealed"].includes(e.type) && e.payload.lessonId === id);
      return {
        attempts: rows.filter(e => e.type === "lesson.practised").length,
        done: rows.some(e => e.type === "lesson.revealed" || e.payload.passed)
      };
    },
    loadChecked: async (_s, id) => [...new Set(log.filter(e => e.type === "lesson.checked" && e.payload.lessonId === id)
                                                   .map(e => e.payload.questionId))],
    addXp: async (_s, amount) => amount
  }));
  const srv = app.listen(0);
  await new Promise(r => srv.once("listening", r));
  const base = `http://localhost:${/** @type {import("node:net").AddressInfo} */ (srv.address()).port}/api/lessons`;
  const post = (path, body = {}) => fetch(base + path, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  return { base, post, log, close: () => srv.close() };
}

const SQLI = /** @type {import("../../../content/lessons.js").Lesson} */ (lessonById("lesson-sqli"));

describe("lesson routes", () => {
  test("opening a lesson never ships the solution, the rules or the answers", async () => {
    const { base, log, close } = await lessonApp();
    const body = await (await fetch(base + "/lesson-sqli")).json();
    close();
    const blob = JSON.stringify(body);
    assert.ok(!blob.includes("db.query(sql, [id])"), "the guided solution leaked");
    assert.ok(!blob.includes("sqli.uses-parameterised-query"), "the rules leaked");
    assert.ok(!blob.includes("explanations") && !blob.includes('"answer"'), "the check answers leaked");
    assert.equal(body.lesson.guided.start, SQLI.guided.start);
    assert.equal(log[0].type, "lesson.started");
  });

  test("practice is scored by the real validator and is never a challenge attempt", async () => {
    const { post, log, close } = await lessonApp();
    const miss = await (await post("/lesson-sqli/practice", { source: SQLI.guided.start })).json();
    const hit = await (await post("/lesson-sqli/practice", { source: SQLI.guided.solution })).json();
    close();
    assert.equal(miss.passed, false);
    assert.deepEqual(miss.failedRules, ["sqli.uses-parameterised-query"]);
    assert.equal(hit.passed, true);
    assert.equal(hit.attemptNo, 2);
    assert.ok(log.every(e => e.type !== "challenge.attempted"), "a lesson must not feed BKT");
    assert.ok(log.every(e => !JSON.stringify(e).includes("db.query(sql")), "no learner code in the log");
  });

  test("show me is offered only after two real tries", async () => {
    const { post, close } = await lessonApp();
    const early = await post("/lesson-sqli/reveal");
    const first = await (await post("/lesson-sqli/practice", { source: SQLI.guided.start })).json();
    const second = await (await post("/lesson-sqli/practice", { source: SQLI.guided.start })).json();
    const late = await post("/lesson-sqli/reveal");
    const body = await late.json();
    close();
    assert.equal(early.status, 409);
    assert.equal(first.canReveal, false);
    assert.equal(second.canReveal, true);
    assert.equal(late.status, 200);
    assert.equal(body.solution, SQLI.guided.solution);
  });

  test("a check answer comes back with its explanation, and the right one when it was wrong", async () => {
    const { post, log, close } = await lessonApp();
    const wrong = await (await post("/lesson-sqli/check", { questionId: "obrien", choice: "error" })).json();
    const bad = await post("/lesson-sqli/check", { questionId: "obrien", choice: "nonsense" });
    close();
    assert.equal(wrong.correct, false);
    assert.equal(wrong.explanation, SQLI.check[0].explanations.error);
    assert.equal(wrong.answer, "found");
    assert.ok(wrong.answerExplanation);
    assert.doesNotMatch(wrong.answerExplanation, /^Right/);
    assert.equal(bad.status, 400);
    assert.equal(log.filter(e => e.type === "lesson.checked").length, 1);
  });

  test("it cannot be filed until the guided fix is done and every question answered", async () => {
    const { post, log, close } = await lessonApp();
    const tooSoon = await post("/lesson-sqli/complete");
    await post("/lesson-sqli/practice", { source: SQLI.guided.solution });
    const stillSoon = await post("/lesson-sqli/complete");
    for (const q of SQLI.check) await post("/lesson-sqli/check", { questionId: q.id, choice: q.options[0].id });
    const filed = await post("/lesson-sqli/complete", { durationMs: 240000 });
    close();
    assert.equal(tooSoon.status, 409);
    assert.equal(stillSoon.status, 409);
    assert.equal(filed.status, 200);
    const done = log.find(e => e.type === "lesson.completed");
    assert.equal(done.payload.reread, false);
    assert.equal(done.payload.durationMs, 240000);
    assert.equal((await filed.json()).xpAwarded, 50);
    const xp = log.filter(e => e.type === "xp.awarded");
    assert.deepEqual(xp.map(e => [e.payload.amount, e.payload.reason]), [[50, "lesson"]]);
  });

  test("a replay can be filed straight away, says so, and earns no XP", async () => {
    const { post, log, close } = await lessonApp({ done: ["lesson-sqli"] });
    const res = await post("/lesson-sqli/complete");
    const body = await res.json();
    close();
    assert.equal(res.status, 200);
    assert.equal(log.find(e => e.type === "lesson.completed").payload.reread, true);
    assert.equal(body.xpAwarded, 0);
    assert.equal(log.filter(e => e.type === "xp.awarded").length, 0, "lessons cannot be farmed");
  });

  test("the manual lists every lesson with whether it is filed", async () => {
    const { base, close } = await lessonApp({ done: ["lesson-xss"] });
    const { lessons } = await (await fetch(base)).json();
    close();
    assert.deepEqual(lessons.map(l => [l.id, l.completed]),
      [["lesson-sqli", false], ["lesson-xss", true], ["lesson-csrf", false]]);
  });
});
