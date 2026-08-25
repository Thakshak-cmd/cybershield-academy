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

## Supervisor communication

D1 in particular changes the technical shape of the project after approval. It should
be raised with the supervisor in writing and the response recorded here, so that the
change is on record as agreed rather than unilateral.

**Status:** Not yet raised. — pending
