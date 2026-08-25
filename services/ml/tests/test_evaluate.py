"""Evaluation metric tests.

AUC and RMSE are hand-rolled so the dissertation can state exactly what was
computed, which means they need testing against known values rather than against
whatever they happen to return.
"""

import math

import pytest

from cybershield_bkt.evaluate import (
    accuracy,
    evaluate_sequences,
    prequential_scores,
    rmse,
    roc_auc,
)
from cybershield_bkt.model import LITERATURE_PRIORS, BKTParams


class TestAUC:
    def test_perfect_separation_scores_one(self):
        assert roc_auc([False, False, True, True], [0.1, 0.2, 0.8, 0.9]) == pytest.approx(1.0)

    def test_inverted_ranking_scores_zero(self):
        assert roc_auc([True, True, False, False], [0.1, 0.2, 0.8, 0.9]) == pytest.approx(0.0)

    def test_all_ties_score_one_half(self):
        assert roc_auc([True, False, True, False], [0.5] * 4) == pytest.approx(0.5)

    def test_matches_a_hand_computed_case(self):
        # positives {0.4, 0.8}, negatives {0.2, 0.6}
        # pairs: (0.4>0.2) win, (0.4<0.6) loss, (0.8>0.2) win, (0.8>0.6) win => 3/4
        assert roc_auc([False, True, False, True], [0.2, 0.4, 0.6, 0.8]) == pytest.approx(0.75)

    def test_partial_ties_are_averaged(self):
        # positives {0.5, 0.9}, negatives {0.5, 0.1}
        # (0.5 vs 0.5) half, (0.5>0.1) win, (0.9>0.5) win, (0.9>0.1) win => 3.5/4
        assert roc_auc([True, True, False, False], [0.5, 0.9, 0.5, 0.1]) == pytest.approx(0.875)

    def test_single_class_is_undefined_not_one_half(self):
        # Returning 0.5 here would look like a working-but-uninformative model
        # instead of a metric that could not be computed. That distinction matters
        # when a skill in the study happens to have no incorrect answers.
        assert math.isnan(roc_auc([True, True, True], [0.2, 0.5, 0.9]))
        assert math.isnan(roc_auc([False, False], [0.2, 0.5]))

    def test_scale_invariance(self):
        # AUC depends only on ranking, so a monotone rescale must not change it.
        a = roc_auc([False, True, False, True], [0.2, 0.4, 0.6, 0.8])
        b = roc_auc([False, True, False, True], [20.0, 40.0, 60.0, 80.0])
        assert a == pytest.approx(b)


class TestRMSEAndAccuracy:
    def test_rmse_of_a_perfect_predictor_is_zero(self):
        assert rmse([True, False], [1.0, 0.0]) == pytest.approx(0.0)

    def test_rmse_matches_hand_calculation(self):
        # errors 0.5 and 0.5 -> sqrt(mean(0.25, 0.25)) = 0.5
        assert rmse([True, False], [0.5, 0.5]) == pytest.approx(0.5)

    def test_accuracy_thresholds_at_one_half(self):
        assert accuracy([True, False, True], [0.9, 0.1, 0.4]) == pytest.approx(2 / 3)

    def test_empty_input_is_nan_not_zero(self):
        assert math.isnan(rmse([], []))
        assert math.isnan(accuracy([], []))


class TestPrequential:
    def test_every_observation_is_predicted_before_it_is_seen(self):
        # The first prediction must equal the prediction from the prior alone --
        # proof that nothing was scored on data already absorbed.
        y_true, y_score = prequential_scores([[True, True, True]], LITERATURE_PRIORS)
        expected_first = (
            LITERATURE_PRIORS.p_init * (1 - LITERATURE_PRIORS.p_slip)
            + (1 - LITERATURE_PRIORS.p_init) * LITERATURE_PRIORS.p_guess
        )
        assert y_score[0] == pytest.approx(expected_first)
        assert len(y_true) == len(y_score) == 3

    def test_predictions_rise_as_the_learner_succeeds(self):
        _, y_score = prequential_scores([[True] * 5], LITERATURE_PRIORS)
        assert y_score == sorted(y_score)

    def test_each_sequence_starts_from_the_prior(self):
        _, y_score = prequential_scores([[True, True], [True, True]], LITERATURE_PRIORS)
        assert y_score[0] == pytest.approx(y_score[2])


class TestEvaluateSequences:
    def test_reports_a_baseline_alongside_accuracy(self):
        # Accuracy alone flatters the model when most answers are correct, so the
        # majority-class figure has to sit next to it.
        result = evaluate_sequences([[True] * 9 + [False]])
        assert result["majority_class_accuracy"] == pytest.approx(0.9)
        assert result["n"] == 10

    def test_beats_chance_on_learners_who_actually_improve(self):
        # Strugglers fail throughout, improvers turn a corner. A model tracking
        # knowledge should rank these apart.
        sequences = [[False] * 8 for _ in range(15)] + [[True] * 8 for _ in range(15)]
        result = evaluate_sequences(sequences)
        assert result["auc"] > 0.5
        assert 0.0 <= result["rmse"] <= 1.0

    def test_a_miscalibrated_model_scores_worse(self):
        # A model that thinks everyone already knows everything should have higher
        # error on learners who mostly fail.
        sequences = [[False] * 6 for _ in range(10)]
        good = evaluate_sequences(sequences, LITERATURE_PRIORS)
        bad = evaluate_sequences(sequences, BKTParams(p_init=0.95, p_transit=0.5, p_guess=0.4, p_slip=0.05))
        assert bad["rmse"] > good["rmse"]
