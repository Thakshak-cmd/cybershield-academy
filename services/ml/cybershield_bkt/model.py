"""Bayesian Knowledge Tracing.

BKT models a learner's latent skill as a two-state hidden Markov model: at every
opportunity the learner either has mastered the skill or has not, and the observed
answer is a noisy read of that state. Four parameters per skill:

    p_init    P(mastered before the first opportunity)
    p_transit P(not mastered -> mastered) at each opportunity
    p_guess   P(correct | not mastered)
    p_slip    P(incorrect | mastered)

Mastery is monotonic -- there is no forgetting transition. That is the standard
formulation (Corbett & Anderson, 1995) and it matters here because the skill tree
gates on mastery: a model that allowed decay would claw back unlocked nodes.

Written in the standard library on purpose. The update is scalar arithmetic and the
study's data is small, so numpy would buy nothing but an install step, and every
line of the model stays inspectable.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Iterable, Sequence

__all__ = ["BKTParams", "LITERATURE_PRIORS", "update", "predict_correct", "trace", "fit_em"]


# Above 0.5 the model becomes degenerate: it can explain a correct answer better by
# guessing than by mastery, so the "mastered" state stops meaning what its name says
# and mastery estimates become uninterpretable. Capping guess and slip is the usual
# guard (Baker, Corbett & Aleven, 2008) and it is applied to fitted values, not just
# to hand-set ones.
MAX_GUESS = 0.5
MAX_SLIP = 0.5
_EPS = 1e-6


@dataclass(frozen=True)
class BKTParams:
    """Parameters for one skill."""

    p_init: float = 0.15
    p_transit: float = 0.20
    p_guess: float = 0.20
    p_slip: float = 0.10

    def __post_init__(self) -> None:
        for name in ("p_init", "p_transit", "p_guess", "p_slip"):
            value = getattr(self, name)
            if not 0.0 <= value <= 1.0:
                raise ValueError(f"{name} must be a probability, got {value!r}")
        if self.p_guess + self.p_slip >= 1.0:
            raise ValueError(
                "p_guess + p_slip must be below 1.0, otherwise an incorrect answer is "
                f"evidence of mastery (got {self.p_guess} + {self.p_slip})"
            )

    def clamped(self) -> "BKTParams":
        """Pull guess and slip back inside the non-degenerate region."""
        return replace(
            self,
            p_guess=min(self.p_guess, MAX_GUESS),
            p_slip=min(self.p_slip, MAX_SLIP),
        )


#: Seeded from published BKT estimates rather than fitted on this study's sample.
#: With roughly seven observations per skill per learner there is not enough data to
#: identify four parameters, so fitting cold would produce confident nonsense.
LITERATURE_PRIORS = BKTParams(p_init=0.15, p_transit=0.20, p_guess=0.20, p_slip=0.10)


def predict_correct(p_mastery: float, params: BKTParams) -> float:
    """P(next answer correct) given current belief.

    This, not the mastery estimate, is what the model actually predicts, so it is
    what the evaluation scores against held-out attempts.
    """
    return p_mastery * (1.0 - params.p_slip) + (1.0 - p_mastery) * params.p_guess


def posterior(p_mastery: float, correct: bool, params: BKTParams) -> float:
    """Belief about mastery *given* the observation, before the learning step."""
    if correct:
        num = p_mastery * (1.0 - params.p_slip)
        den = num + (1.0 - p_mastery) * params.p_guess
    else:
        num = p_mastery * params.p_slip
        den = num + (1.0 - p_mastery) * (1.0 - params.p_guess)
    if den <= 0.0:
        return p_mastery
    return num / den


def update(p_mastery: float, correct: bool, params: BKTParams) -> tuple[float, float]:
    """One observation.

    Returns ``(posterior, p_next)`` -- the Bayes update, then the learning step.
    Both are returned because the interface shows them separately: seeing the
    evidence move the belief, and then the opportunity itself adding a chance to
    learn, is the part that makes the model legible to a learner.
    """
    post = posterior(p_mastery, correct, params)
    p_next = post + (1.0 - post) * params.p_transit
    return post, p_next


def trace(
    observations: Iterable[bool], params: BKTParams = LITERATURE_PRIORS
) -> list[float]:
    """Mastery estimate after each observation in a sequence."""
    p = params.p_init
    out: list[float] = []
    for correct in observations:
        _, p = update(p, correct, params)
        out.append(p)
    return out


# --------------------------------------------------------------------------- #
# Parameter fitting
# --------------------------------------------------------------------------- #

def _forward_backward(
    obs: Sequence[bool], params: BKTParams
) -> tuple[list[list[float]], list[list[float]], float]:
    """Scaled forward-backward over the two-state chain.

    States are indexed 0 = not mastered, 1 = mastered.
    Returns ``(gamma, xi, log_likelihood)``.
    """
    n = len(obs)
    g, s, t = params.p_guess, params.p_slip, params.p_transit

    def emit(state: int, correct: bool) -> float:
        if state == 1:
            return (1.0 - s) if correct else s
        return g if correct else (1.0 - g)

    # No forgetting: once mastered, always mastered.
    trans = [[1.0 - t, t], [0.0, 1.0]]

    alpha = [[0.0, 0.0] for _ in range(n)]
    scale = [0.0] * n

    alpha[0][0] = (1.0 - params.p_init) * emit(0, obs[0])
    alpha[0][1] = params.p_init * emit(1, obs[0])
    scale[0] = sum(alpha[0]) or _EPS
    alpha[0] = [a / scale[0] for a in alpha[0]]

    for i in range(1, n):
        for j in (0, 1):
            alpha[i][j] = sum(alpha[i - 1][k] * trans[k][j] for k in (0, 1)) * emit(j, obs[i])
        scale[i] = sum(alpha[i]) or _EPS
        alpha[i] = [a / scale[i] for a in alpha[i]]

    beta = [[0.0, 0.0] for _ in range(n)]
    beta[n - 1] = [1.0, 1.0]
    for i in range(n - 2, -1, -1):
        for k in (0, 1):
            beta[i][k] = sum(
                trans[k][j] * emit(j, obs[i + 1]) * beta[i + 1][j] for j in (0, 1)
            ) / scale[i + 1]

    gamma: list[list[float]] = []
    for i in range(n):
        total = sum(alpha[i][k] * beta[i][k] for k in (0, 1)) or _EPS
        gamma.append([alpha[i][k] * beta[i][k] / total for k in (0, 1)])

    xi: list[list[float]] = []
    for i in range(n - 1):
        cell = [0.0, 0.0, 0.0, 0.0]  # (0->0, 0->1, 1->0, 1->1)
        total = 0.0
        for k in (0, 1):
            for j in (0, 1):
                v = (
                    alpha[i][k]
                    * trans[k][j]
                    * emit(j, obs[i + 1])
                    * beta[i + 1][j]
                    / scale[i + 1]
                )
                cell[k * 2 + j] = v
                total += v
        total = total or _EPS
        xi.append([v / total for v in cell])

    from math import log

    ll = sum(log(max(sc, _EPS)) for sc in scale)
    return gamma, xi, ll


def fit_em(
    sequences: Sequence[Sequence[bool]],
    *,
    init: BKTParams = LITERATURE_PRIORS,
    max_iter: int = 200,
    tol: float = 1e-6,
) -> tuple[BKTParams, dict]:
    """Fit parameters by Expectation-Maximisation.

    Returns ``(params, info)`` where ``info`` carries the log-likelihood, the
    iteration count, and a ``warnings`` list.

    **This will happily produce confident nonsense on a small sample.** Four
    parameters per skill are weakly identified, and the study's roughly seven
    observations per learner per skill are nowhere near enough. The warnings say so
    rather than leaving the caller to assume the numbers mean something; the honest
    use of this function is to report that fitting did *not* beat the literature
    priors on held-out data, which is a finding, not a failure.
    """
    usable = [list(s) for s in sequences if len(s) >= 2]
    warnings: list[str] = []

    if not usable:
        warnings.append("no sequence had two or more observations; returning the priors unchanged")
        return init, {"log_likelihood": float("-nan"), "iterations": 0, "warnings": warnings}

    total_obs = sum(len(s) for s in usable)
    if total_obs < 100:
        warnings.append(
            f"only {total_obs} observations across {len(usable)} sequences; "
            "four parameters are not identifiable at this scale and the fit should "
            "not be preferred to the priors without held-out evidence"
        )

    params = init.clamped()
    prev_ll = float("-inf")
    iterations = 0

    for iterations in range(1, max_iter + 1):
        init_num = 0.0
        trans_num = trans_den = 0.0
        guess_num = guess_den = 0.0
        slip_num = slip_den = 0.0
        ll = 0.0

        for obs in usable:
            gamma, xi, seq_ll = _forward_backward(obs, params)
            ll += seq_ll
            init_num += gamma[0][1]

            for step in xi:
                trans_num += step[1]              # 0 -> 1
                trans_den += step[0] + step[1]    # any transition out of 0

            for i, correct in enumerate(obs):
                guess_den += gamma[i][0]
                slip_den += gamma[i][1]
                if correct:
                    guess_num += gamma[i][0]
                else:
                    slip_num += gamma[i][1]

        # Clamp BEFORE constructing. Degenerate data drives guess towards 1.0, and
        # BKTParams rejects guess + slip >= 1 in its constructor -- so building the
        # candidate first turns a case the cap exists to handle into a crash.
        raw_guess = _bounded(guess_num / guess_den) if guess_den > _EPS else params.p_guess
        raw_slip = _bounded(slip_num / slip_den) if slip_den > _EPS else params.p_slip

        params = BKTParams(
            p_init=_bounded(init_num / len(usable)),
            p_transit=_bounded(trans_num / trans_den) if trans_den > _EPS else params.p_transit,
            p_guess=min(raw_guess, MAX_GUESS),
            p_slip=min(raw_slip, MAX_SLIP),
        )
        if abs(ll - prev_ll) < tol:
            break
        prev_ll = ll

    if params.p_guess >= MAX_GUESS - _EPS:
        warnings.append(
            "fitted guess hit the degeneracy cap; the data does not distinguish "
            "mastery from guessing for this skill"
        )
    if params.p_slip >= MAX_SLIP - _EPS:
        warnings.append("fitted slip hit the degeneracy cap")

    return params, {"log_likelihood": prev_ll, "iterations": iterations, "warnings": warnings}


def _bounded(x: float, lo: float = 0.01, hi: float = 0.99) -> float:
    """Keep estimates off the boundary, where EM sticks and cannot recover."""
    return min(max(x, lo), hi)
