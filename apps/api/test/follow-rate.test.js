import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deriveFollowed, followRate } from "@cybershield/shared";

/**
 * Whether the learner took the recommendation is derived from the log rather than
 * stored on the event, because the log is append-only and backfilling a field is a
 * mutation. These tests pin the derivation, since it is the measurement that
 * connects the adaptive model to the platform's behaviour.
 */

let seq = 0;
const ev = (type, challengeId) => ({
  schemaVersion: 1,
  subjectId: "s1",
  sessionId: "sess",
  seq: ++seq,
  occurredAt: new Date(),
  isStudyParticipant: true,
  type,
  payload: { challengeId }
});

const reset = () => { seq = 0; };

describe("deriveFollowed", () => {
  test("a matching start counts as followed", () => {
    reset();
    const log = [ev("recommendation.served", "a"), ev("challenge.started", "a")];
    assert.deepEqual(deriveFollowed(log).map(r => r.followed), [true]);
  });

  test("a different start counts as not followed", () => {
    reset();
    const log = [ev("recommendation.served", "a"), ev("challenge.started", "b")];
    const [r] = deriveFollowed(log);
    assert.equal(r.followed, false);
    assert.equal(r.started, "b");
  });

  test("only the FIRST start after a recommendation decides it", () => {
    reset();
    // Ignoring the advice and then wandering onto the suggested challenge three
    // challenges later is not following the recommendation.
    const log = [
      ev("recommendation.served", "a"),
      ev("challenge.started", "b"),
      ev("challenge.started", "a")
    ];
    assert.equal(deriveFollowed(log)[0].followed, false);
  });

  test("a recommendation with nothing after it is null, not false", () => {
    reset();
    // The session ended. Counting that as a refusal would bias the follow rate
    // down by exactly one per session.
    const log = [ev("recommendation.served", "a")];
    const [r] = deriveFollowed(log);
    assert.equal(r.followed, null);
    assert.equal(r.started, null);
  });

  test("events are ordered by seq, not by arrival", () => {
    reset();
    const rec = ev("recommendation.served", "a");
    const start = ev("challenge.started", "a");
    // Shuffled, as a bulk export or a concurrent write could deliver them.
    assert.equal(deriveFollowed([start, rec])[0].followed, true);
  });

  test("interleaved events between the pair are ignored", () => {
    reset();
    const log = [
      ev("recommendation.served", "a"),
      ev("hint.requested", "z"),
      ev("xp.awarded", null),
      ev("challenge.started", "a")
    ];
    assert.equal(deriveFollowed(log)[0].followed, true);
  });

  test("each recommendation is resolved independently", () => {
    reset();
    const log = [
      ev("recommendation.served", "a"), ev("challenge.started", "a"),
      ev("recommendation.served", "b"), ev("challenge.started", "c"),
      ev("recommendation.served", "d"), ev("challenge.started", "d")
    ];
    assert.deepEqual(deriveFollowed(log).map(r => r.followed), [true, false, true]);
  });

  test("a log with no recommendations yields nothing", () => {
    reset();
    assert.deepEqual(deriveFollowed([ev("challenge.started", "a")]), []);
  });
});

describe("followRate", () => {
  test("counts only resolvable recommendations", () => {
    reset();
    const log = [
      ev("recommendation.served", "a"), ev("challenge.started", "a"),
      ev("recommendation.served", "b"), ev("challenge.started", "c"),
      ev("recommendation.served", "d")   // unresolved: session ended
    ];
    // 1 of 2 resolvable, not 1 of 3.
    assert.equal(followRate(log), 0.5);
  });

  test("an empty result is NaN, never zero", () => {
    reset();
    // Zero would read as "the learner ignored every suggestion" when in fact
    // nothing could be measured.
    assert.ok(Number.isNaN(followRate([])));
    assert.ok(Number.isNaN(followRate([ev("recommendation.served", "a")])));
  });

  test("a learner who follows everything scores 1", () => {
    reset();
    const log = [
      ev("recommendation.served", "a"), ev("challenge.started", "a"),
      ev("recommendation.served", "b"), ev("challenge.started", "b")
    ];
    assert.equal(followRate(log), 1);
  });
});
