"""业务实体。"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Task:
    id: int
    name: str
    status: str


@dataclass(frozen=True)
class Source:
    id: int
    task_id: int
    kind: str
    label: str
    relative_path: str


@dataclass(frozen=True)
class EvidenceChunk:
    id: int
    source_id: int
    text: str
    locator: str
    language: str


@dataclass(frozen=True)
class Claim:
    id: int
    task_id: int
    text: str
    resume_locator: str
    capability_tags: tuple[str, ...]
    status: str


@dataclass(frozen=True)
class EvidenceAssessment:
    claim_id: int
    links: tuple[int, ...]
    verdict: str
    rationale: str


@dataclass(frozen=True)
class GateDecision:
    eligible: bool
    requires_review: bool
    reason: str


@dataclass(frozen=True)
class InterviewSession:
    id: int
    task_id: int
    mode: str
    question_count: int
    focus_areas: tuple[str, ...]
    status: str
    duration_minutes: int | None


@dataclass(frozen=True)
class InterviewTurn:
    id: int
    session_id: int
    question: str
    answer: str | None
    evidence_ids: tuple[int, ...]


@dataclass(frozen=True)
class InterviewReview:
    consistency: tuple[str, ...]
    omissions: tuple[str, ...]
    technical_gaps: tuple[str, ...]
    next_steps: tuple[str, ...]
