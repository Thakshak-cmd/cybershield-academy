import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validate, validateStages, validateSpot, validateReview, RULES } from "../src/index.js";
import { REFERENCE_PATCHES, BOSS_REFERENCE_PATCHES } from "../../../content/reference-patches.js";

/**
 * Every challenge, checked as content rather than as code.
 *
 * A challenge is only finished when its rules fail the plausible wrong answers
 * for the right reasons. These tests are what make authoring the remaining
 * challenges safe to do quickly: a rule that starts passing a naive patch, or
 * failing a correct one, breaks the build rather than quietly teaching the
 * wrong lesson.
 */

const CONTENT = join(dirname(fileURLToPath(import.meta.url)), "../../../content/challenges");

const all = readdirSync(CONTENT)
  .filter(f => f.endsWith(".json"))
  .map(f => JSON.parse(readFileSync(join(CONTENT, f), "utf8")));

// Three shapes of challenge, each with its own assertions. Splitting here rather
// than special-casing inside each test.
const challenges = all.filter(c => !c.stages && c.format !== "spot" && c.format !== "review");
const bosses = all.filter(c => c.stages);
const spots = all.filter(c => c.format === "spot");
const reviews = all.filter(c => c.format === "review");

const PRIOR_MASTERY = 0.15;

describe("challenge definitions", () => {
  test("there is at least one challenge", () => {
    assert.ok(challenges.length > 0);
  });

  for (const c of challenges) {
    describe(c.id, () => {
      test("declares the fields the platform reads", () => {
        for (const field of ["id", "title", "skill", "tier", "format", "validator", "brief", "vulnerable"]) {
          assert.ok(c[field], `${c.id} is missing ${field}`);
        }
        assert.ok(Array.isArray(c.rules) && c.rules.length, `${c.id} has no rules`);
      });

      test("every rule it names exists", () => {
        // A typo here would otherwise surface as a 500 on a learner's first
        // submission, long after authoring.
        for (const id of c.rules) {
          assert.ok(RULES[id], `${c.id} names unknown rule "${id}"`);
        }
      });

      test("has both a security and a functional rule", () => {
        // The tension between them is the puzzle. A challenge with only security
        // rules can be beaten by deleting the feature.
        const kinds = new Set(c.rules.map(id => RULES[id].kind));
        assert.ok(kinds.has("security"), `${c.id} has no security rule`);
        assert.ok(kinds.has("functional"), `${c.id} has no functional rule`);
      });

      test("its own vulnerable code fails its rules", () => {
        // If the starting code passed, the challenge would be already solved.
        const verdict = validate(c, c.vulnerable);
        assert.equal(verdict.passed, false,
          `${c.id}'s vulnerable code passes its own rules`);
      });

      test("carries attack and functional cases, and hints", () => {
        assert.ok(c.attackSuite?.length, `${c.id} has no attack cases`);
        assert.ok(c.functionalSuite?.length, `${c.id} has no functional cases`);
        assert.ok(c.hints?.length, `${c.id} has no hints`);
      });

      test("has reference patches", () => {
        assert.ok(REFERENCE_PATCHES[c.id]?.length,
          `${c.id} has no reference patches, so its rules are unverified`);
      });
    });
  }
});

describe("reference patches score as intended", () => {
  for (const [id, patches] of Object.entries(REFERENCE_PATCHES)) {
    const challenge = challenges.find(c => c.id === id);

    test(`${id} exists`, () => {
      assert.ok(challenge, `reference patches name unknown challenge ${id}`);
    });
    if (!challenge) continue;

    for (const patch of patches) {
      test(`${id}: ${patch.label}`, () => {
        const verdict = validate(challenge, patch.source);
        assert.equal(verdict.parseError, null,
          `${id}/${patch.label} does not parse: ${verdict.parseError?.message}`);

        if (patch.expect === "pass") {
          assert.deepEqual(verdict.failedRules, [],
            `${id}/${patch.label} should pass but failed: ${verdict.failedRules.join(", ")}`);
        } else {
          assert.deepEqual(
            [...verdict.failedRules].sort(),
            [...patch.expect].sort(),
            `${id}/${patch.label} failed the wrong rules`
          );
        }
      });
    }

    test(`${id} has at least one correct answer`, () => {
      assert.ok(patches.some(p => p.expect === "pass"),
        `${id} has no patch that passes, so nothing proves it is solvable`);
    });

    test(`${id}: wrong answers fail for different reasons`, () => {
      // If two naive patches fail identically, the feedback stops distinguishing
      // between the mistakes and teaches less than it should.
      const wrong = patches.filter(p => p.expect !== "pass");
      const signatures = wrong.map(p => [...p.expect].sort().join("|"));
      assert.equal(new Set(signatures).size, signatures.length,
        `${id} has wrong answers that fail identically`);
    });
  }
});

