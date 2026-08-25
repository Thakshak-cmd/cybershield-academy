import type { TopLevelSkill, SubSkill, Tier, Validator } from './skills.js';

export const SCHEMA_VERSION = 1;

/**
 * Fields present on every telemetry event.
 *
 * `subjectId` is an opaque pseudonym. The mapping to a real participant is held
 * outside this database, in the researcher's custody, per the approved ethics
 * protocol — the application cannot re-identify anyone.
 */
export interface EventBase {
  schemaVersion: number;
  subjectId: string;
  sessionId: string;
  /** Per-subject monotonic counter. BKT is sequential; timestamps are not reliable for ordering. */
  seq: number;
  occurredAt: string; // ISO 8601, server-assigned
  /** False for ordinary platform users, whose events are operational only and excluded from research data. */
  isStudyParticipant: boolean;
}

export interface ChallengeStarted extends EventBase {
  type: 'challenge.started';
  challengeId: string;
  skill: TopLevelSkill;
  subSkill: SubSkill;
  tier: Tier;
}

export interface ChallengeAttempted extends EventBase {
  type: 'challenge.attempted';
  challengeId: string;
  skill: TopLevelSkill;
  subSkill: SubSkill;
  attemptNo: number;
  correct: boolean;
  validator: Validator;
  /** Which validation rules the patch failed. Structured, so no raw learner code is stored. */
  failedRules: string[];
  /** Hash of the submission, for detecting resubmits without retaining the code itself. */
  submissionHash: string;
  durationMs: number;
}

export interface ChallengeCompleted extends EventBase {
  type: 'challenge.completed';
  challengeId: string;
  skill: TopLevelSkill;
  totalAttempts: number;
  hintsUsed: number;
  totalDurationMs: number;
  xpAwarded: number;
}

export interface ChallengeAbandoned extends EventBase {
  type: 'challenge.abandoned';
  challengeId: string;
  skill: TopLevelSkill;
  attemptsMade: number;
  lastActiveAt: string;
}

export interface HintRequested extends EventBase {
  type: 'hint.requested';
  challengeId: string;
  skill: TopLevelSkill;
  hintLevel: 1 | 2 | 3;
  attemptNo: number;
}

export interface XpAwarded extends EventBase {
  type: 'xp.awarded';
  amount: number;
  reason: 'completion' | 'first-attempt-bonus' | 'speed-bonus' | 'streak';
  runningTotal: number;
}

export interface BadgeEarned extends EventBase {
  type: 'badge.earned';
  badgeId: string;
  skill: TopLevelSkill;
}

export interface MasteryUpdated extends EventBase {
  type: 'mastery.updated';
  skill: TopLevelSkill;
  pMasteryBefore: number;
  pMasteryAfter: number;
  /** The observation that drove the update — null when recomputed in batch. */
  triggeredByCorrect: boolean | null;
}

export interface RecommendationServed extends EventBase {
  type: 'recommendation.served';
  challengeId: string;
  skill: TopLevelSkill;
  pMastery: number;
  policy: 'bkt-adaptive' | 'linear-fallback';
  /**
   * Whether the learner actually took the recommendation. Without this there is no
   * way to show adaptive sequencing changed behaviour — only that predictions were
   * accurate. Backfilled when the next challenge.started arrives.
   */
  wasFollowed: boolean | null;
}

export interface SessionStarted extends EventBase {
  type: 'session.started';
}

export interface SessionEnded extends EventBase {
  type: 'session.ended';
  durationMs: number;
}

export type TelemetryEvent =
  | ChallengeStarted
  | ChallengeAttempted
  | ChallengeCompleted
  | ChallengeAbandoned
  | HintRequested
  | XpAwarded
  | BadgeEarned
  | MasteryUpdated
  | RecommendationServed
  | SessionStarted
  | SessionEnded;

export type TelemetryEventType = TelemetryEvent['type'];

/**
 * BKT trains on first-attempt correctness only. Later attempts are kept for
 * engagement analysis but excluded from the training signal — a modelling choice
 * that must be stated in the Methodology chapter.
 */
export function isBktObservation(e: TelemetryEvent): e is ChallengeAttempted {
  return e.type === 'challenge.attempted' && e.attemptNo === 1;
}
