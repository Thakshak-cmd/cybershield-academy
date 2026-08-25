# BKT service

Bayesian Knowledge Tracing: the adaptive layer behind the character sheet and the
skill tree. Three modules, no third-party dependencies.

| Module | What it does |
|---|---|
| `model.py` | The two-state HMM: update, predict, and EM parameter fitting |
| `policy.py` | Which challenge to serve next, and what is unlocked |
| `evaluate.py` | AUC, RMSE and accuracy against held-out attempts |

## Running the tests

```
cd services/ml && python3 -m pytest -q
```

48 tests, no install step required.

## Why standard library only

The BKT update is scalar arithmetic and the study's dataset is roughly 12 learners
by 20 items. numpy would add an install step and hide the arithmetic behind array
operations without making anything faster at this scale. Every line of the model
stays inspectable, which matters for a viva.

`roc_auc` and `rmse` were cross-checked against scikit-learn over 200 randomised
cases including deliberate score ties: maximum disagreement 1.1e-16, i.e. floating
point noise. scikit-learn is not a dependency; it was used once to validate.

## What the model claims, and what it does not

The model predicts **the next answer**, not mastery. Mastery is latent and has no
ground truth, so scoring the model on its own mastery estimate would be circular.
`evaluate_sequences` therefore scores `predict_correct` under a prequential
protocol: every observation is predicted before the model sees it.

`evaluate_sequences` also reports `majority_class_accuracy`. When most answers are
correct, a model that always predicts "correct" looks strong while carrying no
information, so accuracy is only meaningful next to that baseline. AUC above 0.5 is
the claim that matters.

## Parameters are seeded, not fitted

`LITERATURE_PRIORS` comes from published BKT estimates. `fit_em` exists and works —
it recovers parameters from 400 synthetic sequences — but the study's own data has
roughly seven observations per learner per skill, and four parameters per skill are
not identifiable at that scale. `fit_em` emits a warning saying so rather than
returning quiet nonsense.

The honest use is to report that fitting did *not* beat the priors on held-out
data. That is a finding about data volume, not a failure.

Guess and slip are capped at 0.5. Above that the model is degenerate: it explains a
correct answer better by guessing than by mastery, so the "mastered" state stops
meaning what its name says.

## The sequencing policy took three attempts

All three failure modes are silent — nothing errors, the learner just has a worse
session — so each has a regression test in `tests/test_policy.py`.

1. **Rank every open challenge by skill weakness.** Rotates drills: clearing a
   drill lifts its skill out of last place before that skill's real content is
   ever served.
2. **Prefer content not yet seen.** The opposite failure. A skill below its first
   threshold has nothing fresh to offer, so whichever branch bootstrapped first
   runs to its boss while the others sit at the prior.
3. **Choose the skill first, then the challenge within it.** What the module does.
   Attention goes where the model is least confident, and the drill bootstraps
   exactly the skill that needs it.

A fourth mistake was in the test rather than the policy: measuring drill share over
a fixed step count reported content exhaustion, not policy behaviour. It read 68%
across three different policies before that became obvious.

## The HTTP layer

```
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
./.venv/bin/uvicorn app:app --port 8811
```

or `npm run ml` from the repo root.

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness. Depends on nothing. |
| `POST /mastery` | Current mastery per skill, and what it unlocks |
| `POST /recommend` | The next challenge, or `204` when nothing is open |

**Stateless by design.** The service holds no database and no session: the caller
sends the observation history and the challenge catalogue, and gets mastery back.
The Node API already owns the event log, so a database here would mean two
components reading the same log with two implementations of "which attempts
count" -- and they would drift silently, both continuing to return plausible
numbers. This service is authoritative about the *model* and nothing else.

`204` on `/recommend` means the learner has exhausted the open content. That is a
real answer, not a failure, and the caller distinguishes the two.
