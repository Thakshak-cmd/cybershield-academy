# Assets

Everything here is recorded in `manifest.json` before it ships. That list becomes
a dissertation appendix and is the evidence behind the legal and professional
discussion under LO3, so a file that arrives without an entry is a problem to fix
rather than a detail to catch up on later.

## Current state

Nothing is licensed yet. The icon set, the window chrome and the breach diagram
are all original SVG and CSS, listed under `originalWork`.

## Adding a licensed icon

The icon system is built so this is a file copy and a manifest entry, not a
refactor:

1. Download the SVG into `content/assets/icons/`.
2. Add an entry to `licensed` in `manifest.json` — path, source URL, licence,
   author, and the exact attribution line if one is required.
3. Point the name at the file in `apps/web/src/components/icons.js`.

## Choosing a source

**game-icons.net** (CC-BY 3.0) is the intended source. Filter to a *single
contributor* and take the whole set from them. Mixed sources is what actually
makes a game look amateur — three artists means three stroke weights and three
ideas of what a shield looks like, and no amount of recolouring hides that.

CC-BY needs a visible credit. Put it in the app's about text as well as here.

**Kenney** (CC0) carries no attribution obligation at all and is the cleanest
legally, but the packs are game-generic — swords and coins — with little that
reads as web security.

**Avoid CC-BY-SA** (OpenGameArt, LPC). Share-alike is viral and raises awkward
questions about what else in a submitted artefact it reaches.

**Do not AI-generate the set.** Consistency across a set is poor, provenance is
murky, and the module brief treats unacknowledged AI content as academic
misconduct. If any is used, declare it here and on the title page.
