import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validate, RULES } from "../src/index.js";
import { REFERENCE_PATCHES } from "../../../content/reference-patches.js";

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

const challenges = readdirSync(CONTENT)
  .filter(f => f.endsWith(".json"))
  .map(f => JSON.parse(readFileSync(join(CONTENT, f), "utf8")));

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
    const ids = challenges.map(c => c.id);
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
    const ids = new Set(challenges.map(c => c.id));
    for (const c of challenges) {
      if (c.requires) assert.ok(ids.has(c.requires), `${c.id} requires missing ${c.requires}`);
    }
  });

  test("a prerequisite is never harder to reach than what it gates", () => {
    // Otherwise the tree opens a node whose prerequisite is still locked, and
    // the learner sees an available challenge they cannot actually take.
    const byId = new Map(challenges.map(c => [c.id, c]));
    for (const c of challenges) {
      if (!c.requires) continue;
      const parent = byId.get(c.requires);
      assert.ok((parent.masteryRequired ?? 0) <= (c.masteryRequired ?? 0),
        `${c.id} opens at ${c.masteryRequired} but its prerequisite ${parent.id} needs ${parent.masteryRequired}`);
    }
  });
});
