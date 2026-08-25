# Risk Register

Maintained live from project start (25 Aug 2026). LO2 names risk management
explicitly. This is kept as a running document — entries are updated with actual
outcomes rather than rewritten, so the Evaluation chapter can report which risks
materialised and whether the mitigations worked.

Scoring: Likelihood and Impact each 1 (low) – 5 (high). Severity = L × I.

| # | Risk | L | I | Sev | Mitigation | Status |
|---|---|---|---|---|---|---|
| R1 | **Feature freeze slips past week 10**, pushing the user study into December exams/holidays when students are unavailable | 4 | 5 | 20 | Tiered sandbox reduces build load; Advanced tier is explicitly cuttable; weekly scope review against the week-10 gate | Open |
| R2 | **Under-recruitment** — fewer than 10 participants complete both pre- and post-assessment | 3 | 4 | 12 | Recruit 20 to retain 12–15; run sessions in-person where possible; pre-book slots in weeks 11–12 | Open |
| R3 | **BKT fails to converge** on sparse data (~7 observations per skill per learner) | 3 | 3 | 9 | Model 3 top-level skills rather than 8 sub-skills; seed priors from literature rather than fitting cold; `linear-fallback` sequencing policy already in the type system | Open |
| R4 | **Challenge authoring underestimated** — 20 pedagogically sound, correctly-validated challenges is content work, not code work | 4 | 3 | 12 | Author 6 challenges end-to-end first to calibrate real cost, then decide final count; reuse OWASP patterns (check licence, see R9) | Open |
| R5 | **Vercel serverless constraints** hit late — no WebSockets, no persistent process, ~10s function limit | 2 | 3 | 6 | Stateless API from day one; leaderboard uses polling, not sockets; sandbox behind an HTTP interface so its host is a config change | Mitigated by design |
| R6 | **Study data lost or corrupted** — the study runs once and cannot be repeated | 2 | 5 | 10 | Append-only event log; nightly export to encrypted local backup during weeks 11–12; never rely solely on a free-tier hosted DB | Open |
| R7 | **Dissertation compressed into December** — 10,000 words against a Jan 13 deadline | 4 | 5 | 20 | Draft Literature Review and Methodology during weeks 4–10, when the build is running; only Results/Discussion wait on the study | Open |
| R8 | **Supervisor unavailable over the Christmas period**, removing feedback exactly when the draft needs it | 4 | 3 | 12 | Agree a feedback schedule now; get the full draft to them by early December, not late December | Open |
| R9 | **Deliberately vulnerable code in a public repository** — legal/professional exposure, and the code could be lifted and misused | 3 | 3 | 9 | Keep the repository private until submission; vulnerable snippets are synthetic, non-executable outside the sandbox, and clearly marked; addressed under Computer Misuse Act 1990 discussion in the LO3 section | Open |
| R10 | **Participant withdrawal** after data collection, per the ethics protocol | 2 | 2 | 4 | Withdrawal deletes the pseudonym mapping and the subject's events; analysis scripts tolerate variable n | Mitigated by design |
| R11 | **Scope creep from the approved proposal** — proposal promised full Docker execution for all challenges | 3 | 3 | 9 | Deviations documented as reasoned decisions (see `deviations-from-proposal.md`) and raised with supervisor rather than discovered at marking | Open |
| R12 | **Illness or personal circumstances** compressing an already tight schedule | 2 | 4 | 8 | Two-week buffer held before the Jan 13 deadline; Extenuating Circumstances process understood in advance | Open |
| R13 | **Art production overruns** — sprite and UI chrome work expands to fill available time | 4 | 3 | 12 | Assets licensed, never authored; scope fixed to static entities and CSS chrome; art is explicitly the first thing cut if week 9 is behind | Open |
| R14 | **Asset licence breach** — an itch.io or OpenGameArt pack with terms incompatible with publication or share-alike obligations not met | 2 | 4 | 8 | Prefer CC0 (Kenney); asset manifest records source, licence and attribution for every file; manifest reviewed before submission and included as an appendix | Open |
| R15 | **Adaptive policy tuned badly and nobody notices** — a broken sequencing policy still looks fine; the learner just has a worse session | 3 | 4 | 12 | Policy covered by unit tests over simulated learners asserting balanced progression; three distinct failure modes already identified in prototype 2 | Open |
| R16 | **BKT thresholds mis-calibrated**, letting a lucky streak unlock boss content in ~12 observations | 3 | 3 | 9 | Boss gates require mastery *and* a minimum count of distinct challenges cleared; nodes latch open so failure never claws back progress | Open |
| R17 | **Middleware ordering regression leaves a route unprotected** — the routes keep working, so nothing looks broken | 3 | 5 | 15 | Open paths are an explicit list, never a prefix match; tests assert that an unauthenticated request is refused before any database work and that /auth/me and /auth/logout still demand a token | Mitigated by test |

## Highest-severity risks

R1 and R7 both score 20, and they are the same underlying risk: **the schedule has
no slack in the middle**. Weeks 11–12 are immovable because participants are only
available in term time, and the dissertation cannot be written before the study
produces results. Everything upstream of week 10 must therefore protect that date,
which is why the Advanced sandbox tier is designed to be cuttable without breaking
the platform.
