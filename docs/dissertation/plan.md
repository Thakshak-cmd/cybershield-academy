# Dissertation plan

A map from the module template (`BSc_Dissertation_Template.docx`) to what each section
must do, how long it should be, which learning outcome it carries, and where the
evidence for it already exists. **It is a plan, not a draft.** The brief (§8) treats
unacknowledged AI-generated content as misconduct, so the prose is yours. The facts,
figures and tables to write from are in [`evidence.md`](evidence.md).

## Before you start

- **Declare the AI use.** The title-page declaration covers "AI-generated content".
  Much of the artefact's code was written with Claude Code. Say so on the title page,
  describe the workflow honestly in §3.1 and §3.9, and cite the tool in References
  (see evidence.md, "AI use"). Ask your supervisor what level of AI-assisted
  implementation is acceptable *before* you write §3.5, and keep their reply.
- **Margins.** The template's left margin is 1.25in; the brief (§6.2, BS 4821) says
  1.5in. Check with your supervisor; if unsure, follow the brief.
- **Format** (brief §6.2): 12pt, 1.5 line spacing, left-justified, APA 7.
- **Word budget:** 10,000. The plan below allocates **9,250** to the five chapters,
  leaving ~750 for the overshoot every draft has. Front matter, references and
  appendices are outside the count (check local rules).

## Word budget

| Chapter | Template range | Planned | LOs |
|---|---|---|---|
| 1 Introduction | 10–15% | 1,100 | LO2 |
| 2 Related Work | 15–20% | 1,900 | LO4 |
| 3 Methodology | 25–30% | 2,850 | LO1, LO2, LO3, LO5 |
| 4 Results and Discussion | 25–30% | 2,800 | LO5, LO6 |
| 5 Conclusion | 5–10% | 600 | LO6 |

The marking is against the six learning outcomes, not against the proposal. Every LO
needs a visible home: LO3 (legal, ethical, social, professional) is the one most often
thin, so §3.9 is given real space.

---

## Front matter

| Section | Notes |
|---|---|
| Title page | Fill all fields; sign the AI declaration knowingly. |
| Copyright | Keep the template text. |
| Abstract (200–300) | Write last. Problem, aim, artefact, method, *real* results, conclusion. No numbers until the study has run. |
| Acknowledgements | Brief. If you acknowledge AI assistance here too, keep it consistent with §3.1. |
| Lists of figures/tables | You will have both (architecture, screenshots, test tables, risk register). Use Word captions so these generate. |

---

## Chapter 1 — Introduction (1,100) · LO2

| § | Words | Must answer | Evidence / sources | You supply |
|---|---|---|---|---|
| 1.1 Background and context | 250 | Why web-application vulnerabilities matter; who needs defensive skills; why current training falls short | OWASP Top 10 (2021); CWE; proposal §1–2 | Your framing |
| 1.2 Problem statement | 150 | One specific problem, stated plainly | Proposal §1; `game-design.md` "The problem being solved" | |
| 1.3 Aim and objectives | 200 | One aim; 4–6 measurable objectives covering investigation, design, build, test, evaluation | Proposal objectives; deviations D1–D5 change some of them | **Rewrite objectives to match what the project now is**, and make each one checkable in §4.4 |
| 1.4 Questions | 150 | Research/evaluation questions that genuinely fit | Deviations **D3** (the within-subjects reframing) | Final wording of the RQ |
| 1.5 Scope, assumptions, limitations | 250 | What's in, what's out, *why* | evidence.md "Scope and limitations"; D2 (static validation; Advanced tier); three vulnerability classes only; n≈12 | Supervisor's answer on the Advanced tier |
| 1.6 Structure | 100 | One line per chapter | | |

**Watch:** the template says "Do not disguise missing work as scope unless the decision
was reasonable and planned." The deviations document is your evidence that each scope
change was reasoned, and when.

---

## Chapter 2 — Related Work (1,900) · LO4

The template renamed this from "Literature Review" but still requires it to be critical
and properly referenced. The proposal had five references; target **30–50**. This
chapter is where most marks for LO4 sit.

