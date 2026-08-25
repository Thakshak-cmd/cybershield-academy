// @ts-check
import { Counter, Event } from "./models/index.js";

/**
 * Reserve a contiguous block of sequence numbers for one subject.
 *
 * A single atomic $inc for the whole batch, so concurrent requests can never be
 * handed overlapping ranges. Ordering by (subjectId, seq) is what makes the log
 * replayable in the order things actually happened -- timestamps are not reliable
 * for this, and BKT is a sequential model.
 */
export async function reserveSeq(subjectId, count) {
  if (count < 1) return [];
  const doc = /** @type {{ seq: number } | null} */ (
    await Counter.findByIdAndUpdate(
      subjectId,
      { $inc: { seq: count } },
      { upsert: true, new: true }
    ).lean()
  );

  // upsert + new should always return a document, but a failed upsert race returns
  // null. Reading .seq off that would throw inside the event append and silently
  // lose the batch, so fail loudly instead -- the log is the source of truth and a
  // dropped write is not recoverable.
  if (!doc || typeof doc.seq !== "number") {
    throw new Error(`Could not reserve sequence numbers for ${subjectId}`);
  }

  const end = doc.seq;             // value AFTER incrementing
  const start = end - count + 1;
  return Array.from({ length: count }, (_, i) => start + i);
}

/**
 * Append events to the log, assigning each its position in the subject's sequence.
 *
 * `ordered: true` means a duplicate-key collision on (subjectId, seq) stops the
 * batch rather than silently writing a partial, out-of-order run.
 *
 * @param {string} subjectId
 * @param {import("@cybershield/shared").DraftEvent[]} events
 * @returns {Promise<import("@cybershield/shared").TelemetryEvent[]>}
 */
export async function append(subjectId, events) {
  if (!events.length) return [];
  const seqs = await reserveSeq(subjectId, events.length);
  const withSeq = events.map((e, i) => ({ ...e, seq: seqs[i] }));
  await Event.insertMany(withSeq, { ordered: true });
  return withSeq;
}

/** Count prior attempts at a challenge, which is what determines attemptNo. */
export async function countAttempts(subjectId, challengeId) {
  return Event.countDocuments({
    subjectId,
    type: "challenge.attempted",
    "payload.challengeId": challengeId
  });
}

/** Hints taken on the current run at a challenge. */
export async function countHints(subjectId, challengeId) {
  return Event.countDocuments({
    subjectId,
    type: "hint.requested",
    "payload.challengeId": challengeId
  });
}
