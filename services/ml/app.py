"""HTTP layer for the BKT service.

Deliberately stateless. The service holds no database and no session: the caller
sends the learner's observation history and the challenge catalogue, and gets back
mastery and a recommendation.

That is not just a deployment convenience. The Node API already owns the event log,
so a database here would mean two components reading the same log with two
implementations of "which attempts count", and they would drift silently -- both
would keep returning plausible mastery numbers. Statelessness keeps this service
authoritative about the *model* and nothing else.
"""

from __future__ import annotations

from typing import Literal

from fastapi import FastAPI
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from cybershield_bkt.model import LITERATURE_PRIORS, BKTParams, update
from cybershield_bkt.policy import Candidate, capstone_unlocked, recommend, unlocked_nodes

app = FastAPI(
    title="CyberShield BKT service",
    version="0.1.0",
    description="Bayesian Knowledge Tracing and adaptive challenge sequencing.",
)


class Observation(BaseModel):
    """One attempt that counts as evidence about latent skill.

    The caller is responsible for filtering: only unaided first attempts belong
    here. A learner who was shown the answer has not demonstrated anything, and
    including hint-assisted successes would inflate every mastery estimate.
    """

    skill: str
    correct: bool


class CandidateIn(BaseModel):
    challenge_id: str
    skill: str
    mastery_required: float = 0.0
    is_drill: bool = False
    is_boss: bool = False
    requires: str | None = None


class RecommendRequest(BaseModel):
    observations: list[Observation] = Field(default_factory=list)
    candidates: list[CandidateIn] = Field(default_factory=list)
    cleared: list[str] = Field(default_factory=list)
    #: Nodes already opened. Unlocking latches, so this must be sent or the tree
    #: will appear to close again when mastery dips.
    unlocked: list[str] = Field(default_factory=list)


class MasteryResponse(BaseModel):
    mastery: dict[str, float]
    unlocked: list[str]
    capstone_unlocked: bool


class RecommendResponse(MasteryResponse):
    challenge_id: str
    skill: str
    p_mastery: float
    policy: Literal["bkt-adaptive", "linear-fallback"]
    reason: str


def _mastery_from(observations: list[Observation], skills: set[str],
                  params: BKTParams = LITERATURE_PRIORS) -> dict[str, float]:
    """Replay the observation history to the current belief.

    Recomputed from the log every time rather than stored and incremented. The log
    is the source of truth, so a mastery value that drifted from it would be a
    silent inconsistency -- and replaying a few dozen scalar updates costs nothing.
    """
    mastery = {s: params.p_init for s in skills}
    for obs in observations:
        if obs.skill not in mastery:
            mastery[obs.skill] = params.p_init
        _, mastery[obs.skill] = update(mastery[obs.skill], obs.correct, params)
    return mastery


def _skills_in(req: RecommendRequest) -> set[str]:
    return {c.skill for c in req.candidates} | {o.skill for o in req.observations}


@app.get("/", include_in_schema=False)
def root() -> dict:
    """Something useful for anyone who opens the port in a browser.

    A bare 404 here reads as "the service is broken" when it is in fact running
    perfectly well and simply has no root route.
    """
    return {
        "service": "CyberShield BKT service",
        "status": "running",
        "endpoints": {
            "GET /health": "liveness",
            "POST /mastery": "current mastery per skill, and what it unlocks",
            "POST /recommend": "the next challenge, or 204 when nothing is open",
        },
        "interactive_docs": "/docs",
    }


@app.get("/health")
def health() -> dict:
    """Liveness. Depends on nothing, so it answers even when a request would not."""
    return {"ok": True, "service": "bkt"}


@app.post("/mastery", response_model=MasteryResponse)
def mastery(req: RecommendRequest) -> MasteryResponse:
    """Current mastery per skill, and what that opens."""
    skills = _skills_in(req)
    levels = _mastery_from(req.observations, skills)
    candidates = [Candidate(**c.model_dump()) for c in req.candidates]

    return MasteryResponse(
        mastery=levels,
        unlocked=sorted(unlocked_nodes(candidates, levels, set(req.cleared), set(req.unlocked))),
        capstone_unlocked=capstone_unlocked(levels, sorted(skills)) if skills else False,
    )


@app.post("/recommend", response_model=RecommendResponse, responses={204: {"description": "Nothing left to serve"}})
def recommend_next(req: RecommendRequest) -> Response:
    """Choose the next challenge.

    Returns 204 when the learner has exhausted the open content. That is a real
    answer rather than an error, and the caller distinguishes it from a failure --
    an empty body must never be mistaken for the service being down.
    """
    skills = _skills_in(req)
    levels = _mastery_from(req.observations, skills)
    candidates = [Candidate(**c.model_dump()) for c in req.candidates]
    cleared = set(req.cleared)
    open_now = unlocked_nodes(candidates, levels, cleared, set(req.unlocked))

    rec = recommend(candidates, levels, cleared, open_now)
    if rec is None:
        return Response(status_code=204)

    return JSONResponse(
        RecommendResponse(
            challenge_id=rec.challenge_id,
            skill=rec.skill,
            p_mastery=rec.p_mastery,
            policy=rec.policy,
            reason=rec.reason,
            mastery=levels,
            unlocked=sorted(open_now),
            capstone_unlocked=capstone_unlocked(levels, sorted(skills)) if skills else False,
        ).model_dump()
    )