| § | Words | Must answer | Evidence / sources | You supply |
|---|---|---|---|---|
| 2.1 Search strategy | 200 | Databases, keywords, inclusion criteria, dates | | Your actual search (Google Scholar, ACM DL, IEEE Xplore, ScienceDirect) and how many sources you screened |
| 2.2 Existing systems and approaches | 1,000 | Review by *theme*, not by source. Suggested themes below | Candidate sources below; `docs/comparators.md` (platform analysis already done) | Reading and critique |
| 2.3 Critical comparison | 350 + table | Compare alternatives against criteria that matter here (defensive vs offensive, feedback, adaptivity, cost, setup burden) | Template Table: Source / Strengths / Limitations / Relevance | Fill the table from your reading |
| 2.4 Gap and justification | 250 | What's missing that CyberShield provides | `comparators.md`; `game-design.md` | |
| 2.5 Summary | 100 | Decisions that came out of the review, linked to Ch 3 | | |

**Suggested themes for 2.2** (each should *end* in a design decision, which the template
asks for: "explain what each source helped you decide"):

1. **Gamification and its critique:** points-badges-leaderboards and why they are
   criticised → D4 (serious-games design instead).
2. **Motivation theory:** self-determination theory → why XP is subordinate to role,
   competence feedback and autonomy.
3. **Serious games and learning:** evidence for game-based learning → the Blue Team
   framing, consequence, capstone.
4. **Instructional design:** worked examples, faded guidance, explain-before-practice →
   the lessons (`game-design.md` §1a).
5. **Knowledge tracing:** BKT vs deep knowledge tracing → why BKT at this data scale (D1).
6. **Secure-coding training and existing platforms:** WebGoat, PortSwigger Web Security
   Academy, TryHackMe, Hack The Box; offensive vs defensive → the gap.
7. **Evaluation instruments:** SUS, normalised gain, pre/post designs → Ch 3.7.

**Candidate sources to find and verify** (well-known; read each before citing, and get
full APA 7 details from the source itself):
Deterding et al. (2011) on defining gamification; Hamari, Koivisto & Sarsa (2014),
"Does gamification work?"; Sailer et al. (2017) on game design elements and need
satisfaction; Nicholson (2015), meaningful gamification; Ryan & Deci (2000),
self-determination theory; Connolly et al. (2012), systematic review of serious games;
Sweller's cognitive load theory and Renkl's work on worked examples; Corbett &
Anderson (1995), knowledge tracing; Piech et al. (2015), deep knowledge tracing;
Khajah, Lindsey & Mozer (2016), "How deep is knowledge tracing?"; Švábenský et al.
(2021) on skills taught in capture-the-flag challenges; OWASP Top 10 (2021); Brooke
(1996), SUS; Bangor, Kortum & Miller (2009), SUS adjective ratings; Hake (1998),
normalised gain. I can help you locate and check these in the literature step.

---

## Chapter 3 — Methodology (2,850) · LO1, LO2, LO3, LO5

The template calls this "the central engineering chapter".

| § | Words | Must answer | Evidence / sources | You supply |
|---|---|---|---|---|
| 3.1 Project approach | 250 | Which approach, and why. **Don't claim Agile unless you ran iterations, a backlog and reviews** | evidence.md "Timeline": 34 small, working increments (17 record their test results); prototypes (game-design §"two interaction prototypes") | Honest description, incl. **how AI-assisted development was used and checked** |
| 3.2 Requirements and success criteria | 250 + table | FR/NFR with success criteria that §4.4 can judge | evidence.md "Candidate requirements" | Final requirement set and priorities (MoSCoW) |
| 3.3 Design | 450 + diagrams | Architecture, data model, UI. Every diagram introduced and discussed | evidence.md "Architecture"; `telemetry-model.md` (event log); `game-design.md` (loop, formats, UI) | Which diagrams to include |
| 3.4 Tools and technologies | 300 | Choices **and the alternatives rejected** | evidence.md "Technology choices" | |
| 3.5 Implementation process | 500 | Major stages, key decisions, a few short code excerpts, challenges | evidence.md "Timeline", "Code excerpts", "Defects found" | Selection; your account of challenges |
| 3.6 Participants | 250 | Recruitment, consent, sample, session protocol, data handling | Ethics approval; `README.md` "Running the study"; evidence.md "Study data handling" | **Ethics approval reference and date; recruitment plan; session protocol** |
| 3.7 Testing and evaluation plan | 250 + table | Methods mapped to objectives | evidence.md "Testing"; the analysis pipeline (Wilcoxon, Hake, SUS, BKT AUC/RMSE) | Pre/post test design (items, scoring, max) |
| 3.8 Project management | 200 | Planning, milestones, supervision, risk, changes | `risk-register.md` (Appendix B); deviations D1–D6; Gantt (Appendix A) | **Gantt from your real dates** (incl. Feb–Aug), supervision meetings |
| 3.9 Ethical, legal, social, professional | 350 + table | Participants, GDPR/DPA 2018, Computer Misuse Act 1990, security-sensitive content, accessibility, licensing, AI use | evidence.md "LO3 inventory"; `accessibility.md`; telemetry-model "What is deliberately NOT recorded" | Ethics approval statement |
| 3.10 Summary | 50 | | | |

