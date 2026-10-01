"""Statistics for the study's outcome measures, standard library only.

The sample is about twelve people, measured twice. That settles the choice of
test: the paired t-test assumes the differences are normally distributed, which
twelve points cannot show, so the primary test is the Wilcoxon signed-rank test
with an *exact* p-value -- computed from the full permutation distribution
rather than a normal approximation that is poor at this size.

Written out rather than imported from SciPy so every number in the Evaluation
chapter comes from a definition visible in this repository, as the model's own
AUC and RMSE are.
"""

from __future__ import annotations

import math
from typing import Iterable, Sequence

__all__ = [
    "describe", "wilcoxon_signed_rank", "hake_gain", "sus_score", "SUS_BENCHMARK",
]

#: The mean SUS score across the large published corpus (Sauro, 2011). A score
#: above it is above average usability; the proposal's target of 70 sits just above.
SUS_BENCHMARK = 68.0


def describe(values: Iterable[float]) -> dict:
    """n, mean, sample SD, median, quartiles, min and max. NaN where undefined."""
    xs = sorted(float(v) for v in values if v is not None and not math.isnan(float(v)))
    n = len(xs)
    if n == 0:
        nan = float("nan")
        return {"n": 0, "mean": nan, "sd": nan, "median": nan, "q1": nan, "q3": nan, "min": nan, "max": nan}
    mean = sum(xs) / n
    sd = math.sqrt(sum((x - mean) ** 2 for x in xs) / (n - 1)) if n > 1 else float("nan")
    return {
        "n": n, "mean": mean, "sd": sd,
        "median": _quantile(xs, 0.5), "q1": _quantile(xs, 0.25), "q3": _quantile(xs, 0.75),
        "min": xs[0], "max": xs[-1],
    }


def _quantile(xs: Sequence[float], q: float) -> float:
    """Linear interpolation between order statistics (the common 'type 7')."""
    pos = (len(xs) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)


def wilcoxon_signed_rank(before: Sequence[float], after: Sequence[float]) -> dict:
    """Exact two-sided Wilcoxon signed-rank test on paired scores.

    Zero differences are dropped (Wilcoxon's original treatment) and reported, so
    a reader can see how many participants did not change. Tied absolute
    differences share their average rank, and the exact null distribution is
    built over those actual ranks, so ties do not invalidate the p-value.

    The effect size is the matched-pairs rank-biserial correlation,
    r = (W+ - W-) / (W+ + W-): +1 when everyone improved, 0 when gains and losses
    balance. Reported because with n = 12 a p-value alone says little about size.
    """
    if len(before) != len(after):
        raise ValueError("before and after must pair up, one score each per participant")
    diffs = [float(b) - float(a) for a, b in zip(before, after)]
    nonzero = [d for d in diffs if d != 0]
    n = len(nonzero)
    result = {"n_pairs": len(diffs), "n_zero": len(diffs) - n, "n": n}
    if n == 0:
        return {**result, "w_plus": 0.0, "w_minus": 0.0, "p_value": 1.0, "rank_biserial": 0.0}

    ranks = _average_ranks([abs(d) for d in nonzero])
    w_plus = sum(r for r, d in zip(ranks, nonzero) if d > 0)
    w_minus = sum(r for r, d in zip(ranks, nonzero) if d < 0)

    # Null: each rank is equally likely to carry either sign. Doubled ranks are
    # integers even with ties (average ranks are whole or half), so the
    # distribution of W+ can be built by exact counting.
    doubled = [round(r * 2) for r in ranks]
    counts = {0: 1}
    for r in doubled:
        nxt = dict(counts)
        for total, ways in counts.items():
            nxt[total + r] = nxt.get(total + r, 0) + ways
        counts = nxt
    total_ways = 2 ** n
    observed = round(w_plus * 2)
    lower = sum(w for s, w in counts.items() if s <= observed) / total_ways
    upper = sum(w for s, w in counts.items() if s >= observed) / total_ways
    p = min(1.0, 2 * min(lower, upper))

    return {
        **result,
        "w_plus": w_plus,
        "w_minus": w_minus,
        "p_value": p,
        "rank_biserial": (w_plus - w_minus) / (w_plus + w_minus),
    }


def _average_ranks(values: Sequence[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        avg = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def hake_gain(before: Sequence[float], after: Sequence[float], maximum: float) -> dict:
    """Normalised learning gain (Hake, 1998).

    The share of the available improvement actually achieved: (post - pre) /
    (max - pre). It stops a participant who started high from looking like they
    learnt less simply because they had less room to improve.

    Reports both the class-average gain from the mean scores, which is Hake's
    definition, and the mean of individual gains, which differ; participants who
    scored full marks before the session have no defined individual gain and are
    counted, not silently dropped.
    """
    pairs = list(zip(before, after))
    if not pairs:
        return {"class_gain": float("nan"), "mean_individual_gain": float("nan"), "undefined": 0}
    mean_pre = sum(a for a, _ in pairs) / len(pairs)
    mean_post = sum(b for _, b in pairs) / len(pairs)
    class_gain = (mean_post - mean_pre) / (maximum - mean_pre) if maximum > mean_pre else float("nan")
    individual = [(b - a) / (maximum - a) for a, b in pairs if maximum > a]
    return {
        "class_gain": class_gain,
        "mean_individual_gain": sum(individual) / len(individual) if individual else float("nan"),
        "undefined": len(pairs) - len(individual),
    }


def sus_score(items: Sequence[int]) -> float:
    """Score one SUS questionnaire (Brooke, 1996) from its ten 1-5 answers.

    Odd items are positively worded and contribute (answer - 1); even items are
    negatively worded and contribute (5 - answer). The sum times 2.5 gives 0-100.
    """
    if len(items) != 10:
        raise ValueError(f"SUS has ten items, got {len(items)}")
    if any(not 1 <= int(x) <= 5 for x in items):
        raise ValueError("SUS answers are 1 to 5")
    total = sum((int(x) - 1) if i % 2 == 0 else (5 - int(x)) for i, x in enumerate(items))
    return total * 2.5
