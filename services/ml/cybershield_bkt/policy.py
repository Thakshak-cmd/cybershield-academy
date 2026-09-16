"""Adaptive challenge sequencing.

Deciding what to serve next turned out to be the subtlest part of the adaptive
layer. Two obvious policies both fail, and both fail *silently* -- the learner just
has a worse session, and nothing errors. The failure modes below were found by
simulating learners against a prototype, and each has a regression test.

    Sort by weakest skill alone
        The weakest skill's only open node is usually the repeatable drill.
        Drills raise mastery but never mark progress, so the policy grinds the
        same drill forever and nothing downstream ever unlocks.

    Sort by "prefer content not yet seen"
        The opposite failure. The policy tunnels down whichever branch it opened
        first, running one skill to near 1.0 while the others stay locked.

    Weakest skill primary, freshness as tiebreak  <- what this module does
        Balances across skills while still preferring new content within the
        skill it has chosen.

This is a plain explore/exploit trade-off, and naming it as such is more honest
than presenting the working version as though it were the obvious first choice.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Sequence

from .model import LITERATURE_PRIORS

__all__ = ["Candidate", "Recommendation", "recommend", "unlocked_nodes", "boss_unlocked"]


#: A boss also requires this many distinct cleared challenges in its skill.
#: Mastery alone is not enough: BKT converges fast enough that two lucky answers
#: can carry a learner from 0.15 to ~0.88, which would hand out a capstone nobody
#: earned. See docs/game-design.md section 5, finding 2.
BOSS_MIN_CLEARED = 3
BOSS_MASTERY_GATE = 0.75
CAPSTONE_MASTERY_GATE = 0.70


@dataclass(frozen=True)
class Candidate:
    """A challenge the learner could be served."""

    challenge_id: str
    skill: str
    mastery_required: float = 0.0
    is_drill: bool = False
    is_boss: bool = False
    #: Challenge that must be cleared first. Drills have none.
    requires: str | None = None


@dataclass(frozen=True)
class Recommendation:
    challenge_id: str
    skill: str
    p_mastery: float
    policy: str
    reason: str


def unlocked_nodes(
    candidates: Sequence[Candidate],
    mastery: Mapping[str, float],
    cleared: set[str],
    previously_unlocked: set[str] | None = None,
) -> set[str]:
    """Which challenges are currently open.

    Unlocking latches. Once a node has opened it stays open even if mastery later
    falls below the threshold that opened it, because taking back a node the
    learner already reached reads as punishment and breaks the expectation that
    progress is monotonic. The mastery estimate still moves in both directions;
    only the tree is one-way. See docs/game-design.md section 5, finding 3.
    """
    open_now = set(previously_unlocked or ())

    for c in candidates:
        if c.challenge_id in open_now:
            continue
        if c.requires and c.requires not in cleared:
            continue

        level = mastery.get(c.skill, 0.0)
        if c.is_boss:
            if boss_unlocked(c.skill, mastery, cleared, candidates):
                open_now.add(c.challenge_id)
        elif level >= c.mastery_required:
            open_now.add(c.challenge_id)

    return open_now


def boss_unlocked(
    skill: str,
    mastery: Mapping[str, float],
    cleared: set[str],
    candidates: Sequence[Candidate],
) -> bool:
    """A boss needs demonstrated mastery *and* a body of work behind it."""
    if mastery.get(skill, 0.0) < BOSS_MASTERY_GATE:
        return False
    cleared_in_skill = sum(
        1 for c in candidates if c.skill == skill and not c.is_boss and c.challenge_id in cleared
    )
    return cleared_in_skill >= BOSS_MIN_CLEARED


def capstone_unlocked(mastery: Mapping[str, float], skills: Sequence[str]) -> bool:
    """The cross-skill transfer task: every domain has to hold up."""
    return all(mastery.get(s, 0.0) >= CAPSTONE_MASTERY_GATE for s in skills)


def recommend(
    candidates: Sequence[Candidate],
    mastery: Mapping[str, float],
    cleared: set[str],
    previously_unlocked: set[str] | None = None,
) -> Recommendation | None:
    """Choose the next challenge.

    Uncleared real content is always preferred; among it, the weakest skill wins,
    then the hardest challenge actually unlocked, then id for determinism. Drills
    are only served when nothing new is open anywhere -- see the comment in the
    body for why that has to be a separate tier rather than a tiebreak.

    Returns ``None`` when nothing is open, which the caller must handle: it means
    the learner has exhausted the content, not that any challenge will do.
    """
    open_ids = unlocked_nodes(candidates, mastery, cleared, previously_unlocked)
    options = [c for c in candidates if c.challenge_id in open_ids]
    if not options:
        return None

    def within_skill(c: Candidate):
        # Fresh content before a drill, then the hardest thing actually unlocked.
        return (1 if c.is_drill else 0, -c.mastery_required, c.challenge_id)

    # Choose the SKILL first, then the challenge within it.
    #
    # Both earlier attempts failed by conflating the two decisions in one sort.
    # Ranking every open challenge by skill weakness makes the policy rotate
    # drills, because a drill lifts its skill out of last place before its real
    # content is ever served. Preferring fresh content globally does the opposite:
    # a skill below its first threshold has nothing fresh to offer, so whichever
    # branch bootstrapped first is run to its boss while the others sit at 0.15.
    #
    # Picking the weakest skill and then asking what is available *in that skill*
    # keeps attention where the model is least confident while still consuming the
    # tree, because the drill is the bootstrap for exactly the skill that needs it.
    by_skill: dict[str, list[Candidate]] = {}
    for c in options:
        if c.challenge_id in cleared and not c.is_drill:
            continue  # already beaten; nothing left to demonstrate
        by_skill.setdefault(c.skill, []).append(c)

    if not by_skill:
        # Everything open has been cleared and no drill remains.
        choice = sorted(options, key=lambda c: (mastery.get(c.skill, 0.0), c.challenge_id))[0]
        return Recommendation(
            challenge_id=choice.challenge_id,
            skill=choice.skill,
            p_mastery=mastery.get(choice.skill, 0.0),
            policy="bkt-adaptive",
            reason="everything open has been cleared; repeating the weakest skill",
        )

    skill = min(by_skill, key=lambda s: (mastery.get(s, 0.0), s))
    level = mastery.get(skill, 0.0)

    # Cold start: a learner who has never touched this skill gets its drill first.
    #
    # Ordinary ordering prefers fresh content over a drill, which is right once
    # the learner is moving -- it is what stops drills being ground forever. But
    # for first contact it hands a novice a full patching task with no warm-up.
    # The drill is a thirty-second "point at the line" that also gives the model
    # its first observation before anything expensive is attempted.
    #
    # "Never touched" means mastery still sits at the prior, which only holds
    # before the first observation. After that, the usual rule takes over, so
    # this cannot become a way of grinding drills.
    untouched = abs(level - LITERATURE_PRIORS.p_init) < 1e-9
    drills = [c for c in by_skill[skill] if c.is_drill]
    if untouched and drills:
        choice = sorted(drills, key=within_skill)[0]
        reason = f"{skill} is new to you -- a warm-up before anything bigger"
        return Recommendation(
            challenge_id=choice.challenge_id,
            skill=skill,
            p_mastery=level,
            policy="bkt-adaptive",
            reason=reason,
        )

    choice = sorted(by_skill[skill], key=within_skill)[0]

    if choice.is_drill:
        reason = f"{skill} is weakest at {level:.2f} and only the drill is open"
    elif choice.is_boss:
        reason = f"{skill} mastery {level:.2f} with enough cleared to face the boss"
    else:
        reason = f"{skill} is weakest at {level:.2f}"

    return Recommendation(
        challenge_id=choice.challenge_id,
        skill=choice.skill,
        p_mastery=level,
        policy="bkt-adaptive",
        reason=reason,
    )
