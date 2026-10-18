from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, StrictBool

from job_evidence_agent.database import SQLiteRepository
from job_evidence_agent.workflows.audit import AuditWorkflow
from job_evidence_agent.importing import ImportUpload, import_sources

class ReviewRequest(BaseModel):
    decision: str
    claim_id: int | None = None
    risk_acknowledged: StrictBool = False
    edited_text: str | None = None
    supplemental_text: str | None = None

def create_audit_router(repository: SQLiteRepository, workflow: AuditWorkflow) -> APIRouter:
    router = APIRouter(prefix="/api/tasks", tags=["audit"])
    @router.post("/{task_id}/audit/start")
    def start(task_id: int):
        claims = repository.list_claims(task_id)
        workflow.start(task_id, [claim.id for claim in claims if claim.status == "pending_review"])
        return {**workflow.current(task_id), "events": workflow.events(task_id)}
    @router.get("/{task_id}/audit")
    def current(task_id: int):
        return {**workflow.current(task_id), "events": workflow.events(task_id)}
    @router.post("/{task_id}/audit/review")
    def review(task_id: int, request: ReviewRequest):
        state = workflow.current(task_id)
        claim_id = state["claim_id"]
        if not isinstance(claim_id, int): raise HTTPException(409, "没有待审核主张")
        if request.claim_id is not None and request.claim_id != claim_id:
            raise HTTPException(409, "当前审核主张已变化，请刷新后重试")
        if request.decision not in {"accepted", "rejected", "supplement"}:
            raise HTTPException(422, "审核决策不合法")
        gate = repository.get_gate_decision(claim_id)
        assessment = repository.get_assessment(claim_id)
        if request.decision == "accepted" and (assessment is None or gate is None or not gate.eligible or gate.requires_review) and not request.risk_acknowledged:
            raise HTTPException(409, "该主张尚未判定或证据存在风险，请明确确认风险后再接受")
        if request.edited_text and request.edited_text.strip():
            repository.update_claim_text(claim_id, request.edited_text.strip())
        if request.decision == "supplement":
            if not request.supplemental_text or not request.supplemental_text.strip():
                raise HTTPException(422, "请填写补充证据")
            import_sources(repository=repository, task_id=task_id, kind="supplement", uploads=[ImportUpload(f"supplement/{claim_id}.txt", request.supplemental_text.encode())])
            return {**workflow.current(task_id), "events": workflow.events(task_id), "message": "补充证据已接收，请继续审核当前主张"}
        try: workflow.review(task_id, claim_id, request.decision)
        except ValueError as error: raise HTTPException(422, str(error))
        repository.update_claim_status(claim_id, "confirmed" if request.decision == "accepted" else "rejected")
        return {**workflow.current(task_id), "events": workflow.events(task_id)}

    @router.post("/{task_id}/claims/{claim_id}/undo-review")
    def undo_review(task_id: int, claim_id: int):
        try:
            repository.undo_claim_review(task_id, claim_id, workflow.database_path)
        except LookupError as error:
            raise HTTPException(404, str(error)) from error
        except ValueError as error:
            raise HTTPException(409, str(error)) from error
        return {**workflow.current(task_id), "events": workflow.events(task_id)}
    return router
