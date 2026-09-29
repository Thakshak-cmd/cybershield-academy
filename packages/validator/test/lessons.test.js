import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { validate } from "../src/index.js";
import { LESSONS } from "../../../content/lessons.js";
import { REFERENCE_PATCHES } from "../../../content/reference-patches.js";

const dir = new URL("../../../content/challenges/", import.meta.url);
const challenges = readdirSync(dir).filter(f => f.endsWith(".json"))
  .map(f => JSON.parse(readFileSync(new URL(f, dir), "utf8")));
const def = l => ({ id: l.id, rules: l.guided.rules, meta: l.guided.meta });

describe("lessons", () => {
  test("every skill with tickets has exactly one lesson", () => {
    const skills = [...new Set(challenges.filter(c => !c.isBoss).map(c => c.skill))].sort();
    assert.deepEqual(LESSONS.map(l => l.skill).sort(), skills);
  });

  for (const lesson of LESSONS) {
    describe(lesson.id, () => {
      test("the guided fix starts failing and the solution passes", () => {
        const start = validate(def(lesson), lesson.guided.start);
        const end = validate(def(lesson), lesson.guided.solution);
        assert.equal(start.passed, false);
        assert.ok(start.failedRules.length > 0);
        assert.equal(start.parseError, null, "the starting code must parse, or the learner starts from a broken file");
        assert.equal(end.passed, true, end.failedRules.join(", "));
      });

      test("the worked example is not any ticket's answer", () => {
        // A guided fix that was a ticket would turn the first unaided attempt --
        // the observation BKT trains on -- into a copy.
        const norm = s => s.replace(/\s+/g, " ").trim();
        for (const c of challenges) {
          assert.notEqual(norm(c.vulnerable ?? ""), norm(lesson.guided.start), `matches ${c.id}`);
        }
        for (const [id, patches] of Object.entries(REFERENCE_PATCHES)) {
          for (const p of patches) {
            assert.notEqual(norm(p.source ?? ""), norm(lesson.guided.solution), `matches a reference patch for ${id}`);
          }
        }
      });

      test("each check question has one answer and explains every option", () => {
        assert.ok(lesson.check.length >= 1);
        for (const q of lesson.check) {
          const ids = q.options.map(o => o.id);
          assert.ok(ids.includes(q.answer), `${q.id}: the answer is not an option`);
          assert.equal(new Set(ids).size, ids.length, `${q.id}: duplicate option ids`);
          for (const id of ids) assert.ok(q.explanations[id], `${q.id}: no explanation for ${id}`);
        }
      });

      test("has theory, a demo and a guided fix", () => {
        assert.ok(lesson.theory.length >= 2);
        assert.equal(lesson.demo, lesson.skill);
        assert.ok(lesson.guided.steps.length >= 2);
      });
    });
  }
});