---

## Chapter 4 — Results and Discussion (2,800) · LO5, LO6

Most of this chapter **cannot be finished until the study has run.** Write 4.1–4.3
and 4.7 now, and leave the evaluation sections for the real numbers. The rehearsal
report (`npm run study:rehearse`) shows the shape of the tables; **never** report its
numbers.

| § | Words | Must answer | Evidence / sources | You supply |
|---|---|---|---|---|
| 4.1 Overview of the artefact | 250 | What was built, with screenshots | evidence.md "Artefact in numbers", "Screenshots" | |
| 4.2 Key features | 600 | The core loop and two-suite validation; adaptive sequencing; lessons; consequence/posture; capstone | `game-design.md`; evidence.md | Which features to foreground |
| 4.3 Testing results | 450 + tables | Pass/fail, defects found and fixed, accessibility | evidence.md "Testing", "Defects found"; `accessibility.md` | |
| 4.4 Evaluation against objectives | 400 + table | Met / partly met / not met, **with evidence** | Your objectives from §1.3; study results | **Study results** |
| 4.5 Comparison with related work | 350 | Back to Ch 2: how CyberShield compares | `comparators.md` | |
| 4.6 Strengths, weaknesses, limitations | 400 | Honest | evidence.md "Scope and limitations"; the BKT fitting warnings; small n | |
| 4.7 Reflection on process | 250 | Decisions, management, learning; academic, not diary | Deviations; risk register status changes; the AI-assisted workflow | Your reflection |
| 4.8 Summary | 100 | | | |

**What the study will give you** (from the analysis pipeline): engagement per
participant (active time, completions, first-attempt rate, hints, time on task,
follow-through, time to first action, lesson time); model accuracy (AUC, RMSE against
the majority-class baseline, literature priors vs leave-one-out fitted); pre/post
knowledge (exact Wilcoxon, rank-biserial r, normalised gain); SUS against the
benchmark of 68.

---

## Chapter 5 — Conclusion (600) · LO6

| § | Words | Notes |
|---|---|---|
| 5.1 Summary | 120 | No new evidence |
| 5.2 Achievement of aim and objectives | 150 | Direct, referring to §4.4 |
| 5.3 Contribution and value | 120 | A working, evaluated artefact is a legitimate contribution (template says so) |
| 5.4 Future work | 130 | From the limitations, not a wish list: e.g. container-based Advanced tier, more data for fitted BKT, abandonment analysis, real screen-reader testing, the second capstone |
| 5.5 Final remarks | 80 | |

---

## Appendices

| Appendix | Source |
|---|---|
| A Timeline / Gantt | Your plan vs actual; evidence.md "Timeline" for Aug–Oct |
| B Risk register | `docs/risk-register.md` (R1–R18), in the template's table shape |
| C Requirements | Full FR/NFR table if §3.2 shows a subset |
| D Testing evidence | Suite inventory, defects log, accessibility audit, smoke-test output |
| E Ethics and supporting materials | Approval, information sheet, consent form, pre/post test, SUS form |
| F Code / repository | How to run (`README.md`), repository location; no credentials, no participant data |

## Suggested order of work

1. Ask the supervisor about AI-assisted code and the margin; record the answer.
2. Chapter 2 (the longest lead time: reading).
3. Chapter 3 (the evidence already exists).
4. 4.1–4.3 and 4.7.
5. Run the study → 4.4–4.6, then Chapter 1's final wording, Chapter 5, then the abstract.
