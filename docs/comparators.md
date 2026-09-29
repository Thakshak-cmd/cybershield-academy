# Comparators

Platforms the dissertation positions CyberShield against. The proposal's section 3
reviewed four, all security-specific. This list is what the literature review
chapter should draw from, and it is kept here rather than only in the chapter so
each entry records *what CyberShield does differently* at the moment the comparison
is made, not reconstructed later.

## Security-specific

| Platform | What it is | Where CyberShield differs |
|---|---|---|
| **OWASP WebGoat** | Deliberately insecure app for practising attacks | Defensive framing: the learner patches, never exploits. Aimed at novices, with onboarding and sequencing WebGoat lacks. |
| **PortSwigger Web Security Academy** | Structured labs, offensive focus | Same vulnerability classes, opposite side of them. No adaptive layer; PortSwigger's sequencing is fixed. |
| **TryHackMe / Hack The Box** | Gamified, offensive, XP and streaks | Closest in *mechanics*, furthest in *framing*: both reward compromising systems. CyberShield's boss is a system to hold, not to break. |

## General gamified coding

| Platform | What it is | Where CyberShield differs |
|---|---|---|
| **W3Schools Adventure** (iOS/Android, 2025–26) | Bite-sized syntax lessons with XP, streaks, weekly quests. "First line of code in 2 minutes." | Points-badges-streaks applied to recall. CyberShield's progression display *is* the knowledge-tracing model's posterior — the stat moves because the model's belief moved, not because a quiz was completed. Teaches structural reasoning about code, not syntax. |
| **Duolingo** (as the pattern W3Schools follows) | Streaks, hearts, leagues over micro-lessons | The reference point for the PBL critique (Nicholson 2015; Deterding 2011). Effective at *return*, contested on *learning*. |

## What is borrowed, and from where

Being different from these is not the same as ignoring what they get right.

- **Streaks** — from Duolingo via W3Schools. Cheap, proven to drive return, and
  game-design.md section 6 already named them as the surface to use *instead of* a
  leaderboard. Derived from the event log, never stored.
- **Time to first action** — W3Schools' "2 minutes" is the right metric. Sign-in to
  first attempt is derivable from `session.started` and the first
  `challenge.attempted`, and is reported in the study analysis. Since the shift
  briefing was added, every learner lands on it first, so the interval includes
  reading it and choosing to take a ticket. That applies to all participants
  equally, but it should be stated when the number is reported, and it is not
  comparable to pilot sessions run before the briefing existed.
- **Bite-sized items** — the 30–60 second "spot the flaw" format in game-design.md
  section 3. Beyond pacing, every one is a first-attempt BKT observation, which is
  what makes the model viable on a small sample.

## What is deliberately not borrowed

- **Hearts / lives.** Punishing failure with lockout is the opposite of what a
  patching loop needs: the learner has to be free to try the naive fix and see it
  fail.
- **Leagues / leaderboards as the main surface.** Twelve participants who know each
  other; see game-design.md section 6.
- **Syntax recall as the unit of learning.** The unit here is a structural decision
  about a piece of code, which is why the validator parses rather than
  pattern-matches.
