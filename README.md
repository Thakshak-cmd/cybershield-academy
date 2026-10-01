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

```
npm run dev
```

Starts the BKT service, the API and the front end together, waits for each to
answer, and prints the URL. Ctrl+C stops all three.

The database is in-process and discarded on exit, so no Atlas cluster is needed
to develop against — every run starts from a freshly seeded database. Register a
handle at http://localhost:5173 to begin; the study enrolment code is
`AURORA-2026`.

To run a service on its own: `npm run ml`, `npm run dev:api`, `npm run web`.

### Against the real database

Copy `.env.example` to `.env.local` and fill in `MONGODB_URI` (with the database
name, `/cybershield`, before the `?`) and `JWT_SECRET`. Then:

```
npm run seed        # load the challenges; safe to repeat
npm run dev:atlas   # the same three services, API on the real database
```

Nothing is seeded automatically in this mode, so content cannot change under a
study session. Your IP must be on the Atlas Network Access list.

## Running the study

Everything below works on the real database in `.env.local`, and writes only
under `data/study/`, which is gitignored. Nothing in it may ever be committed.

```
npm run study:export                      # encrypted backup of the study data
npm run study:withdraw -- --handle <h>    # show what a withdrawal would delete
npm run study:withdraw -- --handle <h> --confirm
npm run study:analyse -- data/study/exports/<file>.csx --outcomes data/study/outcomes.csv --test-max 10
npm run study:rehearse                    # the whole pipeline on synthetic learners
```

- **Export** after every session, and keep the passphrase off this machine. It
  asks for one, or reads `STUDY_EXPORT_PASSPHRASE` for a scheduled backup.
- **Withdrawal** does nothing without `--confirm`, then deletes the account and
  all of its data, and records the id so older backups are filtered too.
- **Outcomes** (pre/post test, SUS) are collected outside the platform. Put them
  in `data/study/outcomes.csv` as `code,pre,post,sus` or `code,pre,post,sus1,...,sus10`.
- **Rehearse** before the study to see the report's shape. Its output is marked
  SYNTHETIC and must not be reported.

## Verifying it

```
npm run verify          # typecheck + unit tests, no services needed
npm run test:integration # against a real mongod, downloaded on first run
npm run ml:test         # the Python side
npm run smoke           # full stack: Mongo + API + BKT service
```

`npm run smoke` walks a learner through one complete loop -- recommendation,
start, a naive patch, the correct patch -- and prints the resulting event log. It
starts whatever it needs, so nothing has to be running first; an already-running
BKT service is reused and left alone.

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
