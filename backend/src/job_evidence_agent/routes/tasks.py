"""任务创建与材料导入接口。"""

from __future__ import annotations

from pathlib import Path
from dataclasses import replace

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from job_evidence_agent.database import SQLiteRepository
from job_evidence_agent.claims import extract_resume_claims
from job_evidence_agent.retrieval import retrieve_evidence
from job_evidence_agent.importing import ImportUpload, import_sources, normalize_relative_path
from job_evidence_agent.gates import decide_gate
from job_evidence_agent.model_client import ModelConnectionError, OpenAICompatibleClient
from job_evidence_agent.models import EvidenceAssessment, Source, Task
from job_evidence_agent.settings import ModelConfigStore
from job_evidence_agent.workflows.audit import AuditWorkflow


class CreateTaskRequest(BaseModel):
    name: str


class PasteTextRequest(BaseModel):
    kind: str
    label: str
    text: str


class UpdateClaimRequest(BaseModel):
    status: str


def create_tasks_router(
    repository: SQLiteRepository,
    audit_workflow: AuditWorkflow | None = None,
    config_store: ModelConfigStore | None = None,
    model_client: object | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/api/tasks", tags=["tasks"])
    assessment_client = model_client or OpenAICompatibleClient()

    @router.get("")
    def list_tasks() -> list[dict[str, object]]:
        return [task_to_response(task) for task in repository.list_tasks()]

    @router.post("", status_code=201)
    def create_task(request: CreateTaskRequest) -> dict[str, object]:
        try:
            task = repository.create_task(request.name)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        return task_to_response(task)

    @router.get("/{task_id}")
    def get_task(task_id: int) -> dict[str, object]:
        task = require_task(repository, task_id)
        workflow = audit_workflow or AuditWorkflow(repository.database_path.with_name("workflow.db"))
        audit = workflow.current(task.id)
        claims = repository.list_claims(task.id)
        assessments = {
            str(claim.id): assessment_to_response(assessment)
            for claim in claims
            if (assessment := repository.get_assessment(claim.id)) is not None
        }
        gates = {
            str(claim.id): gate_to_response(gate)
            for claim in claims
            if (gate := repository.get_gate_decision(claim.id)) is not None
        }
        return {
            **task_to_response(task),
            "sources": [source_to_response(source) for source in repository.list_sources(task.id)],
            "claims": [claim_to_response(claim) for claim in claims],
            "assessments": assessments,
            "gates": gates,
            "report_ready": repository.has_generated_report(task.id),
            "audit": {**audit, "events": workflow.events(task.id), "recoverable": audit["status"] == "awaiting_review"},
        }

    @router.post("/{task_id}/sources/import")
    async def import_files(
        task_id: int,
        kind: str = Form(...),
        files: list[UploadFile] = File(...),
    ) -> dict[str, object]:
        require_task(repository, task_id)
        uploads = [
            ImportUpload(file.filename or "unnamed.txt", await file.read()) for file in files
        ]
        summary = import_sources(
            repository=repository, task_id=task_id, kind=kind, uploads=uploads
        )
        return {
            "imported_count": summary.imported_count,
            "skipped_paths": summary.skipped_paths,
            "errors": summary.errors,
        }

    @router.post("/{task_id}/sources/text", status_code=201)
    def import_text(task_id: int, request: PasteTextRequest) -> dict[str, object]:
        require_task(repository, task_id)
        label = request.label.strip()
        if not label or not request.text.strip():
            raise HTTPException(status_code=422, detail="请填写材料名称和内容")
        safe_label = label.replace("/", "_").replace("\\", "_")
        relative_path = f"pasted/{safe_label}.txt"
        if normalize_relative_path(relative_path) is None:
            raise HTTPException(status_code=422, detail="材料名称不合法")
        summary = import_sources(
            repository=repository,
            task_id=task_id,
            kind=request.kind,
            uploads=[ImportUpload(relative_path, request.text.encode("utf-8"))],
        )
        if summary.imported_count != 1:
            raise HTTPException(status_code=422, detail="材料内容无法导入")
        source = repository.list_sources(task_id)[-1]
        repository.update_source_label(source.id, label)
        source = Source(
            id=source.id,
            task_id=source.task_id,
            kind=source.kind,
            label=label,
            relative_path=source.relative_path,
        )
        return source_to_response(source)

    @router.post("/{task_id}/claims/generate")
    def generate_claims(task_id: int) -> list[dict[str, object]]:
        require_task(repository, task_id)
        sources = repository.list_sources(task_id)
        resume_chunks = [chunk for source in sources if source.kind == "resume" for chunk in repository.list_chunks(source.id)]
        project_chunks = [chunk for source in sources if source.kind != "resume" for chunk in repository.list_chunks(source.id)]
        claims = [repository.create_claim(replace(claim, task_id=task_id)) for claim in extract_resume_claims(resume_chunks, project_chunks)]
        return [claim_to_response(claim) for claim in claims]

    @router.patch("/{task_id}/claims/{claim_id}")
    def update_claim(task_id: int, claim_id: int, request: UpdateClaimRequest) -> dict[str, object]:
        require_task(repository, task_id)
        if request.status not in {"confirmed", "rejected", "pending_review"}:
            raise HTTPException(status_code=422, detail="不支持的审核状态")
        repository.update_claim_status(claim_id, request.status)
        claim = next((item for item in repository.list_claims(task_id) if item.id == claim_id), None)
        if claim is None:
            raise HTTPException(status_code=404, detail="主张不存在")
        return claim_to_response(claim)

    @router.get("/{task_id}/claims/{claim_id}/evidence")
    def claim_evidence(task_id: int, claim_id: int) -> list[dict[str, object]]:
        require_task(repository, task_id)
        claim = next((item for item in repository.list_claims(task_id) if item.id == claim_id), None)
        if claim is None:
            raise HTTPException(status_code=404, detail="主张不存在")
        return [{"id": item.id, "text": item.text, "locator": item.locator} for item in retrieve_evidence(repository, task_id, claim.text)]

    @router.post("/{task_id}/claims/{claim_id}/assessment")
    def assess_claim(task_id: int, claim_id: int) -> dict[str, object]:
        require_task(repository, task_id)
        claim = next((item for item in repository.list_claims(task_id) if item.id == claim_id), None)
        if claim is None:
            raise HTTPException(status_code=404, detail="主张不存在")

        candidates = retrieve_evidence(repository, task_id, claim.text)
        config = config_store.get() if config_store else None
        if candidates and config is not None and hasattr(assessment_client, "assess_evidence"):
            try:
                assessment = assessment_client.assess_evidence(config, claim, candidates)
            except ModelConnectionError as error:
                raise HTTPException(status_code=503, detail=str(error)) from error
            invalid_links = set(assessment.links) - {item.id for item in candidates}
            if invalid_links:
                raise HTTPException(status_code=502, detail="模型返回了候选范围之外的证据引用")
        else:
            assessment = _fallback_assessment(claim.id, candidates)

        # 模型标签不能绕过引用与来源门禁；补充自述不能单独构成充分支持。
        project_source_ids = {source.id for source in repository.list_sources(task_id) if source.kind == "project"}
        linked_project = any(item.id in assessment.links and item.source_id in project_source_ids for item in candidates)
        if assessment.verdict in {"strong", "partial"} and not assessment.links:
            assessment = replace(assessment, verdict="none", rationale="没有引用可核验的证据，不能认定主张获得支持。")
        elif assessment.verdict == "strong" and not linked_project:
            assessment = replace(assessment, verdict="partial", rationale="当前引用仅来自补充说明，缺少项目材料佐证，不能认定为充分支持。")

        gate = decide_gate(assessment.verdict)
        repository.save_assessment(assessment)
        repository.save_gate_decision(claim.id, gate)
        return {
            "evidence": [evidence_to_response(item) for item in candidates],
            "assessment": assessment_to_response(assessment),
            "gate": gate_to_response(gate),
        }

    return router


def require_task(repository: SQLiteRepository, task_id: int) -> Task:
    task = repository.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return task


def task_to_response(task: Task) -> dict[str, object]:
    return {"id": task.id, "name": task.name, "status": task.status}


def source_to_response(source: Source) -> dict[str, object]:
    return {
        "id": source.id,
        "kind": source.kind,
        "label": source.label,
        "relative_path": source.relative_path,
    }


def claim_to_response(claim) -> dict[str, object]:
    return {"id": claim.id, "text": claim.text, "resume_locator": claim.resume_locator, "capability_tags": claim.capability_tags, "status": claim.status}


def evidence_to_response(item) -> dict[str, object]:
    return {"id": item.id, "text": item.text, "locator": item.locator}


def assessment_to_response(assessment: EvidenceAssessment) -> dict[str, object]:
    return {
        "claim_id": assessment.claim_id,
        "links": list(assessment.links),
        "verdict": assessment.verdict,
        "rationale": assessment.rationale,
    }


def gate_to_response(gate) -> dict[str, object]:
    return {
        "eligible": gate.eligible,
        "requires_review": gate.requires_review,
        "reason": gate.reason,
    }


def _fallback_assessment(claim_id: int, candidates) -> EvidenceAssessment:
    if not candidates:
        return EvidenceAssessment(claim_id, (), "none", "没有召回与该主张相关的可核验材料。")
    return EvidenceAssessment(
        claim_id,
        tuple(item.id for item in candidates),
        "partial",
        "已召回候选材料；未运行模型判定时，不将代码或文档存在视为个人实际职责的充分证据。",
    )
