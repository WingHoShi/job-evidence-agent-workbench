from pathlib import Path

from job_evidence_agent.workflows.audit import AuditWorkflow


def test_audit_workflow_pauses_each_claim_and_resumes_from_same_checkpoint(tmp_path: Path) -> None:
    database_path = tmp_path / "workflow.db"
    workflow = AuditWorkflow(database_path)
    workflow.start(task_id=1, claim_ids=[10, 11])

    first = workflow.current(task_id=1)
    workflow.review(task_id=1, claim_id=10, decision="accepted")
    restarted = AuditWorkflow(database_path)
    second = restarted.current(task_id=1)

    assert first == {"status": "awaiting_review", "claim_id": 10}
    assert second == {"status": "awaiting_review", "claim_id": 11}
