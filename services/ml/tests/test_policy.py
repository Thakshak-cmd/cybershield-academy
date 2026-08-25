"""Sequencing policy tests.

The three failure modes below were found by simulating learners against an
interaction prototype. All three are silent: nothing errors, the learner just has
a worse session. They exist as regression tests because a policy bug is invisible
in manual testing and would only surface as a disappointing study result.
"""

import pytest

from cybershield_bkt.model import LITERATURE_PRIORS, update
from cybershield_bkt.policy import (
    BOSS_MASTERY_GATE,
    BOSS_MIN_CLEARED,
    Candidate,
    capstone_unlocked,
    recommend,
    unlocked_nodes,
)

SKILLS = ["sqli", "xss", "csrf"]


def build_tree():
    """Three branches: a drill, three graded challenges, then a boss."""
    tree = []
    for skill in SKILLS:
        tree.append(Candidate(f"{skill}.drill", skill, 0.00, is_drill=True))
        tree.append(Candidate(f"{skill}.a", skill, 0.30, requires=None))
        tree.append(Candidate(f"{skill}.b", skill, 0.45, requires=f"{skill}.a"))
        tree.append(Candidate(f"{skill}.c", skill, 0.60, requires=f"{skill}.b"))
        tree.append(Candidate(f"{skill}.boss", skill, 0.75, is_boss=True, requires=f"{skill}.c"))
    return tree


def simulate(tree, *, steps=60, p_correct=0.75, seed=7):
    """Run a learner through the policy until the tree is exhausted.

    Stops once every clearable node is cleared. Running past that point measures
    nothing about the policy: with no content left, every remaining move is a
    drill by definition, so a fixed step count silently reports the ratio of
    surplus steps to tree size rather than anything the policy decided.
    """
    import random

    rng = random.Random(seed)
    mastery = {s: LITERATURE_PRIORS.p_init for s in SKILLS}
    cleared: set[str] = set()
    unlocked: set[str] = set()
    served: list[str] = []
    clearable = {c.challenge_id for c in tree if not c.is_drill}

    for _ in range(steps):
        if clearable <= cleared:
            break
        unlocked = unlocked_nodes(tree, mastery, cleared, unlocked)
        rec = recommend(tree, mastery, cleared, unlocked)
        if rec is None:
            break
        served.append(rec.challenge_id)
        correct = rng.random() < p_correct
        _, mastery[rec.skill] = update(mastery[rec.skill], correct, LITERATURE_PRIORS)
        if correct:
            node = next(c for c in tree if c.challenge_id == rec.challenge_id)
            if not node.is_drill:
                cleared.add(rec.challenge_id)

    return mastery, cleared, served


class TestUnlocking:
    def test_a_drill_is_open_from_the_start(self):
        open_now = unlocked_nodes(build_tree(), {s: 0.15 for s in SKILLS}, set())
        assert "sqli.drill" in open_now

    def test_a_node_stays_shut_until_its_prerequisite_is_cleared(self):
        # High mastery alone is not enough; sequence still holds.
        open_now = unlocked_nodes(build_tree(), {"sqli": 0.95}, cleared=set())
        assert "sqli.a" in open_now
        assert "sqli.b" not in open_now

    def test_unlocking_latches_when_mastery_later_falls(self):
        # Finding 3: one wrong answer drops mastery ~0.55 -> ~0.31. Taking back a
        # node the learner already reached reads as punishment, so the tree is
        # one-way even though the estimate is not.
        tree = build_tree()
        opened = unlocked_nodes(tree, {"sqli": 0.62}, set())
        assert "sqli.a" in opened

        still_open = unlocked_nodes(tree, {"sqli": 0.05}, set(), previously_unlocked=opened)
        assert "sqli.a" in still_open


class TestBossGate:
    def test_mastery_alone_does_not_open_a_boss(self):
        # Finding 2: two lucky answers reach ~0.88, which would hand out a
        # capstone nobody earned. Cleared count is the second lock.
        tree = build_tree()
        cleared = {"sqli.a", "sqli.b", "sqli.c"}
        high = {"sqli": 0.99}

        few = unlocked_nodes(tree, high, {"sqli.a", "sqli.c"})
        assert "sqli.boss" not in few

        enough = unlocked_nodes(tree, high, cleared)
        assert "sqli.boss" in enough

    def test_cleared_count_alone_does_not_open_a_boss(self):
        tree = build_tree()
        cleared = {"sqli.a", "sqli.b", "sqli.c"}
        assert "sqli.boss" not in unlocked_nodes(tree, {"sqli": BOSS_MASTERY_GATE - 0.01}, cleared)

    def test_boss_needs_at_least_the_configured_number_cleared(self):
        assert BOSS_MIN_CLEARED >= 3

    def test_capstone_needs_every_skill(self):
        assert not capstone_unlocked({"sqli": 0.9, "xss": 0.9, "csrf": 0.2}, SKILLS)
        assert capstone_unlocked({s: 0.75 for s in SKILLS}, SKILLS)


