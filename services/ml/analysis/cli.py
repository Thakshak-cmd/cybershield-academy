"""Read the analysis request on stdin, write results as JSON on stdout.

    python -m analysis.cli < request.json

The request carries the BKT observations from the export (one sequence per
learner per skill, in log order) and, optionally, the outcome scores collected
outside the platform. Called by scripts/study/analyse.mjs; nothing here touches
the database or the export file, so this process never sees participant data
beyond correctness flags and scores.
"""

from __future__ import annotations

import json
from dataclasses import asdict
import math
import re
import sys
from collections import defaultdict

from cybershield_bkt.evaluate import accuracy, evaluate_sequences, prequential_scores, rmse, roc_auc
from cybershield_bkt.model import LITERATURE_PRIORS, fit_em

from .stats import SUS_BENCHMARK, describe, hake_gain, sus_score, wilcoxon_signed_rank


def evaluate_model(sequences: list[dict]) -> dict:
    """Score the model on the study's own attempts.

    Two versions of the same question. With the literature priors -- the
    parameters the platform actually ran on during the study -- and with
    parameters fitted by EM under leave-one-learner-out, so no learner is ever
    predicted by a model that was fitted on their own answers.

    Both are predict-then-update: each answer is predicted before the model
    sees it. Both are reported beside the majority-class baseline, because on a
    sample this size "accuracy 0.7" means nothing until you know that always
    guessing "correct" scores 0.7 too.
    """
    by_skill: dict[str, list[tuple[str, list[bool]]]] = defaultdict(list)
    for s in sequences:
        if s["observations"]:
            by_skill[s["skill"]].append((s["subject"], [bool(x) for x in s["observations"]]))

    all_seqs = [obs for seqs in by_skill.values() for _, obs in seqs]
    priors = evaluate_sequences(all_seqs, LITERATURE_PRIORS)
    per_skill = {k: evaluate_sequences([o for _, o in v], LITERATURE_PRIORS) for k, v in sorted(by_skill.items())}

    y_true: list[bool] = []
    y_score: list[float] = []
    warnings: set[str] = set()
    fitted: dict[str, list[dict]] = defaultdict(list)
    subjects = sorted({subj for seqs in by_skill.values() for subj, _ in seqs})
    for held_out in subjects:
        for skill, seqs in by_skill.items():
            test = [o for subj, o in seqs if subj == held_out]
            if not test:
                continue
            train = [o for subj, o in seqs if subj != held_out]
            params, info = fit_em(train, init=LITERATURE_PRIORS)
            warnings.update(info.get("warnings", []))
            fitted[skill].append(asdict(params))
            t, p = prequential_scores(test, params)
            y_true += t
            y_score += p

    base = (sum(y_true) / len(y_true)) if y_true else float("nan")
    loo = {
        "n": len(y_true),
        "auc": roc_auc(y_true, y_score),
        "rmse": rmse(y_true, y_score),
        "accuracy": accuracy(y_true, y_score),
        "majority_class_accuracy": max(base, 1 - base) if y_true else float("nan"),
    }

    return {
        "learners": len(subjects),
        "sequences": len(all_seqs),
        "observations_per_sequence": describe(len(o) for o in all_seqs),
        "literature_priors": {**priors, "params": asdict(LITERATURE_PRIORS)},
        "per_skill": per_skill,
        "fitted_leave_one_out": loo,
        "fit_warnings": _collapse(warnings),
        "fitted_params_range": {
            skill: {key: [min(p[key] for p in ps), max(p[key] for p in ps)] for key in ps[0]}
            for skill, ps in fitted.items() if ps
        },
    }


def _collapse(warnings: set[str]) -> list[str]:
    """One line per kind of warning, not one per held-out learner.

    Leave-one-out fits the model once per learner, so the same caution arrives
    a dozen times with slightly different counts in it.
    """
    groups: dict[str, list[str]] = defaultdict(list)
    for w in sorted(warnings):
        groups[re.sub(r"\d+", "N", w)].append(w)
    return [ws[0] if len(ws) == 1 else f"{ws[0]} (and {len(ws) - 1} similar, one per held-out fit)"
            for ws in groups.values()]


def analyse_outcomes(rows: list[dict], test_max: float | None) -> dict:
    """Pre/post knowledge gain and usability, from the scores collected on paper.

    Rows are keyed by whatever participant code the researcher used; they do not
    need to match subject ids, because pairing pre with post needs only that both
    belong to the same person.
    """
    out: dict = {}
    paired = [r for r in rows if r.get("pre") is not None and r.get("post") is not None]
    if paired:
        pre = [float(r["pre"]) for r in paired]
        post = [float(r["post"]) for r in paired]
        out["knowledge"] = {
            "pre": describe(pre),
            "post": describe(post),
            "change": describe(b - a for a, b in zip(pre, post)),
            "wilcoxon": wilcoxon_signed_rank(pre, post),
            **({"normalised_gain": hake_gain(pre, post, test_max)} if test_max else {}),
        }
    scores = []
    for r in rows:
        if r.get("sus_items"):
            scores.append(sus_score(r["sus_items"]))
        elif r.get("sus") is not None:
            scores.append(float(r["sus"]))
    if scores:
        out["sus"] = {
            **describe(scores),
            "benchmark": SUS_BENCHMARK,
            "above_benchmark": sum(1 for s in scores if s > SUS_BENCHMARK),
            "wilcoxon_vs_benchmark": wilcoxon_signed_rank([SUS_BENCHMARK] * len(scores), scores),
        }
    return out


def _clean(value):
    """JSON has no NaN; send null so the report can say 'not computable'."""
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    return value


def main() -> None:
    request = json.load(sys.stdin)
    result = {"model": evaluate_model(request.get("sequences", []))}
    if request.get("outcomes"):
        result["outcomes"] = analyse_outcomes(request["outcomes"], request.get("testMax"))
    json.dump(_clean(result), sys.stdout)


if __name__ == "__main__":
    main()
