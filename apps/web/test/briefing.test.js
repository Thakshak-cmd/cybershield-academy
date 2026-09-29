import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { composeBriefing, ago } from "../src/briefing.js";

const base = {
  handle: "night_owl",
  mastery: { sqli: 0.42, xss: 0.15, csrf: 0.3 },
  capstoneUnlocked: false,
  posture: { capstoneHeld: false },
  titles: { "sec-201": { title: "The review page" }, "spot-101": { title: "Which line?" } },
  nodes: [{ id: "sec-201" }, { id: "spot-101", isDrill: true }]
};

describe("the shift briefing", () => {
  test("a first shift welcomes and sets the scene", () => {
    const { lines } = composeBriefing({ ...base, recent: [] });
    assert.match(lines[0], /^First shift, night_owl\?/);
    assert.match(lines[1], /three kinds of hole/);
  });

  test("names the weakest skill in the fiction's words, not the model's", () => {
    const { lines } = composeBriefing({ ...base, recent: [] });
    assert.match(lines[lines.length - 1], /thinnest on injected scripts/);
  });

  test("a fix that held is reported as held", () => {
    const { lines } = composeBriefing({ ...base, recent: [{ kind: "attempt", challengeId: "sec-201", correct: true }] });
    assert.match(lines[0], /^Welcome back/);
    assert.match(lines[1], /Your fix to "The review page" held/);
  });

  test("a failed patch on a real hole says the attacker still has a way in", () => {
    const { lines } = composeBriefing({ ...base, recent: [{ kind: "attempt", challengeId: "sec-201", correct: false }] });
    assert.match(lines[1], /didn't hold\. The attacker still has a way in/);
  });

  test("a missed drill never claims something is open", () => {
    // Saying otherwise would be the fiction inventing a fact.
    const { lines } = composeBriefing({ ...base, recent: [{ kind: "attempt", challengeId: "spot-101", correct: false }] });
    assert.doesNotMatch(lines.join(" "), /way in/);
    assert.match(lines[1], /practice/);
  });

  test("the latest attempt is judged, not a badge that came after it", () => {
    const recent = [{ kind: "badge", badgeId: "first-patch" },
                    { kind: "attempt", challengeId: "sec-201", correct: true }];
    assert.match(composeBriefing({ ...base, recent }).lines[1], /held/);
  });

  test("an unlocked capstone is called for, and a held one is not", () => {
    const open = composeBriefing({ ...base, capstoneUnlocked: true, recent: [] });
    assert.equal(open.capstoneCall, true);
    assert.match(open.lines[1], /Aurora Breach is open/);

    const held = composeBriefing({ ...base, capstoneUnlocked: true, posture: { capstoneHeld: true }, recent: [] });
    assert.equal(held.capstoneCall, false);
    assert.match(held.lines[1], /^Aurora held/);
    assert.doesNotMatch(held.lines.join(" "), /thinnest/);
  });

  test("a tie names no weakest skill, since there is none", () => {
    const { lines } = composeBriefing({ ...base, mastery: { sqli: 0.15, xss: 0.15, csrf: 0.15 }, recent: [] });
    assert.doesNotMatch(lines.join(" "), /thinnest/);
    assert.match(lines[lines.length - 1], /No read yet/);
  });

  test("without the model it does not guess at the weakest skill", () => {
    const { lines } = composeBriefing({ ...base, degraded: true, recent: [] });
    assert.doesNotMatch(lines.join(" "), /thinnest/);
  });
});

describe("ago", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  test("is coarse", () => {
    assert.equal(ago("2026-09-29T11:59:30Z", now), "just now");
    assert.equal(ago("2026-09-29T11:45:00Z", now), "15m ago");
    assert.equal(ago("2026-09-29T09:00:00Z", now), "3h ago");
    assert.equal(ago("2026-09-27T12:00:00Z", now), "2d ago");
  });
});
