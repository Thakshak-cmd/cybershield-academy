# CyberShield Academy

A gamified platform for defensive web security education, with adaptive challenge
sequencing driven by Bayesian Knowledge Tracing.

Level 6 individual project (M34029), BSc Computer Science (AI & ML) Top-Up,
University of Portsmouth London.

## Layout

```
docs/          design and governance: telemetry model, risk register,
               deviations from the approved proposal, game design
content/       challenge definitions - the authoring surface
packages/
  shared/      skill taxonomy and the event contract (JSDoc-typed)
  validator/   AST-based patch validation, plus a CLI for authoring
apps/api/      Express API: event log, attempt handling, recommendations
services/ml/   BKT model, sequencing policy, evaluation, FastAPI service
```

## Running it

Two processes. The BKT service first:

```
npm run ml
```

Then the API, which needs `.env.local` (copy `.env.example`):

```
npm run dev --workspace @cybershield/api
```

## Verifying it

```
npm run verify          # typecheck + unit tests, no services needed
npm run test:integration # against a real mongod, downloaded on first run
npm run ml:test         # the Python side
npm run smoke           # full stack: Mongo + API + BKT service
```

`npm run smoke` walks a learner through one complete loop -- recommendation,
start, a naive patch, the correct patch -- and prints the resulting event log. It
needs `npm run ml` running in another terminal.

## The authoring loop

```
npm run check sec-101              # score the reference patches
npm run check sec-101 my-patch.js  # score a file
```

Writing a challenge means writing rules, and rules are only correct if the wrong
answers fail for the right reasons.

## Design notes worth knowing

**The event log is append-only and authoritative.** Progress and mastery are
derived projections, always rebuildable. Anything reconstructible from the log is
reconstructed from it rather than stored -- which is why whether a learner took a
recommendation is computed at analysis time instead of backfilled onto the event.

**Ordering is by `(subjectId, seq)`, never timestamp.** Clocks skew, millisecond
values collide, and BKT is a sequential model, so the wrong order gives the wrong
mastery curve.

**Learner code never reaches the database.** Validation happens in memory and only
rule ids and a hash are persisted. Tests plant a marker string in a submission and
assert it appears nowhere on disk.

**Behaviour is separated from identity.** Events carry an opaque `subjectId`; the
mapping to a real participant lives outside this system in the researcher's
consent record, per the approved ethics protocol.

See `docs/` for the reasoning behind each, and `docs/deviations-from-proposal.md`
for where the delivered work departs from the approved proposal and why.
