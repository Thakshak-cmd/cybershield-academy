"""BKT model tests.

The numeric expectations are worked by hand from the update rule rather than
recorded from a previous run, so a change in behaviour fails the test instead of
quietly redefining what the model does.
"""

import math

import pytest

from cybershield_bkt.model import (
    LITERATURE_PRIORS,
    MAX_GUESS,
    BKTParams,
    fit_em,
    posterior,
    predict_correct,
    trace,
    update,
)


class TestParameterValidation:
    def test_probabilities_must_be_in_range(self):
        with pytest.raises(ValueError, match="p_guess"):
            BKTParams(p_guess=1.4)

    def test_guess_plus_slip_must_stay_below_one(self):
        # Otherwise an incorrect answer raises the mastery estimate, which makes
        # the "mastered" state mean the opposite of its name.
        with pytest.raises(ValueError, match="below 1.0"):
            BKTParams(p_guess=0.6, p_slip=0.5)

    def test_clamping_pulls_back_into_the_non_degenerate_region(self):
        p = BKTParams(p_guess=0.49, p_slip=0.49).clamped()
        assert p.p_guess <= MAX_GUESS and p.p_slip <= MAX_GUESS


class TestUpdate:
    def test_correct_answer_matches_hand_calculation(self):
        # L=0.15, S=0.10, G=0.20
        #   posterior = 0.15*0.90 / (0.15*0.90 + 0.85*0.20) = 0.135/0.305
        post, nxt = update(0.15, True, LITERATURE_PRIORS)
        assert post == pytest.approx(0.135 / 0.305, abs=1e-9)
        # then the learning step: post + (1-post)*T
        assert nxt == pytest.approx(post + (1 - post) * 0.20, abs=1e-9)
        assert nxt == pytest.approx(0.5541, abs=1e-4)

    def test_incorrect_answer_matches_hand_calculation(self):
        # L=0.5541, S=0.10, G=0.20
        #   posterior = 0.5541*0.10 / (0.5541*0.10 + 0.4459*0.80)
        post, nxt = update(0.5541, False, LITERATURE_PRIORS)
        assert post == pytest.approx(0.05541 / (0.05541 + 0.35672), abs=1e-6)
        assert nxt == pytest.approx(0.3076, abs=1e-4)

    def test_a_correct_answer_never_lowers_the_estimate(self):
        for p in (0.01, 0.15, 0.5, 0.9, 0.99):
            _, nxt = update(p, True, LITERATURE_PRIORS)
            assert nxt >= p

    def test_an_incorrect_answer_lowers_the_posterior(self):
        # The transit step can still lift the final value, but the evidence itself
        # must always count against mastery.
        for p in (0.15, 0.5, 0.9):
            assert posterior(p, False, LITERATURE_PRIORS) < p

    def test_estimate_stays_a_probability(self):
        p = 0.15
        for correct in [True, False, True, True, False] * 20:
            _, p = update(p, correct, LITERATURE_PRIORS)
            assert 0.0 <= p <= 1.0

    def test_convergence_is_fast_enough_to_need_a_separate_gate(self):
        # Two correct answers carry a novice from 0.15 to about 0.88. This is
        # correct inference and bad progression, and it is exactly why boss
        # unlocking also requires a count of cleared challenges.
        # See docs/game-design.md section 5, finding 2.
        after_two = trace([True, True])[-1]
        assert after_two > 0.85


class TestPredict:
    def test_prediction_interpolates_between_guess_and_slip(self):
        assert predict_correct(0.0, LITERATURE_PRIORS) == pytest.approx(0.20)
        assert predict_correct(1.0, LITERATURE_PRIORS) == pytest.approx(0.90)

    def test_prediction_rises_with_mastery(self):
        vals = [predict_correct(p / 10, LITERATURE_PRIORS) for p in range(11)]
        assert vals == sorted(vals)


class TestFitEM:
    def test_recovers_parameters_from_plentiful_synthetic_data(self):
        import random

        rng = random.Random(20260825)
        truth = BKTParams(p_init=0.10, p_transit=0.30, p_guess=0.15, p_slip=0.08)

        sequences = []
        for _ in range(400):
            mastered = rng.random() < truth.p_init
            seq = []
            for _ in range(12):
                p_correct = (1 - truth.p_slip) if mastered else truth.p_guess
                seq.append(rng.random() < p_correct)
                if not mastered and rng.random() < truth.p_transit:
                    mastered = True
            sequences.append(seq)

        fitted, info = fit_em(sequences)
        # Loose bounds: EM on a weakly-identified model recovers the region, not
        # the point. Recovering the region is the claim being tested.
        assert fitted.p_guess == pytest.approx(truth.p_guess, abs=0.10)
        assert fitted.p_slip == pytest.approx(truth.p_slip, abs=0.10)
        assert fitted.p_transit == pytest.approx(truth.p_transit, abs=0.15)
        assert info["iterations"] > 1
        assert not info["warnings"]

    def test_warns_when_the_sample_is_too_small_to_identify_parameters(self):
        # This is the study's actual regime: ~12 learners, a handful of
        # observations each. The warning has to fire, because a silent fit here
        # would be reported as though it meant something.
        sequences = [[True, False, True]] * 12
        _, info = fit_em(sequences)
        assert any("not identifiable" in w for w in info["warnings"])

    def test_empty_input_returns_the_priors_untouched(self):
        fitted, info = fit_em([])
        assert fitted == LITERATURE_PRIORS
        assert info["iterations"] == 0
        assert any("no sequence" in w for w in info["warnings"])

    def test_single_observation_sequences_are_unusable(self):
        # One observation cannot inform a transition probability.
        fitted, info = fit_em([[True], [False], [True]])
        assert fitted == LITERATURE_PRIORS
        assert any("no sequence" in w for w in info["warnings"])

    def test_fitted_parameters_never_leave_the_non_degenerate_region(self):
        # All-correct data pushes guess towards 1.0, where mastery becomes
        # meaningless. The cap must hold and the warning must fire.
        fitted, info = fit_em([[True] * 12 for _ in range(60)])
        assert fitted.p_guess <= MAX_GUESS
        assert fitted.p_guess + fitted.p_slip < 1.0
        assert any("degeneracy cap" in w for w in info["warnings"])
