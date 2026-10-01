"""Model evaluation on study-shaped data."""

import random

from analysis.cli import analyse_outcomes, evaluate_model
from cybershield_bkt.model import LITERATURE_PRIORS, predict_correct, update


def _learners(n=12, per_skill=7, seed=1):
    """Simulated learners whose answers come from BKT itself, so a working
    evaluation should find the model informative (AUC above 0.5)."""
    rng = random.Random(seed)
    out = []
    for i in range(n):
        for skill in ("sqli", "xss", "csrf"):
            mastered = rng.random() < LITERATURE_PRIORS.p_init
            obs = []
            for _ in range(per_skill):
                p = (1 - LITERATURE_PRIORS.p_slip) if mastered else LITERATURE_PRIORS.p_guess
                obs.append(rng.random() < p)
                if not mastered and rng.random() < LITERATURE_PRIORS.p_transit:
                    mastered = True
            out.append({"subject": f"s{i}", "skill": skill, "observations": obs})
    return out


def test_reports_priors_and_leave_one_out_against_the_baseline():
    r = evaluate_model(_learners())
    assert r["learners"] == 12
    assert r["sequences"] == 36
    for key in ("literature_priors", "fitted_leave_one_out"):
        assert r[key]["n"] == 12 * 3 * 7
        assert 0 <= r[key]["auc"] <= 1
        assert r[key]["majority_class_accuracy"] >= 0.5
    assert r["literature_priors"]["auc"] > 0.5, "data drawn from BKT should be predictable by BKT"


def test_says_so_when_fitting_is_unreliable():
    r = evaluate_model(_learners(n=3, per_skill=3))
    assert r["fit_warnings"], "a tiny sample must come with a warning, not confident numbers"


def test_empty_input_is_not_a_crash():
    r = evaluate_model([])
    assert r["learners"] == 0


def test_outcomes_pair_pre_with_post_and_score_sus():
    rows = [
        {"pre": 4, "post": 7, "sus_items": [5, 1] * 5},
        {"pre": 5, "post": 8, "sus": 72.5},
        {"pre": 6, "post": 6},
        {"sus": 60},
    ]
    r = analyse_outcomes(rows, 10)
    assert r["knowledge"]["wilcoxon"]["n_pairs"] == 3
    assert r["knowledge"]["wilcoxon"]["n_zero"] == 1
    assert r["sus"]["n"] == 3
    assert r["sus"]["above_benchmark"] == 2
    assert "normalised_gain" in r["knowledge"]
