"""The outcome statistics, checked against values worked out by hand."""

import math

import pytest

from analysis.stats import describe, hake_gain, sus_score, wilcoxon_signed_rank


def test_describe_uses_the_sample_sd():
    d = describe([2, 4, 4, 4, 5, 5, 7, 9])
    assert d["mean"] == 5
    assert d["sd"] == pytest.approx(2.13809, abs=1e-5)  # n-1 denominator
    assert d["median"] == 4.5


def test_describe_of_nothing_is_not_zero():
    assert math.isnan(describe([])["mean"])


def test_wilcoxon_everyone_improved():
    # n = 6, all positive: W+ = 21, and only 1 of the 64 sign patterns is that
    # extreme in each tail, so p = 2/64.
    r = wilcoxon_signed_rank([1, 2, 3, 4, 5, 6], [2, 4, 6, 8, 10, 12])
    assert r["w_plus"] == 21 and r["w_minus"] == 0
    assert r["p_value"] == pytest.approx(2 / 64)
    assert r["rank_biserial"] == 1


def test_wilcoxon_matches_a_hand_count():
    # differences 1, -2, 3, 4: ranks 1, 2, 3, 4; W+ = 8. Of the 16 sign patterns,
    # the subsets of {1,2,3,4} summing to 8 or more are {1,3,4}, {2,3,4} and
    # {1,2,3,4}: P(W+ >= 8) = 3/16, the smaller tail, so p = 2 * 3/16.
    r = wilcoxon_signed_rank([0, 0, 0, 0], [1, -2, 3, 4])
    assert r["w_plus"] == 8 and r["w_minus"] == 2
    assert r["p_value"] == pytest.approx(6 / 16)


def test_wilcoxon_drops_and_reports_zero_differences():
    r = wilcoxon_signed_rank([5, 5, 1, 2], [5, 5, 3, 4])
    assert r["n_zero"] == 2 and r["n"] == 2


def test_wilcoxon_handles_tied_ranks():
    # |d| = 1, 1, 2: average ranks 1.5, 1.5, 3. All positive: p = 2/8.
    r = wilcoxon_signed_rank([0, 0, 0], [1, 1, 2])
    assert r["w_plus"] == 6
    assert r["p_value"] == pytest.approx(2 / 8)


def test_wilcoxon_insists_on_pairs():
    with pytest.raises(ValueError):
        wilcoxon_signed_rank([1, 2], [1])


def test_hake_gain_is_share_of_available_improvement():
    g = hake_gain([40, 60], [70, 80], 100)
    assert g["class_gain"] == pytest.approx((75 - 50) / (100 - 50))
    assert g["mean_individual_gain"] == pytest.approx((0.5 + 0.5) / 2)


def test_hake_gain_counts_full_marks_instead_of_dropping_them():
    g = hake_gain([100, 50], [100, 75], 100)
    assert g["undefined"] == 1


def test_sus_scoring():
    assert sus_score([5, 1] * 5) == 100
    assert sus_score([1, 5] * 5) == 0
    assert sus_score([3] * 10) == 50


def test_sus_rejects_bad_answers():
    with pytest.raises(ValueError):
        sus_score([3] * 9)
    with pytest.raises(ValueError):
        sus_score([6] + [3] * 9)
