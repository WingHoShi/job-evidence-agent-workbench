"""文字面试的版本化数据契约；不包含模型密钥或审计写入逻辑。"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StringConstraints

Text = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=1000)]
RequestKey = Annotated[str, StringConstraints(strict=True, min_length=8, max_length=128)]
SessionStatus = Literal["preparing", "awaiting_answer", "generating_question", "ready_to_finish", "generating_review", "completed"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class InterviewOptions(Contract):
    mode: Literal["default", "advanced"] = "default"
    question_count: Annotated[int, Field(strict=True, ge=1, le=10)] = 5
    focus_areas: Annotated[list[Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=100)]], Field(max_length=5)] = Field(default_factory=list)
    duration_minutes: Annotated[int, Field(strict=True, ge=5, le=120)] | None = None


class EvidenceSnapshot(Contract):
    id: StrictInt
    text: str
    kind: Literal["project", "supplement"]
    locator: str = ""
    label: str = ""
    relative_path: str = ""


class ClaimSnapshot(Contract):
    id: StrictInt
    text: str
    verdict: str
    risk: str
    rationale: str = ""
    tags: list[str] = Field(default_factory=list)
    evidence: list[EvidenceSnapshot] = Field(default_factory=list)


class InterviewSnapshot(Contract):
    claims: list[ClaimSnapshot]
    jd: str = ""
    truncated: bool = False


class GeneratedQuestion(Contract):
    question: Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=300)]
    kind: Literal["main", "followup"]
    claim_id: StrictInt
    followup_of_turn_id: StrictInt | None
    evidence_ids: Annotated[list[StrictInt], Field(max_length=3)]


class TurnView(GeneratedQuestion):
    id: int
    ordinal: int
    answer: str | None = None


class OperationView(Contract):
    id: int
    kind: Literal["question", "review"]
    state: Literal["pending", "running", "failed", "succeeded"]
    attempt_count: int
    safe_error: str | None = None
    retry_allowed: bool
    usage: dict[str, int] | None = None


class OperationLease(Contract):
    id: int
    session_id: int
    kind: Literal["question", "review"]
    token: str


class SessionView(InterviewOptions):
    id: int
    task_id: int
    version: Literal[2] = 2
    status: SessionStatus
    turns: list[TurnView]
    review: dict | None = None
    operation: OperationView | None = None
    context_truncated: bool = False


class SessionSummary(Contract):
    id: int
    task_id: int
    version: int
    status: str
    question_count: int


class InterviewConflictError(ValueError):
    """状态已经改变；调用者应重新加载而不是覆盖。"""


class QuestionTarget(Contract):
    claim_id: StrictInt
    kind: Literal["main", "followup"]
    followup_of_turn_id: StrictInt | None = None


class QuestionInput(Contract):
    snapshot: InterviewSnapshot
    turns: list[TurnView]
    target: QuestionTarget
    focus_areas: list[str] = Field(default_factory=list)
    duration_minutes: int | None = None
    ordinal: int = 1
    question_count: int = 5
    truncated: bool = False
    difficulty_hint: Literal["default", "foundation"] = "default"


class ReviewInput(Contract):
    snapshot: InterviewSnapshot
    turns: list[TurnView]
    truncated: bool = False


class ReviewPoint(Contract):
    text: Text
    turn_ids: Annotated[list[StrictInt], Field(max_length=10)]
    claim_ids: Annotated[list[StrictInt], Field(max_length=10)]
    evidence_ids: Annotated[list[StrictInt], Field(max_length=30)]


class TurnReview(Contract):
    turn_id: StrictInt
    strengths: Annotated[list[Text], Field(max_length=10)]
    missing_details: Annotated[list[Text], Field(max_length=10)]
    technical_points: Annotated[list[Text], Field(max_length=10)]
    suggestions: Annotated[list[Text], Field(max_length=10)]
    evidence_ids: Annotated[list[StrictInt], Field(max_length=30)]


class GeneratedReview(Contract):
    overall_summary: Text | None = None
    answer_consistency: Annotated[list[ReviewPoint], Field(max_length=10)] = Field(default_factory=list)
    turn_reviews: Annotated[list[TurnReview], Field(max_length=10)]
    consistency: Annotated[list[ReviewPoint], Field(max_length=10)]
    omissions: Annotated[list[ReviewPoint], Field(max_length=10)]
    technical_gaps: Annotated[list[ReviewPoint], Field(max_length=10)]
    next_steps: Annotated[list[ReviewPoint], Field(max_length=10)]


# 仅约束新模型输出；持久化的历史复盘仍通过 SessionView.review 原样读取。
ReviewText = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=60)]


class CompactReviewPoint(ReviewPoint):
    text: Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=80)]
    evidence_ids: Annotated[list[StrictInt], Field(max_length=3)]


class CompactTurnReview(TurnReview):
    strengths: Annotated[list[ReviewText], Field(max_length=1)]
    missing_details: Annotated[list[ReviewText], Field(max_length=1)]
    technical_points: Annotated[list[ReviewText], Field(max_length=1)]
    suggestions: Annotated[list[ReviewText], Field(max_length=1)]
    evidence_ids: Annotated[list[StrictInt], Field(max_length=3)]


class CompactGeneratedReview(GeneratedReview):
    overall_summary: Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=160)] | None = None
    answer_consistency: Annotated[list[CompactReviewPoint], Field(max_length=2)] = Field(default_factory=list)
    turn_reviews: Annotated[list[CompactTurnReview], Field(max_length=10)]
    consistency: Annotated[list[CompactReviewPoint], Field(max_length=2)]
    omissions: Annotated[list[CompactReviewPoint], Field(max_length=2)]
    technical_gaps: Annotated[list[CompactReviewPoint], Field(max_length=2)]
    next_steps: Annotated[list[CompactReviewPoint], Field(max_length=3)]


class ModelResult(Contract):
    value: GeneratedQuestion | GeneratedReview
    usage: dict[str, int] | None = None
