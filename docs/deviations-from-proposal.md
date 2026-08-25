# Deviations from the Approved Proposal

The project proposal was approved in spring 2026. This document records where the
delivered work departs from it, and why. Each entry is intended to become part of
the dissertation's Design & Methodology chapter.

Documented, reasoned course-correction demonstrates project management (LO1) and
critical evaluation (LO6). Undocumented deviation reads as failure to deliver.

---

## D1 — Addition of an adaptive sequencing layer (Bayesian Knowledge Tracing)

**Proposal said:** Progressive difficulty, with challenges "tiered (Beginner,
Intermediate, Advanced) and unlocked as users progress" — a fixed, linear unlock rule.

**Delivered instead:** A Bayesian Knowledge Tracing model estimates per-skill mastery
from the learner's attempt history and selects the next challenge adaptively, with the
linear rule retained as a fallback policy.

**Why:** The proposal contained no artificial intelligence or machine learning
component despite the degree pathway being BSc Computer Science (AI & ML). Beyond
addressing that, adaptive sequencing supplies a second, quantitative evaluation axis
(model AUC/RMSE on held-out attempts) that does not depend on the small participant
sample — strengthening the Evaluation chapter against the acknowledged limitation of
n ≈ 12.

**Consequence:** Adds a Python service to an otherwise MERN architecture. The
polyglot choice is justified by the ML tooling ecosystem and is discussed in Design.

---

## D2 — Tiered patch validation rather than universal container execution

**Proposal said:** "The sandbox will be containerised using Docker to ensure complete
isolation" for all challenges, with server-side validation of every submitted patch.

**Delivered instead:** Beginner and Intermediate challenges are validated by AST-diff
and rule-set static analysis. Container execution is reserved for the Advanced tier.

**Why:** Universal container execution means operating a multi-tenant
arbitrary-code-execution service — seccomp profiles, non-root execution, read-only
filesystems, network isolation, resource caps, timeout enforcement, and container
reaping — built solo, alongside a 10,000-word dissertation, on a fixed deadline. It
was the project's highest-severity delivery risk (see R1). Static validation gives
equivalent *pedagogical* feedback for the vulnerability classes concerned, because a
correct fix for SQLi or reflected XSS is structurally identifiable without running the
code.

**Consequence:** The claim of "complete isolation" is narrowed and stated honestly in
the Limitations section. If the Advanced tier is cut under schedule pressure, the
platform remains complete for the tiers used in the study.

---

## D3 — Research question reframed from between-subjects to within-subjects

**Proposal said:** "To what extent does a gamified, sandbox-based learning environment
improve the retention and practical application of defensive cybersecurity knowledge
among novice learners **compared to conventional instructional methods**?"

**Delivered instead:** The comparison to conventional instruction is removed from the
research question and treated qualitatively in the Discussion. The study measures
within-subject change (pre/post knowledge gain), usability (SUS), and engagement.

**Why:** The stated comparison is a between-subjects claim requiring a control arm.
With a target of 10–15 participants, a split yields roughly six per group — no
statistical power to support any comparative conclusion. The proposal itself already
showed this tension: §6.1 describes a within-subjects pre/post design, while §6.4
downgrades the comparison to contextual reference against published studies.

**Consequence:** Narrower claims, honestly supported. The cross-platform positioning
against WebGoat, PortSwigger, TryHackMe and Hack The Box remains as qualitative
analysis, which is where the proposal's §6.4 had effectively already placed it.

---

## D4 -- Reframed from points-badges gamification to a serious-games design

**Proposal said:** Gamification consisting of "XP and Levelling", "Badges",
"Leaderboard", "Progressive Difficulty" and "Patching Loops" -- a points-badges-
leaderboards (PBL) treatment layered over the challenges.

**Delivered instead:** A role-based framing (Blue Team engineer at a fictional
company) with narrative quest chains, a skill tree gated on inferred mastery,
capstone boss encounters, and consequence tied to the company's security posture.
The PBL elements remain but are subordinate to the fiction.

**Why:** PBL gamification is extensively critiqued in the literature as shallow --
Nicholson's "meaningful gamification" argument among others -- and a marker familiar
with that critique would apply it directly to the proposal as written. More
practically, the proposal's own framing was a ticket queue, which is the least
motivating frame available and would have undercut the engagement thesis the project
is trying to test.

**Consequence:** The literature review shifts from gamification-in-education toward
serious games and self-determination theory, which is a stronger position to argue
from and gives considerably more to critique than the four platforms in the
proposal's section 3. Costs roughly three weeks, paid for by reducing challenge count
from ~26 to ~20 and shipping two boss encounters rather than three. See
`game-design.md` for the full design and `risk-register.md` R13-R16.

---

## D5 -- No speed-based XP bonus

**Proposal said:** "Users earn experience points for completing challenges, with
bonus XP for efficiency and accuracy."

**Delivered instead:** XP rewards accuracy and *fewer attempts*. There is no reward
for elapsed time.

**Why:** The proposal's section 6.3 uses average time-on-task as an engagement
metric. Rewarding speed would cause participants to optimise for the bonus, so
time-on-task would measure bonus-farming rather than engagement -- confounding the
study's own dependent variable. Defining efficiency as fewer attempts also aligns the
mechanic with the first-attempt-correctness signal the BKT model trains on.

**Consequence:** A minor mechanic change that protects the validity of one of the
three evaluation instruments.

---

## D6 -- Follow-through is derived from the log, not stored on the event

**Earlier design said:** the `recommendation.served` event would carry a
`wasFollowed` field, "backfilled when the next `challenge.started` arrives".

**Delivered instead:** no such field. Whether a recommendation was taken is
computed at analysis time by `deriveFollowed`, which pairs each
`recommendation.served` with the first `challenge.started` after it in sequence
order.

**Why:** the two rules contradicted each other. The telemetry model states that
events are never updated or deleted, and backfilling a field is a mutation. The
contradiction would not have surfaced as a bug -- both writes would have
succeeded -- but it would have left events whose meaning depended on when they
were read, which is exactly what an append-only log exists to prevent.

**Consequence:** strictly better. There is no second write to fail halfway, and
the definition of "followed" can be revised during analysis without the collected
data being wrong. A recommendation with no subsequent start resolves to `null`
rather than `false`: the learner did not decline it, the session ended, and
counting that as a refusal would bias the follow rate down by one per session.
The general rule now recorded in `telemetry-model.md` is that anything
reconstructible from the log should be reconstructed from it.

---

## Supervisor communication

D1 in particular changes the technical shape of the project after approval. It should
be raised with the supervisor in writing and the response recorded here, so that the
change is on record as agreed rather than unilateral.

**Status:** Not yet raised. — pending
