# Game Design

Decisions taken 25 Aug 2026, after two interaction prototypes. This document is the
source for the dissertation's Design chapter sections on the learning loop and
gamification.

## The problem being solved

Attacking is intrinsically motivating: there is a puzzle, a discoverable answer, and
a moment where it resolves. Defending is not — you are removing a bug. If every
challenge is "here is a vulnerable snippet, fix it", the result is a worksheet with
XP sprinkled on top, and the gamification claim collapses under inspection.

Every decision below exists to give defensive work a dramatic beat.

## 1. The core loop

1. **Watch it break.** A scripted attack lands against the vulnerable code. The
   payload is canned; the learner never composes one. This keeps the platform
   defensive, which matters for the LO3 ethics position.
2. **Patch it.** Editor or guided fix, hints available.
3. **Watch it bounce.** The same attack replays against the patched code and fails.

## 1b. The welcome

Added 19 Oct 2026, after a friend's test session. A new account went from signing up
straight to a lesson with no sense of what the platform was, which felt overwhelming;
separately, signing in kept whatever page the address bar held, so it could land
someone in a lesson outright (now fixed: sign-in always starts at the briefing).

A single screen, shown once per account and remembered on the server (so it holds on
any machine): who you are (the newest engineer on Aurora's night shift), the three
moves (learn, fix, grow), how a fix is judged (both suites must pass), and where help
is (hints, the field manual). "How it works" on the briefing reopens it. A one-time
tip above the suites on the first ticket shows where those two checks live. Everyone
sees it, participants included, for one consistent flow.

## 1c. Changes from playtesting (2 Nov 2026)

- **Pacing.** A new learner met three lessons in about ten minutes (lesson, drill,
  lesson, drill, lesson). A break screen now comes before the second and third: what
  has been covered, what is next, and "start when ready". The ticket order is
  unchanged.
- **Theory for complete beginners.** Each lesson opens with "Words to know" (every
  technical term in plain English), uses short sections with an everyday comparison,
  and ends with one sentence to remember. Theory is capped at about 300 words.
- **Replay.** Reopening a filed lesson now lets the guided fix be practised again.
- **XP.** Every lesson pays the same 50 XP the first time, nothing on a replay. Every
  ticket pays by its kind and difficulty only, never its skill, and a content test
  enforces the table (it caught two drills paying the wrong hinted rate). Skills
  still differ in total XP, because request forgery has fewer tickets.
- **A thank-you** after the last lesson, from the author. Not shown to study
  participants, where mid-session it would read as "you're finished".

## 1a. Instruction before practice: the briefing files

Added 29 Sep 2026. Until then the platform taught only through feedback -- rule
explanations, hints, the notes on wrong lines -- and never introduced a concept
before asking for it. For novices that is discovery learning, which the
worked-example literature finds weaker than explaining first and fading support.

Each skill now has one briefing file (`content/lessons.js`), handed over in
character before the learner's first ticket in that skill:

1. **Theory.** Three short sections, grounded in Aurora's own code.
2. **See it happen.** A live simulation: the query rewritten as you type, the
   elements a browser would build from a note, a forged request narrated with
   Aurora's defences switched on and off. Nothing is executed. The XSS demo parses
   into an inert `DOMParser` document and reports what *would* have been built.
3. **Guided fix.** A faded worked example: Marcus makes the first move, the learner
   finishes it, scored by the real validator. "Show me" appears after two tries.
4. **Check.** Two unscored questions, with an explanation for every option.

Filed lessons stay readable in the **field manual**. Unfiled ones stay sealed until
their ticket arrives, so instruction happens at the same point for everyone.

**Required, and the same for everyone.** The API refuses to start a skill's first
ticket until its lesson is filed (409), and refuses to file a lesson whose guided fix
and check were skipped. The within-subjects design needs the intervention to be one
thing, not whatever each participant chose to read.

**Not evidence for the model.** Lesson events (`lesson.*`) never reach BKT: reading
an explanation or finishing someone else's worked example is not the unaided
performance the model estimates. They are logged so the analysis can ask whether the
lesson predicts first-attempt success.

**Not the ticket's answer.** Each guided fix uses different code from every ticket
and reference patch -- enforced by a content test -- so the first unaided attempt
is not a copy.

**Time.** About four minutes each, twelve in total, taken out of challenge time
within the approved ~60-minute session.

**On composing payloads.** §1 says the learner never composes an attack. The demos
let a learner type into a simulated search box or delivery note, with a preset for
the classic textbook example. Nothing is sent anywhere and nothing runs. The only
output is an explanation of how the input would be read. That is the defensive
point -- seeing *why* the fix works -- but it is a nuance the LO3 section should
state rather than leave for a marker to find. Restricting the demos to presets
only is a one-line change if the stricter reading is preferred.

## 2. The win condition: two suites in tension

A patch must satisfy both:

- **Attack suite — every payload must fail.** Multiple variants per challenge, not one.
- **Functional suite — every legitimate case must pass.** Escaping everything, or
  deleting the endpoint, does not win.

This is what makes it a puzzle rather than a quiz. Naive fixes fail in *different*
directions, and the surviving payload (or the locked-out customer) is shown back to
the learner. That feedback is where secure-coding intuition actually forms.

Worked example — SEC-104, three plausible patches:

| Patch | Attack suite | Functional suite | Fails because |
|---|---|---|---|
| Strip single quotes | 2/3 | 2/3 | `1 OR 1=1` needs no quote; O'Brien cannot log in |
| Blocklist SQL keywords | 2/3 | 2/3 | `admin'\|\|'1'='1` uses no keyword; "Orwell" trips the filter |
| Parameterised query | 3/3 | 3/3 | — |

## 3. Format portfolio

One format twenty times is a worksheet. Target mix (~20 items, ~60 min session):

| Format | Time | Target | Shipped | Role |
|---|---|---|---|---|
| Spot the flaw | 30-60s | ~8 | 6 | Warm-up; cheap to author; each is a BKT observation |
| Patch the code | 4-8 min | ~6 | 7 | The core loop |
| Harden the config | 2-4 min | ~3 | 3 | CSP, SameSite, DB grants — security outside app code |
| Review the fix | 2-4 min | ~3 | 3 | Judging a fix is a distinct skill from writing one |
| Capstone | 10-15 min | 1-2 | 1 | All three skills in one incident; never a BKT observation |

Twenty items in all. Each skill is a ladder: spot the flaw, patch it, review a
colleague's patch, harden the configuration around it, then an advanced patch
(ORDER BY allowlisting for SQLi, `javascript:` URLs for XSS). A review item is
scored on the decision *and* the reason: rejecting a sound fix, merging an unsound
one, and rejecting for the wrong reason each fail a different rule, so the two
suites stay in tension even without code.

Spot-the-flaw items are not filler: they are the cheapest way to raise the
observation count per skill, which is what makes BKT viable on a small sample (R3).

## 4. Framing: a Blue Team RPG

The platform is framed as a role at a fictional company (Aurora Store), not a ticket
queue. A ticket queue is the least motivating frame in software and would actively
undercut the engagement thesis.

**Adopted — fiction and progression:**

- **Character sheet** — see §5.
- **Skill tree** per vulnerability domain, unlocking on inferred mastery.
- **Quest chains** — challenges grouped into narrative arcs.
- **Boss encounters** — capstone challenges combining multiple vulnerability classes.
- **Consequence** — failure lets the breach progress; the company's security posture
  visibly degrades. *Implemented as Aurora's posture* (`packages/shared/src/posture.js`):
  closing holes raises it, a failed attempt on a real hole is an incident that lowers
  it, and incidents fade after eight attempts so early failure does not scar. Drills
  never cause incidents. A failure at zero is still shown as an incident, because
  early on is when failures are most common and the score cannot fall further.

**Rejected — simulation machinery:** overworld map and movement, dialogue trees,
inventory and loot, party members, battle animations, procedural generation. These
are months of systems work that teach nothing about web security.

### The boss entity is the system, not a creature

No asset pack contains a sprite for cross-site request forgery. Bolting a monster
onto it would be decoration with no relationship to what the learner is doing, and
it would need art that does not exist.

The adversary is drawn as **Aurora's architecture in a compromised state**: browser,
API, customer data, session store, with the breach on the parts still reachable and
each one turning as its stage is closed. It is SVG and CSS, so it needs no licensed
asset, no style-matching and no attribution — and it is the honest picture rather
than a mascot.

This removes the project's largest asset category entirely. What remains to license
is icons and portraits; see the licensing note above.

### Why bosses are the strongest element

A capstone requiring SQLi *and* CSRF knowledge together is a **transfer task**: it
tests whether learning generalised beyond the drill. That is precisely the "practical
application" clause of the research question, and it happens to be the most engaging
part of the design. Two boss encounters are committed; a third is a stretch goal.

## 5. The character sheet is the model

The three stats are the **live posteriors of the BKT model** — the same numbers that
drive challenge selection — rendered as a progression display. Skill tree nodes
unlock on mastery thresholds, so the tree opens because the model inferred readiness,
not because a challenge counter incremented.

This is the defence against decorative gamification: the progression display and the
adaptive engine are the same object. Every game element should be doing pedagogical
or evaluative work, and it should be possible to say which in one sentence.

### Calibration findings from prototype 2

Three problems surfaced that would otherwise have been found in week 9:

1. **The sequencing policy is subtle.** Sorting available challenges by weakest skill
   alone makes the policy grind the always-open practice drill forever, since drills
   raise mastery but never mark progress. Sorting by "prefer unseen content" instead
   causes it to tunnel down one branch, running a single skill to 0.999 while the
   others stay locked. The working policy uses weakest-skill as the primary key with
   freshness only as a tiebreak. This is a textbook explore/exploit trade-off and
   belongs in the Implementation chapter.

2. **BKT converges faster than good progression allows.** With P(G)=0.20 and
   P(S)=0.10, two correct answers move a learner from 0.15 to 0.879, and twelve
   observations reach the top rank with the capstone unlocked. That is correct
   inference and bad game design. **Mitigation:** gate boss encounters on mastery
   *and* a minimum count of distinct challenges cleared.

3. **Mastery drops sharply on failure** (0.554 to 0.308 on a single incorrect
   answer), which can re-lock an already-open node. **Mitigation:** nodes latch open
   once unlocked. The bar still moves both ways; the tree never claws back.

## 6. Gamification corrections to the approved proposal

**No speed bonus.** The proposal promises "bonus XP for efficiency and accuracy", but
§6.3 uses average time-on-task as an *engagement metric*. Rewarding speed would make
time-on-task measure bonus-farming rather than engagement — confounding the study's
own dependent variable. Efficiency is therefore defined as *fewer attempts*, which
also aligns the mechanic with the first-attempt-correctness signal BKT trains on.

**Streaks are derived, not stored.** Two kinds: consecutive unaided first-attempt
solves within a session (what matters during the study), and consecutive active
days (what matters for return outside it). Both are computed from the event log on
read — a stored counter is exactly the kind of denormalised state the append-only
model exists to avoid, and a stored one that drifted from the log would be a
silent lie on the character sheet.

**Leaderboard stays opt-in.** With ~12 participants who likely know one another, a
public ranking demotivates the lower half and complicates the ethics position. The
proposal already says "optional"; streaks and personal bests are the prominent
surface instead.

## 7. Visual treatment

The battle screen, not the overworld, carries JRPG identity — and the challenge
screen already maps onto one: the attack suite is enemy HP, the patch is the attack,
the functional suite is the constraint against hitting your own side.

**In scope:** windowed UI chrome (CSS and 9-slice, not animation), static boss
entities at three states each (idle / hit / defeated), static portraits, skill and
badge icons.

**Out of scope:** walk cycles, tilesets, battle animations, environment art.

**Split typography.** The *world* uses display/pixel type for chrome; the *terminal
the learner patches in* stays crisp monospace. A pixel typeface at code density is
unreadable, and the platform is fundamentally about reading code. The split is also
diegetically coherent: a real screen inside a game world.

**Icons are drawn, not sourced — for now.** The set is stroke-only SVG on a 24x24
grid using `currentColor`, so a glyph takes the colour of whatever it sits in and
follows both palettes with no per-theme variant. Stroke weight matches the 2px
window rules deliberately, so the icons read as part of the chrome rather than as
something dropped on top of it.

They are placeholders in the sense that they can be replaced, not that they are
unfinished. `content/assets/README.md` describes the swap: drop an SVG in, add a
manifest entry, point the name at the file. Nothing else changes.

**Anything not original is licensed, not authored.** Sources with clean terms only — Kenney (CC0),
game-icons.net (CC-BY 3.0), OpenGameArt/LPC (CC-BY-SA 3.0, note the share-alike is
viral). Every asset is recorded in an asset manifest with source, licence, and
required attribution; the manifest becomes a dissertation appendix and supports the
legal/professional discussion under LO3.

**Accessibility.** Sprite-heavy interfaces tend to encode state in colour alone and
ship images without text alternatives. WCAG considerations are designed in rather
than retrofitted, and discussed under LO3 — it is an educational product.

Contrast is measured, not eyeballed. Both palettes initially set the small
uppercase labels at 3.8:1, below the 4.5:1 AA requires at 10.5px; both were
raised to 5.2:1. Nothing else fell short.

### Two palettes, offered as light and dark

Both palettes ship. Vellum is the light appearance and Nightwatch the dark one,
following the operating system by default and overridable by the learner.

They are not one design at two brightnesses — an operations room and a case file
are different worlds, so switching reads more like a day shift and a night shift
than like a brightness control. That is a deliberate choice, and it is why the
control names them rather than showing a sun and a moon.

**Study participants are served a fixed palette.** Letting participants see
different visual designs would put an uncontrolled variable inside the one study
that gets to run: with n around 12, a split leaves roughly six per appearance,
which is the same underpowered comparison removed from the research question in
deviation D3. Any difference in SUS score could then not be attributed to
anything in particular.

The pin is a default rather than a security control — the preference lives in the
browser and a determined participant could change it. It removes an accidental
variable, not a deliberate one; the study protocol is what actually holds
participants to a single design. This belongs in the Methodology chapter as a
stated control.

## 8. Schedule impact

The RPG framing plus visual treatment costs roughly three weeks over the plain
ticket-based design. Paid for by holding challenge count at ~20 (down from ~26) and
shipping two boss encounters rather than three. In the event one shipped (the
Aurora Breach), locked server-side until the model reports all three skills
strong enough.

**Art is the most compressible part of the project.** If week 9 is behind, the
platform ships with placeholder chrome and the study still runs. If the validation
engine is behind in week 9, nothing runs. The week-10 feature freeze (R1) takes
precedence over every item in §7.
