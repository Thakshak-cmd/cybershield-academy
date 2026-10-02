# Accessibility Audit: CyberShield Academy

**Standard:** WCAG 2.1 AA | **Date:** 2 Oct 2026 | **Scope:** every screen of the web
app (sign-in, briefing, lessons and demos, all four ticket formats, field manual,
progress, capstone), in both palettes, at desktop width and at 320px.

An educational product used in a study with human participants has to be usable by
the participants it recruits. This audit is the evidence for the accessibility point
in the LO3 (legal, social, ethical and professional) discussion.

## Method

1. **Automated scan.** axe-core 4.10 (WCAG 2.0/2.1 A and AA rules, plus best
   practice) on every screen, in both palettes, at desktop width and 320px, and
   again after a verdict, a lesson check, and a failed capstone deployment.
   Automated tools find roughly a third of real issues, so this was the first step,
   not the conclusion.
2. **Contrast by calculation.** Every text colour token measured against every
   surface it can sit on, using the WCAG relative-luminance formula, rather than
   sampling screenshots.
3. **Code review.** Roles, names, live regions, focus handling and motion,
   read in the components.
4. **Keyboard-only walkthrough** with real key presses: a lesson end to end (step
   navigation, the demos, the guided fix and "show me", the check), and a ticket.
5. **Reflow** at 320px (equivalent to 400% zoom on a 1280px screen).

## Summary

**Issues found:** 11 | **Critical:** 1 | **Major:** 6 | **Minor:** 4 | **Open:** 0

All were fixed and re-verified. Not yet done: testing with a real screen reader
(see Limitations).

## Findings

### Perceivable

| # | Issue | WCAG | Severity | Fix |
|---|---|---|---|---|
| 1 | Borders that identify controls (text inputs, check options, review reasons, demo toggles, palette buttons, skill-tree nodes, capstone stage cards) were 1.3–1.8:1 against their surface | 1.4.11 Non-text contrast | 🟡 Major | New `--control-edge` token, ≥ 3.08:1 on every surface in both palettes; decorative rules keep their original colour |
| 2 | Vellum `muted` text fell to 4.21–4.46:1 on tinted surfaces; `accent` to 4.41:1 | 1.4.3 Contrast | 🟢 Minor | Darkened slightly: muted `#695E50`, accent `#97483D` (now ≥ 4.6:1 everywhere) |
| 3 | Caption inside the faded locked-capstone illustration at 1.94:1 | 1.4.3 Contrast | 🟢 Minor | Caption hidden there; the illustration already says it |
| 4 | Rule results conveyed pass/fail only by ✦/✕ shapes hidden from assistive technology | 1.3.1 Info and relationships | 🟡 Major | Each result now carries "Passed:" / "Failed:" for screen readers |
| 5 | Window titles were styled text, not headings; most screens had no `h1` | 1.3.1 / 2.4.6 Headings | 🟡 Major | Window titles are headings and name their region; each screen has one `h1`; lesson theory nests at `h3` |

### Operable

| # | Issue | WCAG | Severity | Fix |
|---|---|---|---|---|
| 6 | Answering a check question disabled the focused button, dropping keyboard focus to the top of the page | 2.4.3 Focus order | 🔴 Critical | Answered options go inert (`aria-disabled`) instead of disabled, so focus stays put |
| 7 | Moving between lesson steps, or finishing the guided fix, removed the focused button with the same effect | 2.4.3 Focus order | 🟡 Major | Focus moves to the new step, or to the button that replaced the old one |
| 8 | Changing screens left focus on the clicked link, and the page title never changed | 2.4.2 Page titled / 2.4.3 | 🟡 Major | Per-screen document titles; focus moves to the new screen's main region |

### Understandable

| # | Issue | WCAG | Severity | Fix |
|---|---|---|---|---|
| 9 | Verdicts, guided-fix results, check explanations, demo outcomes and capstone results appeared silently | 4.1.3 Status messages | 🟡 Major | Persistent polite live regions, one short sentence each (e.g. "Not that line. 0 of 1 attacks repelled, 0 of 1 checks passing.") |

### Robust

| # | Issue | WCAG | Severity | Fix |
|---|---|---|---|---|
| 10 | The spot-the-flaw picker was a `listbox` with no name, whose options were tab stops without the arrow-key behaviour a listbox promises | 4.1.2 Name, role, value | 🟢 Minor | A named group of toggle buttons (`aria-pressed`): exactly what it does |
| 11 | Demo version switches claimed `radio` roles without radio keyboard behaviour | 4.1.2 Name, role, value | 🟢 Minor | Toggle buttons in a named group |

## Colour contrast (after fixes)

Lowest ratio of each token across every surface it can sit on.

| Token | Nightwatch (dark) | Vellum (light) | Required |
|---|---|---|---|
| ink | 12.59 | 11.98 | 4.5 ✅ |
| ink-2 | 7.25 | 6.82 | 4.5 ✅ |
| muted | 4.69 | 4.60 | 4.5 ✅ |
| window-title | 8.30 | 8.43 | 4.5 ✅ |
| accent | 7.04 | 4.61 | 4.5 ✅ |
| breach | 5.36 | 4.84 | 4.5 ✅ |
| secure | 7.70 | 4.58 | 4.5 ✅ |
| accent-ink on accent | 8.77 | 5.98 | 4.5 ✅ |
| control-edge (non-text) | 3.08 | 3.10 | 3.0 ✅ |

## Keyboard

| Element | Reachable | Enter/Space | Notes |
|---|---|---|---|
| Header navigation, palette, sound | ✅ | ✅ | Visible focus ring (accent, 2px) everywhere |
| Lesson steps and "next" buttons | ✅ | ✅ | Focus follows into the new step |
| Demo inputs, presets, toggles, defences | ✅ | ✅ | State announced as pressed/checked |
| Guided-fix editor | ✅ | — | Tab leaves the textarea; no keyboard trap |
| Check options | ✅ | ✅ | Focus stays on the chosen option |
| Spot-the-flaw lines | ✅ | ✅ | Each line a toggle button |
| Review decision and reasons | ✅ | ✅ | Native radio inputs |
| Skill-tree nodes, capstone stage cards | ✅ | ✅ | |

## Already in place before the audit

- `lang="en"`, a single `main`, labelled `nav` regions.
- Autocomplete on sign-in fields (`username`, `current-password`, `new-password`).
- A global `:focus-visible` outline.
- `prefers-reduced-motion` respected throughout, including the reward burst, the
  breach animation and the demo step reveal.
- Sound is off by default, optional, and always off for study participants.
- No time limits anywhere: a learner can take as long as they need.
- Code ligatures disabled, so `!==` reads as three characters.

## Limitations

- **No screen-reader session yet.** Roles, names and live regions were verified in
  the DOM, not heard. Before the study, a 15-minute pass with VoiceOver
  (macOS: ⌘F5) through a lesson and a ticket is the remaining check.
- **Target size (2.5.5)** is AAA in WCAG 2.1, so not assessed against AA; some
  small controls (palette buttons, demo presets) are below 44px.
- The **code editor** is a plain textarea: accessible, but without the line
  numbers or syntax cues a sighted reader gets from the read-only code panes.
- The **skill tree's** connecting lines are visual only. Each node announces its
  title and state, and a locked node also says which challenge it opens after,
  so the dependency is available without the lines. Locked nodes are disabled
  buttons, so they are read in browse mode but are not tab stops.