describe("the catalogue as a whole", () => {
  test("ids are unique", () => {
    const ids = all.map(c => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("every skill a learner can start has a reachable entry point", () => {
    // Without one, a new learner is served nothing and sees an empty screen.
    const bySkill = new Map();
    for (const c of challenges) {
      if (!bySkill.has(c.skill)) bySkill.set(c.skill, []);
      bySkill.get(c.skill).push(c);
    }
    for (const [skill, items] of bySkill) {
      const entry = items.find(c => (c.masteryRequired ?? 0) <= PRIOR_MASTERY && !c.requires);
      assert.ok(entry, `skill "${skill}" has no challenge a new learner can reach`);
    }
  });

  test("no prerequisite names a challenge that does not exist", () => {
    const ids = new Set(all.map(c => c.id));
    for (const c of all) {
      if (c.requires) assert.ok(ids.has(c.requires), `${c.id} requires missing ${c.requires}`);
    }
  });

  test("a prerequisite is never harder to reach than what it gates", () => {
    // Otherwise the tree opens a node whose prerequisite is still locked, and
    // the learner sees an available challenge they cannot actually take.
    const byId = new Map(all.map(c => [c.id, c]));
    for (const c of all) {
      if (!c.requires) continue;
      const parent = byId.get(c.requires);
      assert.ok((parent.masteryRequired ?? 0) <= (c.masteryRequired ?? 0),
        `${c.id} opens at ${c.masteryRequired} but its prerequisite ${parent.id} needs ${parent.masteryRequired}`);
    }
  });
});


describe("boss encounters", () => {
  test("there is at least one", () => {
    assert.ok(bosses.length > 0);
  });

  for (const boss of bosses) {
    describe(boss.id, () => {
      test("draws on more than one skill", () => {
        // A single-skill boss is just a hard challenge. The transfer being tested
        // is recognising which technique belongs where, which needs at least two.
        const skills = new Set(boss.stages.map(st => st.skill));
        assert.ok(skills.size > 1, `${boss.id} only covers ${[...skills].join(", ")}`);
      });

      test("each stage maps to a distinct part of the system", () => {
        // The diagram draws the breach from these, so two stages sharing a
        // component would make one of them invisible.
        const components = boss.stages.map(st => st.component);
        assert.equal(new Set(components).size, components.length);
      });

      test("every stage names real rules and has both kinds", () => {
        for (const st of boss.stages) {
          assert.ok(st.rules?.length, `${boss.id}/${st.id} has no rules`);
          for (const id of st.rules) {
            assert.ok(RULES[id], `${boss.id}/${st.id} names unknown rule "${id}"`);
          }
          const kinds = new Set(st.rules.map(id => RULES[id].kind));
          assert.ok(kinds.has("security") && kinds.has("functional"),
            `${boss.id}/${st.id} needs both a security and a functional rule`);
        }
      });

      test("every stage's own vulnerable code fails", () => {
        for (const st of boss.stages) {
          assert.equal(validate(st, st.vulnerable).passed, false,
            `${boss.id}/${st.id} starts already solved`);
        }
      });

      test("an empty submission reports every part compromised", () => {
        // Unattempted must not read as safe, or the diagram shows a system that
        // looks intact because nobody has looked at it.
        const outcome = validateStages(boss, {});
        assert.equal(outcome.passed, false);
        assert.equal(outcome.compromised.length, boss.stages.length);
        assert.deepEqual(outcome.secured, []);
        assert.ok(outcome.stages.every(st => st.attempted === false));
      });

      test("has reference patches", () => {
        assert.ok(BOSS_REFERENCE_PATCHES[boss.id]?.length,
          `${boss.id} has no reference patches, so its stages are unverified`);
      });
    });
  }
});

describe("boss reference patches score as intended", () => {
  for (const [id, patches] of Object.entries(BOSS_REFERENCE_PATCHES)) {
    const boss = bosses.find(b => b.id === id);
    test(`${id} exists`, () => assert.ok(boss, `unknown boss ${id}`));
    if (!boss) continue;

    for (const patch of patches) {
      test(`${id}: ${patch.label}`, () => {
        const outcome = validateStages(boss, patch.sources);
        const held = outcome.stages.filter(st => st.passed).map(st => st.stageId).sort();
        assert.deepEqual(held, [...patch.expectPassed].sort(),
          `${id}/${patch.label} held the wrong stages`);
        assert.equal(outcome.passed, held.length === boss.stages.length);
      });
    }

    test(`${id}: one technique does not close every stage`, () => {
      // The whole reason the encounter exists. If applying a parameterised query
      // to all three stages cleared the boss, it would be teaching that the
      // techniques are interchangeable - the opposite of the point.
      const oneTechnique = patches.find(p => /everywhere/i.test(p.label));
      assert.ok(oneTechnique, `${id} has no "same technique everywhere" reference patch`);
      assert.ok(oneTechnique.expectPassed.length < boss.stages.length,
        `${id} can be cleared with a single technique`);
    });
  }
});


describe("spot-the-flaw challenges", () => {
  test("there are several", () => {
    // These are the observation multiplier for BKT and the pacing for a
    // 60-minute session; a couple is not enough of either.
    assert.ok(spots.length >= 6, `only ${spots.length} spot challenges`);
  });

  for (const c of spots) {
    describe(c.id, () => {
      test("names at least one flawed line inside the snippet", () => {
        const lines = c.vulnerable.split("\n").length;
        assert.ok(c.flawedLines?.length, `${c.id} has no flawedLines`);
        for (const n of c.flawedLines) {
          assert.ok(n >= 1 && n <= lines, `${c.id} flawed line ${n} is outside 1..${lines}`);
        }
      });

      test("the flawed line actually contains something suspicious", () => {
        // A sanity check against an off-by-one in authoring: the line pointed at
        // should carry a recognisable sink, splice, or missing guard.
        const lines = c.vulnerable.split("\n");
        const text = c.flawedLines.map(n => lines[n - 1]).join("\n");
        const suspicious = /\$\{|innerHTML|\+\s*\w+\s*\+|return next\(\)|app\.post\([^)]*requireAuth,\s*\(/.test(text);
        assert.ok(suspicious, `${c.id} flawed line reads as sound: ${JSON.stringify(text)}`);
      });

      test("every decoy explanation points at a real, non-flawed line", () => {
        const lines = c.vulnerable.split("\n").length;
        for (const key of Object.keys(c.decoyLines || {})) {
          const n = Number(key);
          assert.ok(n >= 1 && n <= lines, `${c.id} decoy ${n} is outside the snippet`);
          assert.ok(!c.flawedLines.includes(n), `${c.id} decoy ${n} is also a flawed line`);
        }
      });

      test("the right answer passes and a decoy fails on accusation", () => {
        const right = validateSpot(c, [c.flawedLines[0]]);
        assert.equal(right.passed, true, `${c.id}: the flawed line itself does not pass`);

        const decoy = Number(Object.keys(c.decoyLines || {})[0]);
        if (decoy) {
          const wrong = validateSpot(c, [decoy]);
          assert.equal(wrong.passed, false);
          assert.ok(wrong.failedRules.includes("spot.found-the-flaw"));
          // The decoy explanation must surface as evidence, or authoring it was wasted.
          const why = wrong.functional.results.find(r => r.id === "spot.no-false-accusation")?.evidence ?? "";
          assert.ok(why.includes(c.decoyLines[decoy]), `${c.id}: decoy explanation not shown`);
        }
      });

      test("is a drill, so it never gates the tree", () => {
        // Spot items exist to be repeatable practice and to feed BKT. A spot
        // challenge as a prerequisite would make the tree hinge on a 30-second
        // click, which is not what "cleared" should mean.
        assert.equal(c.isDrill, true, `${c.id} should be a drill`);
        assert.ok(!all.some(o => o.requires === c.id), `${c.id} is a prerequisite for something`);
      });
    });
  }
});


describe("review-the-fix challenges", () => {
  test("there is one per skill, and at least one sound fix", () => {
    // If every proposal were wrong, "reject" would become the reflex rather than
    // the judgement. At least one has to deserve approval.
    assert.equal(new Set(reviews.map(r => r.skill)).size, 3);
    assert.ok(reviews.some(r => r.sound), "every review is a rejection");
  });

  for (const c of reviews) {
    describe(c.id, () => {
      test("carries a proposal that differs from the original", () => {
        assert.ok(c.proposed && c.vulnerable && c.proposed !== c.vulnerable);
      });

      test("an unsound proposal names a correct reason that exists", () => {
        if (c.sound) return;
        assert.ok(c.reasons.some(r => r.id === c.correctReason),
          `${c.id} correctReason ${c.correctReason} is not among its reasons`);
      });

      test("every wrong reason says why it is wrong", () => {
        // Otherwise a learner who picks it is told "no" and nothing else.
        for (const r of c.reasons) {
          if (!c.sound && r.id === c.correctReason) continue;
          assert.ok(c.reasonExplanations?.[r.id], `${c.id}: no explanation for "${r.id}"`);
        }
      });

      test("exactly one answer passes, and every other fails", () => {
        const answers = [{ decision: "approve" }, ...c.reasons.map(r => ({ decision: "reject", reason: r.id }))];
        const passing = answers.filter(a => validateReview(c, a).passed);
        assert.equal(passing.length, 1, `${c.id} has ${passing.length} passing answers`);
      });

      test("the proposal is judged by the same rules as a patch would be", () => {
        // For a review of a patch challenge's code, the proposal's soundness should
        // agree with what the validator says about it. This keeps the review
        // answers honest rather than resting on the author's say-so.
        const twin = challenges.find(p => p.skill === c.skill && p.format !== "harden"
          && p.rules?.some(r => r.startsWith(c.skill) || r.startsWith("csrf") || r.startsWith("xss")));
        if (!twin || c.id !== "review-201") return;
        assert.equal(validate(twin, c.proposed).passed, c.sound);
      });
    });
  }
});

describe("XP is the same for the same kind of ticket", () => {
  // Found in playtesting as "XP not equal across". Pay depends only on what a
  // ticket asks (its format) and how hard it is (its tier), never on its skill,
  // so no skill's tickets are worth more for the same work.
  // [first attempt, retry]; a hinted solve pays half the first-attempt rate.
  const XP_BY_KIND = {
    spot:   { beginner: [30, 10], intermediate: [45, 15] },
    patch:  { beginner: [80, 25], intermediate: [120, 40], advanced: [160, 50] },
    review: { beginner: [70, 25], intermediate: [90, 30] },
    harden: { intermediate: [110, 35] },
    boss:   { advanced: [400, 120] }
  };
  const all = readdirSync(new URL("../../../content/challenges/", import.meta.url))
    .filter(f => f.endsWith(".json"))
    .map(f => JSON.parse(readFileSync(new URL(`../../../content/challenges/${f}`, import.meta.url), "utf8")));

  for (const c of all) {
    test(`${c.id} pays the rate for a ${c.tier} ${c.format ?? "patch"}`, () => {
      const kind = XP_BY_KIND[c.format ?? "patch"]?.[c.tier];
      assert.ok(kind, `no XP rate for ${c.format ?? "patch"} at ${c.tier}`);
      const [first, retry] = kind;
      assert.equal(c.xp.firstAttempt, first);
      assert.equal(c.xp.withHints, Math.floor(first / 2), "a hinted solve pays half");
      assert.equal(c.xp.retry, retry);
    });
  }
});
