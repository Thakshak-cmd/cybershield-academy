import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { earnedBadges, BADGES } from "../../../content/badges.js";

const catalogue = [
  { id: "spot-301", skill: "csrf", isDrill: true },
  { id: "sec-301", skill: "csrf" },
  { id: "harden-301", skill: "csrf" },
  { id: "sec-101", skill: "sqli" },
  { id: "sec-900", skill: "sqli", isBoss: true }
];
const state = over => ({ cleared: [], mastery: {}, catalogue, unaidedFirstAttempts: 0, ...over });

describe("badges", () => {
  test("pointing at a line is not closing a hole", () => {
    // A spot drill alone must not award First Patch.
    assert.ok(!earnedBadges(state({ cleared: ["spot-301"] })).includes("first-patch"));
    assert.ok(earnedBadges(state({ cleared: ["sec-301"] })).includes("first-patch"));
  });

  test("a whole-skill badge ignores drills", () => {
    // Every real csrf challenge cleared, the drill untouched: still earned.
    const earned = earnedBadges(state({ cleared: ["sec-301", "harden-301"] }));
    assert.ok(earned.includes("csrf-warden"));
  });

  test("a whole-skill badge needs every real challenge", () => {
    assert.ok(!earnedBadges(state({ cleared: ["sec-301"] })).includes("csrf-warden"));
  });

  test("the boss does not count towards a skill badge", () => {
    assert.ok(earnedBadges(state({ cleared: ["sec-101"] })).includes("sqli-defender"));
  });

  test("the capstone badge needs the boss", () => {
    assert.ok(!earnedBadges(state({ cleared: ["sec-101", "sec-301", "harden-301"] })).includes("aurora-held"));
    assert.ok(earnedBadges(state({ cleared: ["sec-900"] })).includes("aurora-held"));
  });

  test("No Hints Needed counts unaided first attempts", () => {
    assert.ok(!earnedBadges(state({ unaidedFirstAttempts: 2 })).includes("unaided"));
    assert.ok(earnedBadges(state({ unaidedFirstAttempts: 3 })).includes("unaided"));
  });

  test("a predicate that throws does not stop the others", () => {
    // Otherwise one bad rule would silently stop a learner earning anything.
    const broken = { ...state({ cleared: ["sec-301"] }), catalogue: null };
    assert.doesNotThrow(() => earnedBadges(/** @type {any} */ (broken)));
  });

  test("every badge has art and copy", () => {
    for (const b of BADGES) {
      assert.ok(b.name && b.description && b.art, `${b.id} is incomplete`);
    }
  });
});