class TestRecommendation:
    def test_serves_the_weakest_skill(self):
        tree = build_tree()
        mastery = {"sqli": 0.80, "xss": 0.20, "csrf": 0.60}
        rec = recommend(tree, mastery, cleared=set())
        assert rec is not None and rec.skill == "xss"

    def test_prefers_new_content_over_a_drill_within_the_chosen_skill(self):
        tree = build_tree()
        # Equal mastery everywhere, so the tiebreak decides.
        rec = recommend(tree, {s: 0.50 for s in SKILLS}, cleared=set())
        assert rec is not None and not rec.challenge_id.endswith(".drill")

    def test_returns_none_when_nothing_is_open(self):
        # An empty tree means the learner has run out of content, which the caller
        # has to handle rather than being handed an arbitrary challenge.
        assert recommend([], {s: 0.5 for s in SKILLS}, cleared=set()) is None

    def test_reason_is_populated_for_the_interface(self):
        rec = recommend(build_tree(), {s: 0.15 for s in SKILLS}, cleared=set())
        assert rec is not None and rec.reason and rec.policy == "bkt-adaptive"


class TestFailureModes:
    """The three ways this policy has already been got wrong."""

    def test_does_not_grind_a_drill_forever(self):
        # Failure 1: ranking every open challenge by skill weakness makes the policy
        # rotate drills, because clearing a drill lifts its skill out of last place
        # before that skill's real content is ever served.
        #
        # Each skill legitimately needs one drill to bootstrap past its first
        # threshold, so a handful is expected -- dominance is not.
        _, cleared, served = simulate(build_tree())
        drills = [s for s in served if s.endswith(".drill")]
        assert len(drills) / len(served) < 0.4, (
            f"{len(drills)} of {len(served)} moves were drills: {served}"
        )
        assert len(cleared) == 12, f"only cleared {len(cleared)} of 12 nodes"

    def test_does_not_tunnel_down_one_branch(self):
        # Failure 2: sorting by freshness first runs one skill to ~1.0 while the
        # others stay locked.
        mastery, cleared, _ = simulate(build_tree())
        spread = max(mastery.values()) - min(mastery.values())
        assert spread < 0.60, f"mastery spread {spread:.2f}; the policy favoured one skill"
        touched = {c.split(".")[0] for c in cleared}
        assert len(touched) == 3, f"only progressed in {touched}"

    def test_progress_is_monotonic_across_a_whole_session(self):
        # Failure 3: nodes must never close again mid-session.
        tree = build_tree()
        import random

        rng = random.Random(11)
        mastery = {s: LITERATURE_PRIORS.p_init for s in SKILLS}
        cleared: set[str] = set()
        unlocked: set[str] = set()

        for _ in range(40):
            previous = set(unlocked)
            unlocked = unlocked_nodes(tree, mastery, cleared, unlocked)
            assert previous <= unlocked, f"nodes closed again: {previous - unlocked}"
            rec = recommend(tree, mastery, cleared, unlocked)
            if rec is None:
                break
            # Deliberately harsh: a struggling learner is where re-locking bites.
            correct = rng.random() < 0.4
            _, mastery[rec.skill] = update(mastery[rec.skill], correct, LITERATURE_PRIORS)
            if correct:
                node = next(c for c in tree if c.challenge_id == rec.challenge_id)
                if not node.is_drill:
                    cleared.add(rec.challenge_id)

    def test_a_struggling_learner_is_never_left_with_nothing(self):
        # Always-wrong answers drive mastery down. The drill has no threshold, so
        # there must still be something to attempt -- a dead end would strand them.
        tree = build_tree()
        mastery = {s: 0.01 for s in SKILLS}
        rec = recommend(tree, mastery, cleared=set())
        assert rec is not None
