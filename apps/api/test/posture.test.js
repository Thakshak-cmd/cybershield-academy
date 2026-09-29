import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { derivePosture, postureChange } from "@cybershield/shared";
import { resolveAttempt } from "../src/attempt-logic.js";
import { postureCatalogue } from "../src/record-attempt.js";
import { BOSS_REFERENCE_PATCHES } from "../../../content/reference-patches.js";

let seq = 0;
const ev = (type, payload) => ({
  schemaVersion: 1, subjectId: "x", sessionId: "s1", seq: ++seq,
  occurredAt: "2026-09-29T10:00:00Z", isStudyParticipant: true, type, payload
});
const attempt = (challengeId, correct) => ev("challenge.attempted", { challengeId, correct });
const clear = challengeId => [attempt(challengeId, true), ev("challenge.completed", { challengeId })];

const CATALOGUE = { holes: ["a", "b", "c", "d"], capstones: ["boss"] };

describe("posture", () => {
  test("a learner who has done nothing is under attack", () => {
    const p = derivePosture([], CATALOGUE);
    assert.equal(p.score, 0);
    assert.equal(p.label, "under attack");
    assert.equal(p.total, 4);
  });

  test("closing holes raises it, and holding the capstone completes it", () => {
    seq = 0;
    const half = derivePosture([...clear("a"), ...clear("b")], CATALOGUE);
    assert.equal(half.score, 40);
    assert.equal(half.closed, 2);

    const all = derivePosture(["a", "b", "c", "d", "boss"].flatMap(clear), CATALOGUE);
    assert.equal(all.score, 100);
    assert.equal(all.label, "hardened");
    assert.equal(all.capstoneHeld, true);
  });

  test("a failed attempt on a real hole is an incident that costs posture", () => {
    seq = 0;
    const p = derivePosture([...clear("a"), ...clear("b"), attempt("c", false)], CATALOGUE);
    assert.equal(p.score, 37);
    assert.deepEqual(p.incidents.map(i => i.challengeId), ["c"]);
  });

  test("failing a drill is not an incident", () => {
    seq = 0;
    const p = derivePosture([...clear("a"), attempt("drill-1", false)], CATALOGUE);
    assert.equal(p.incidents.length, 0);
    assert.equal(p.score, 20);
  });

  test("incidents fade once they fall out of the recent window", () => {
    // Early failure is how this material is learned; it must not scar for ever.
    seq = 0;
    const events = [attempt("c", false), attempt("c", false),
                    ...["a", "b", "d"].flatMap(clear), ...clear("c"), ...clear("boss"),
                    attempt("a", true), attempt("b", true), attempt("d", true)];
    assert.equal(derivePosture(events, CATALOGUE).incidents.length, 0);
  });

  test("the penalty is capped, so a bad run cannot bury real progress", () => {
    seq = 0;
    const events = [...["a", "b", "c"].flatMap(clear),
                    ...Array.from({ length: 8 }, () => attempt("d", false))];
    assert.equal(derivePosture(events, CATALOGUE).score, 60 - 15);
  });

  test("postureChange reports what the latest attempt did", () => {
    seq = 0;
    const events = [...clear("a"), attempt("b", false)];
    const change = postureChange(events, CATALOGUE);
    assert.equal(change.delta, -3);
    assert.equal(change.score, 17);
    assert.equal(change.incident, true);
  });

  test("a failure at zero is still an incident, though the score cannot fall", () => {
    // Early failures are the common case, and the consequence must show for them.
    seq = 0;
    const change = postureChange([attempt("a", false)], CATALOGUE);
    assert.equal(change.delta, 0);
    assert.equal(change.incident, true);
  });

  test("failing a drill is not an incident in the change either", () => {
    seq = 0;
    assert.equal(postureChange([attempt("drill-1", false)], CATALOGUE).incident, false);
  });

  test("the catalogue excludes drills from holes and names the capstone", () => {
    const cat = postureCatalogue([
      { id: "sec-101" }, { id: "spot-101", isDrill: true }, { id: "sec-900", isBoss: true }
    ]);
    assert.deepEqual(cat, { holes: ["sec-101"], capstones: ["sec-900"] });
  });
});

describe("capstone attempts", () => {
  const boss = JSON.parse(
    readFileSync(new URL("../../../content/challenges/sec-900.json", import.meta.url), "utf8")
  );
  const [winning, oneTechnique] = BOSS_REFERENCE_PATCHES["sec-900"];
  const ctx = { subjectId: "subj", sessionId: "sess", isStudyParticipant: true };

  test("beating it completes it and pays its XP", () => {
    const out = resolveAttempt(boss, winning.sources, ctx);
    assert.equal(out.verdict.passed, true);
    assert.equal(out.newlySolved, true);
    assert.equal(out.xpAwarded, boss.xp.firstAttempt);
    assert.deepEqual(out.events.map(e => e.type),
      ["challenge.attempted", "challenge.completed", "xp.awarded"]);
    assert.deepEqual(out.stages?.compromised, []);
  });

  test("the attempt number is real, not always the first", () => {
    const out = resolveAttempt(boss, winning.sources, { ...ctx, priorAttempts: 2 });
    assert.equal(out.events[0].payload.attemptNo, 3);
    assert.equal(out.xpAwarded, boss.xp.retry);
  });

  test("a partial fix fails with failed rules prefixed by stage", () => {
    const out = resolveAttempt(boss, oneTechnique.sources, ctx);
    assert.equal(out.verdict.passed, false);
    assert.ok(out.verdict.failedRules.length > 0);
    assert.ok(out.verdict.failedRules.every(r => /^(storefront|checkout):/.test(r)),
      out.verdict.failedRules.join(", "));
    assert.deepEqual(out.stages?.secured, ["database"]);
  });

  test("it never counts as evidence for BKT, even unaided on the first try", () => {
    const out = resolveAttempt(boss, winning.sources, ctx);
    assert.equal(out.events[0].payload.countsForBkt, false);
    assert.equal(out.bktObservation, null);
  });

  test("the verdict totals every stage's suites", () => {
    const out = resolveAttempt(boss, winning.sources, ctx);
    const rules = boss.stages.flatMap(s => s.rules).length;
    assert.equal(out.verdict.security.total + out.verdict.functional.total, rules);
  });

  test("a stage that does not parse is reported with its stage, in the usual shape", () => {
    const out = resolveAttempt(boss, { ...winning.sources, storefront: "function (" }, ctx);
    assert.equal(out.verdict.passed, false);
    assert.match(out.verdict.parseError?.message ?? "", /^storefront: /);
  });
});
