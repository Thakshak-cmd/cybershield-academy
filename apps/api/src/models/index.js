import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * Accounts.
 *
 * Study participants are registered under a pseudonymous handle, never a real name
 * or personal email. The mapping from handle to a real person lives in the
 * researcher's separate consent record, outside this database, per the approved
 * ethics protocol. Nothing here can re-identify a participant on its own.
 */
const UserSchema = new Schema({
  handle: { type: String, required: true, unique: true, trim: true },
  passwordHash: { type: String, required: true },
  subjectId: { type: String, required: true, unique: true, index: true },
  isStudyParticipant: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },

  // Brute-force state, kept on the account rather than in process memory: a
  // serverless invocation may be a fresh container, so a module-level counter
  // resets constantly and protects nothing.
  failedLogins: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null }
});

/**
 * The append-only event log. This is the source of truth.
 *
 * Nothing in this collection is ever updated or deleted in normal operation --
 * the one exception is a participant exercising their right to withdraw, which
 * removes their events entirely. Aggregates live in Progress and are always
 * rebuildable from here. See docs/telemetry-model.md.
 */
const EventSchema = new Schema({
  schemaVersion: { type: Number, required: true, default: 1 },
  type: { type: String, required: true, index: true },
  subjectId: { type: String, required: true, index: true },
  sessionId: { type: String, required: true },
  seq: { type: Number, required: true },
  occurredAt: { type: Date, required: true, default: Date.now },
  isStudyParticipant: { type: Boolean, required: true, default: false },
  payload: { type: Schema.Types.Mixed, default: {} }
}, { minimize: false });

// Ordering is by (subjectId, seq), never by timestamp -- clocks skew and
// millisecond timestamps collide. BKT is a sequential model, so this matters.
EventSchema.index({ subjectId: 1, seq: 1 }, { unique: true });

/**
 * Per-subject monotonic sequence allocator.
 *
 * A separate collection so a batch of events can reserve a contiguous range in a
 * single atomic $inc, rather than racing on a counter embedded in another document.
 */
const CounterSchema = new Schema({
  _id: { type: String },     // subjectId
  seq: { type: Number, default: 0 }
});

/** Challenge definitions, seeded from content/challenges/. */
const ChallengeSchema = new Schema({
  id: { type: String, required: true, unique: true, index: true },
  title: String,
  skill: { type: String, required: true, index: true },
  subSkill: String,
  tier: String,
  format: String,
  validator: String,
  repo: String,
  file: String,
  reportedBy: String,
  brief: String,
  vulnerable: String,

  // Skill-tree placement. The policy gates on these, so they belong with the
  // challenge rather than in a separate tree definition that could drift from it.
  masteryRequired: { type: Number, default: 0 },
  isDrill: { type: Boolean, default: false },
  isBoss: { type: Boolean, default: false },
  isCapstone: { type: Boolean, default: false },
  requires: { type: String, default: null },

  // Every skill an encounter draws on. A capstone is cross-skill by definition,
  // so the single `skill` field above is only its primary.
  skills: { type: [String], default: undefined },

  // A boss is several files patched against one incident. Mixed rather than a
  // sub-schema: a stage is the same shape the validator already understands, and
  // pinning it here would mean two definitions of that shape to keep in step.
  //
  // Mongoose silently drops fields the schema does not declare, so omitting this
  // seeded the encounter with its stages stripped and no error anywhere.
  stages: { type: [Schema.Types.Mixed], default: undefined },

  // Spot-the-flaw: which lines are the answer, and why the tempting wrong ones
  // are wrong. Mixed for decoyLines because its keys are line numbers.
  flawedLines: { type: [Number], default: undefined },
  decoyLines: { type: Schema.Types.Mixed, default: undefined },

  // Review the fix: a teammate's proposed patch and the verdict it deserves.
  // `sound`, `correctReason` and `reasonExplanations` are the answer, and never
  // leave the server -- see publicChallenge.
  proposed: { type: String, default: undefined },
  prAuthor: { type: String, default: undefined },
  sound: { type: Boolean, default: undefined },
  reasons: { type: [Schema.Types.Mixed], default: undefined },
  correctReason: { type: String, default: undefined },
  reasonExplanations: { type: Schema.Types.Mixed, default: undefined },

  meta: { type: Schema.Types.Mixed, default: {} },
  rules: { type: [String], default: [] },
  attackSuite: { type: [Schema.Types.Mixed], default: [] },
  functionalSuite: { type: [Schema.Types.Mixed], default: [] },
  hints: { type: [String], default: [] },
  xp: { type: Schema.Types.Mixed, default: {} }
});

/**
 * Derived projection -- a materialised view of the event log, never authoritative.
 *
 * It exists so a dashboard render is one read instead of a full log replay. If it
 * ever disagrees with the log, the log wins and this gets rebuilt.
 */
const ProgressSchema = new Schema({
  subjectId: { type: String, required: true, unique: true, index: true },
  xp: { type: Number, default: 0 },
  mastery: {
    sqli: { type: Number, default: 0.15 },
    xss:  { type: Number, default: 0.15 },
    csrf: { type: Number, default: 0.15 }
  },
  solvedChallenges: { type: [String], default: [] },
  // Nodes latch open: unlocking is recorded, and a later drop in mastery never
  // revokes it. See docs/game-design.md section 5, finding 3.
  unlockedNodes: { type: [String], default: [] },
  badges: { type: [String], default: [] },
  lastEventSeq: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now }
});

export const User      = models.User      || model("User", UserSchema);
export const Event     = models.Event     || model("Event", EventSchema);
export const Counter   = models.Counter   || model("Counter", CounterSchema);
export const Challenge = models.Challenge || model("Challenge", ChallengeSchema);
export const Progress  = models.Progress  || model("Progress", ProgressSchema);
