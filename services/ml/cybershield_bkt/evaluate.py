"""Scoring the model against held-out attempts.

The thing being evaluated is ``predict_correct`` -- whether the model anticipates
the next answer -- not the mastery estimate, which is latent and has no ground
truth to compare against. Reporting "mastery rose" would be scoring the model on
its own output.

AUC and RMSE are computed here rather than pulled from scikit-learn so the metric
in the dissertation is one whose definition is visible, and so the module runs with
no third-party dependency.
"""

from __future__ import annotations

from typing import Iterable, Sequence

from .model import BKTParams, LITERATURE_PRIORS, predict_correct, update

__all__ = ["roc_auc", "rmse", "accuracy", "prequential_scores", "evaluate_sequences"]


def roc_auc(y_true: Sequence[bool], y_score: Sequence[float]) -> float:
    """Area under the ROC curve, via the Mann-Whitney U identity, ties averaged.

    Returns NaN when one class is absent -- AUC is undefined then, and returning
    0.5 would quietly look like a working-but-uninformative model instead of a
    metric that could not be computed.
    """
    pos = [s for s, y in zip(y_score, y_true) if y]
    neg = [s for s, y in zip(y_score, y_true) if not y]
    if not pos or not neg:
        return float("nan")

    ranked = sorted(range(len(y_score)), key=lambda i: y_score[i])
    ranks = [0.0] * len(y_score)
    i = 0
    while i < len(ranked):
        j = i
        while j + 1 < len(ranked) and y_score[ranked[j + 1]] == y_score[ranked[i]]:
            j += 1
        avg = (i + j) / 2.0 + 1.0          # ranks are 1-based
        for k in range(i, j + 1):
            ranks[ranked[k]] = avg
        i = j + 1

    rank_sum = sum(r for r, y in zip(ranks, y_true) if y)
    n_pos, n_neg = len(pos), len(neg)
    return (rank_sum - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg)


def rmse(y_true: Sequence[bool], y_score: Sequence[float]) -> float:
    if not y_true:
        return float("nan")
    total = sum((float(y) - p) ** 2 for y, p in zip(y_true, y_score))
    return (total / len(y_true)) ** 0.5


def accuracy(y_true: Sequence[bool], y_score: Sequence[float], threshold: float = 0.5) -> float:
    if not y_true:
        return float("nan")
    hits = sum(1 for y, p in zip(y_true, y_score) if (p >= threshold) == bool(y))
    return hits / len(y_true)


def prequential_scores(
    sequences: Iterable[Sequence[bool]], params: BKTParams = LITERATURE_PRIORS
) -> tuple[list[bool], list[float]]:
    """Predict-then-update over each sequence.

    Every observation is predicted *before* the model sees it, so nothing is scored
    on data it has already absorbed. This is the honest protocol for a sequential
    model: a plain train/test split would either leak later attempts into earlier
    predictions or throw away the ordering the model depends on.
    """
    y_true: list[bool] = []
    y_score: list[float] = []
    for obs in sequences:
        p = params.p_init
        for correct in obs:
            y_score.append(predict_correct(p, params))
            y_true.append(bool(correct))
            _, p = update(p, correct, params)
    return y_true, y_score


def evaluate_sequences(
    sequences: Iterable[Sequence[bool]], params: BKTParams = LITERATURE_PRIORS
) -> dict:
    """AUC, RMSE, accuracy and a majority-class baseline.

    The baseline is reported alongside because accuracy alone is misleading when
    most answers are correct: a model that always predicts "correct" can look
    strong while carrying no information. AUC above 0.5 is the claim that matters.
    """
    y_true, y_score = prequential_scores(sequences, params)
    base_rate = (sum(y_true) / len(y_true)) if y_true else float("nan")
    return {
        "n": len(y_true),
        "auc": roc_auc(y_true, y_score),
        "rmse": rmse(y_true, y_score),
        "accuracy": accuracy(y_true, y_score),
        "base_rate": base_rate,
        "majority_class_accuracy": max(base_rate, 1 - base_rate) if y_true else float("nan"),
    }
