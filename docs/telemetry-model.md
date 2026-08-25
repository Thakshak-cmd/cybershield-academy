# Telemetry & Event Model

This document is the single source of truth for what CyberShield Academy records.
It is written **before** any feature code, because three downstream consumers all
depend on it and none of them can be retrofitted after the user study has run:

1. **BKT knowledge-tracing model** — needs ordered, per-skill correctness observations.
2. **Engagement metrics (dissertation §6.3)** — completion rates, time-on-task, hint requests, XP over time.
3. **Pre/post study analysis** — needs to link platform behaviour to assessment scores without ever storing identifying data alongside behaviour.

## Design principles

### 1. The event log is append-only

Events are never updated or deleted. Aggregates (XP totals, mastery estimates,
badge state) are *derived* projections that can be recomputed from the log at any time.

**Why this matters for the dissertation:** the user study runs once, in weeks 11–12.
If in week 14 the analysis needs a metric nobody thought of in week 2, an append-only
raw log can be re-processed. A schema that only stored the aggregates cannot.
This is the single most important decision in this document.

### 2. Record fine-grained, aggregate coarse

Every event carries a **sub-skill** tag (`sqli.parameterised-query`,
`xss.output-encoding`, `csrf.samesite`), but BKT runs over the three **top-level
skills** (`sqli`, `xss`, `csrf`).

The reason is data volume. With ~20 challenges and 10–15 participants, splitting
into 8 sub-skills leaves roughly 2–3 observations per learner per sub-skill —
far too sparse for BKT's four parameters to converge. Three top-level skills give
~7 observations each, which is workable. The sub-skill tags cost nothing to record
and support descriptive analysis and error-pattern discussion in the Results chapter.

### 3. Behaviour and identity are separated

Events reference a `subjectId` — an opaque pseudonym. The mapping from `subjectId`
to a real participant lives **outside the application database**, in the researcher's
custody, per the approved ethics protocol. The platform itself cannot re-identify a
participant. Consent, withdrawal, and the pre/post scores are handled in that separate
record; withdrawal is executed by deleting the mapping row and the subject's events.

### 4. Ordering is explicit, not inferred from timestamps

Each event carries a per-subject monotonic `seq`. Client clocks skew, timestamps
collide at millisecond resolution, and serverless functions do not guarantee ordered
delivery. BKT is a sequential model — wrong order means a wrong mastery curve.

### 5. Every event is versioned

`schemaVersion` is stamped on write. When the model changes mid-development, older
events remain interpretable rather than silently mis-parsed.

## Event types

| Type | Emitted when | Key payload |
|---|---|---|
| `challenge.started` | Learner opens a challenge | `challengeId`, `skill`, `subSkill`, `tier` |
| `challenge.attempted` | Patch submitted for validation | `attemptNo`, `correct`, `validator`, `failedRules[]`, `durationMs` |
| `challenge.completed` | Challenge passes validation | `totalAttempts`, `hintsUsed`, `totalDurationMs`, `xpAwarded` |
| `challenge.abandoned` | Session ends without completion | `attemptsMade`, `lastActiveAt` |
| `hint.requested` | Learner requests a hint | `hintLevel` (1–3), `attemptNo` |
| `xp.awarded` | XP granted | `amount`, `reason`, `runningTotal` |
| `badge.earned` | Badge unlocked | `badgeId`, `skill` |
| `mastery.updated` | BKT posterior recomputed | `skill`, `pMasteryBefore`, `pMasteryAfter` |
| `recommendation.served` | Adaptive engine picks next challenge | `challengeId`, `pMastery`, `policy`, `reason` |
| `session.started` / `session.ended` | Session boundaries | `sessionId`, `durationMs` |

### The BKT observation

BKT canonically consumes **first-attempt correctness per skill opportunity**. That
is derivable from `challenge.attempted` where `attemptNo === 1`. Later attempts are
retained for engagement analysis but excluded from the model's training signal —
this must be stated explicitly in the Methodology chapter, since it is a modelling
choice a marker can reasonably question.

### `recommendation.served` earns its place

Whether the learner *took* the recommendation is what connects the model to the
platform. Without it there is no way to evaluate whether adaptive sequencing changed
behaviour at all — only whether the model's predictions were accurate. The
dissertation's research question is about the platform, not the model in isolation.

**This is derived, not stored.** An earlier draft of this document had a
`wasFollowed` field "backfilled when the next `challenge.started` arrives", which
directly contradicts the append-only rule above — backfilling is a mutation. It is
instead computed at analysis time: the first `challenge.started` after a
`recommendation.served`, in sequence order, either names the recommended challenge
or it does not.

Deriving it is strictly better than storing it. There is no second write to fail
halfway, no event that means different things depending on when it was read, and
the definition of "followed" can be revised during analysis without the collected
data being wrong. The rule is general: anything reconstructible from the log should
be reconstructed from the log.

## What is deliberately NOT recorded

- Raw submitted code beyond a bounded hash + the validator's structured verdict.
  Free-text code could contain anything a participant types, including identifying
  or unintended content, which widens the ethics and GDPR surface for no analytic gain.
- IP addresses, user agents, or geolocation.
- Anything from a user who has not consented to the study. Non-study users of the
  platform emit operational events only, never research telemetry.
