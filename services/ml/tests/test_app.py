"""HTTP layer tests, against a real ASGI client."""

import pytest
from fastapi.testclient import TestClient

from app import app

client = TestClient(app)

TREE = [
    {"challenge_id": "sqli.drill", "skill": "sqli", "mastery_required": 0.0, "is_drill": True},
    {"challenge_id": "sqli.a", "skill": "sqli", "mastery_required": 0.30},
    {"challenge_id": "sqli.b", "skill": "sqli", "mastery_required": 0.45, "requires": "sqli.a"},
    {"challenge_id": "xss.drill", "skill": "xss", "mastery_required": 0.0, "is_drill": True},
    {"challenge_id": "xss.a", "skill": "xss", "mastery_required": 0.30},
]


def body(**over):
    return {"observations": [], "candidates": TREE, "cleared": [], "unlocked": [], **over}


class TestHealth:
    def test_health_answers(self):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json()["ok"] is True


class TestMastery:
    def test_a_learner_with_no_history_sits_at_the_prior(self):
        r = client.post("/mastery", json=body())
        assert r.status_code == 200
        assert r.json()["mastery"] == {"sqli": pytest.approx(0.15), "xss": pytest.approx(0.15)}

    def test_mastery_is_replayed_from_the_observations(self):
        # Two correct answers should reproduce the hand-checked trace.
        r = client.post("/mastery", json=body(observations=[
            {"skill": "sqli", "correct": True},
            {"skill": "sqli", "correct": True},
        ]))
        assert r.json()["mastery"]["sqli"] == pytest.approx(0.879, abs=1e-3)

    def test_the_same_history_always_gives_the_same_answer(self):
        # Recomputed from the log rather than stored, so this must be a pure
        # function of the input. A drift here would be a silent inconsistency
        # between the model and the log it claims to summarise.
        obs = [{"skill": "sqli", "correct": True}, {"skill": "sqli", "correct": False}]
        first = client.post("/mastery", json=body(observations=obs)).json()
        second = client.post("/mastery", json=body(observations=obs)).json()
        assert first == second

    def test_unlocked_nodes_are_reported(self):
        r = client.post("/mastery", json=body(observations=[{"skill": "sqli", "correct": True}]))
        assert "sqli.a" in r.json()["unlocked"]

    def test_previously_unlocked_nodes_survive_a_drop_in_mastery(self):
        # Unlocking latches. Without passing `unlocked` back the tree would appear
        # to close again after a wrong answer.
        r = client.post("/mastery", json=body(
            observations=[{"skill": "sqli", "correct": False}] * 3,
            unlocked=["sqli.a"],
        ))
        assert "sqli.a" in r.json()["unlocked"]

    def test_an_unknown_skill_in_the_history_is_tolerated(self):
        # Content can be retired between a learner's session and this call.
        r = client.post("/mastery", json=body(observations=[{"skill": "csrf", "correct": True}]))
        assert r.status_code == 200
        assert "csrf" in r.json()["mastery"]


class TestRecommend:
    def test_a_fresh_learner_gets_the_bootstrap_drill(self):
        r = client.post("/recommend", json=body())
        assert r.status_code == 200
        assert r.json()["challenge_id"].endswith(".drill")

    def test_the_weakest_skill_is_served(self):
        r = client.post("/recommend", json=body(observations=[
            {"skill": "sqli", "correct": True},
            {"skill": "sqli", "correct": True},
        ]))
        assert r.json()["skill"] == "xss"

    def test_a_reason_is_returned_for_the_interface(self):
        r = client.post("/recommend", json=body())
        assert r.json()["reason"]
        assert r.json()["policy"] == "bkt-adaptive"

    def test_exhausted_content_is_204_not_an_error(self):
        # An empty body must never be mistaken for the service being down.
        r = client.post("/recommend", json={"observations": [], "candidates": [],
                                            "cleared": [], "unlocked": []})
        assert r.status_code == 204
        assert not r.content

    def test_mastery_travels_with_the_recommendation(self):
        # Saves the caller a second round trip to render the character sheet.
        r = client.post("/recommend", json=body(observations=[{"skill": "sqli", "correct": True}]))
        assert r.json()["mastery"]["sqli"] == pytest.approx(0.554, abs=1e-3)


class TestValidation:
    def test_a_malformed_observation_is_rejected(self):
        r = client.post("/recommend", json=body(observations=[{"skill": "sqli"}]))
        assert r.status_code == 422

    def test_a_missing_body_is_rejected(self):
        assert client.post("/recommend").status_code == 422

    def test_defaults_make_every_field_optional(self):
        assert client.post("/mastery", json={}).status_code == 200
