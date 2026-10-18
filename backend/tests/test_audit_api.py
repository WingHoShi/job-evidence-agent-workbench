from pathlib import Path
import sqlite3

import pytest

from fastapi.testclient import TestClient

from job_evidence_agent.app import create_app
from job_evidence_agent.database import SQLiteRepository
from job_evidence_agent.gates import decide_gate
from job_evidence_agent.models import EvidenceAssessment


def _task_with_two_claims(client: TestClient) -> tuple[int, list[int]]:
    task_id = client.post("/api/tasks", json={"name": "AI 应用开发"}).json()["id"]
    client.post(
        f"/api/tasks/{task_id}/sources/text",
        json={"kind": "resume", "label": "简历一", "text": "熟悉 FastAPI。"},
    )
    client.post(
        f"/api/tasks/{task_id}/sources/text",
        json={"kind": "resume", "label": "简历二", "text": "掌握 Docker Compose。"},
    )
    claims = client.post(f"/api/tasks/{task_id}/claims/generate").json()
    return task_id, [item["id"] for item in claims]


def test_task_detail_exposes_recoverable_audit_state(tmp_path: Path) -> None:
    client = TestClient(create_app(database_path=tmp_path / "workbench.sqlite3"))
    task_id, claim_ids = _task_with_two_claims(client)
    client.post(f"/api/tasks/{task_id}/audit/start")
    client.post(f"/api/tasks/{task_id}/audit/review", json={"decision": "accepted", "risk_acknowledged": True})

    detail = client.get(f"/api/tasks/{task_id}")

    assert detail.status_code == 200
    assert detail.json()["audit"]["status"] == "awaiting_review"
    assert detail.json()["audit"]["claim_id"] == claim_ids[1]
    assert detail.json()["audit"]["recoverable"] is True
    assert detail.json()["audit"]["events"]


def test_supplement_keeps_the_same_claim_in_review(tmp_path: Path) -> None:
    client = TestClient(create_app(database_path=tmp_path / "workbench.sqlite3"))
    task_id, claim_ids = _task_with_two_claims(client)
    client.post(f"/api/tasks/{task_id}/audit/start")

    response = client.post(
        f"/api/tasks/{task_id}/audit/review",
        json={"decision": "supplement", "supplemental_text": "项目 README：FastAPI 提供健康检查接口。"},
    )

    assert response.status_code == 200
    assert response.json()["claim_id"] == claim_ids[0]
    assert response.json()["status"] == "awaiting_review"
    assert "补充证据已接收" in response.json()["message"]


def test_risky_accept_requires_explicit_acknowledgement_before_any_changes(tmp_path: Path) -> None:
    client = TestClient(create_app(database_path=tmp_path / "workbench.sqlite3"))
    task_id, ids = _task_with_two_claims(client)
    client.post(f"/api/tasks/{task_id}/audit/start")
    response = client.post(f"/api/tasks/{task_id}/audit/review", json={"decision": "accepted", "claim_id": ids[0]})
    assert response.status_code == 409
    detail = client.get(f"/api/tasks/{task_id}").json()
    assert detail["claims"][0]["status"] == "pending_review"
    assert detail["audit"]["claim_id"] == ids[0]
    response = client.post(f"/api/tasks/{task_id}/audit/review", json={"decision": "accepted", "claim_id": ids[0], "risk_acknowledged": True})
    assert response.status_code == 200
    # 旧页面的重复提交不得误接受下一条主张。
    stale = client.post(f"/api/tasks/{task_id}/audit/review", json={"decision": "accepted", "claim_id": ids[0], "risk_acknowledged": True})
    assert stale.status_code == 409
    assert client.get(f"/api/tasks/{task_id}").json()["claims"][1]["status"] == "pending_review"


def test_undo_preserves_assessment_history_and_remaining_review_order_after_restart(tmp_path: Path) -> None:
    database_path = tmp_path / "workbench.sqlite3"
    client = TestClient(create_app(database_path=database_path))
    task_id, ids = _task_with_two_claims(client)
    client.post(f"/api/tasks/{task_id}/audit/start")
    client.post(f"/api/tasks/{task_id}/claims/{ids[0]}/assessment")
    client.post(f"/api/tasks/{task_id}/audit/review", json={"decision": "accepted", "risk_acknowledged": True})
    before = client.get(f"/api/tasks/{task_id}").json()
    response = client.post(f"/api/tasks/{task_id}/claims/{ids[0]}/undo-review")
    assert response.status_code == 200
    restarted = TestClient(create_app(database_path=database_path))
    after = restarted.get(f"/api/tasks/{task_id}").json()
    assert after["claims"][0]["status"] == "pending_review"
    assert after["audit"]["claim_id"] == ids[0]
    assert after["assessments"] == before["assessments"]
    assert after["gates"] == before["gates"]
    assert after["audit"]["events"][:-1] == before["audit"]["events"]
    assert "撤销" in after["audit"]["events"][-1]
    assert restarted.post(f"/api/tasks/{task_id}/claims/{ids[0]}/undo-review").status_code == 409
    restarted.post(f"/api/tasks/{task_id}/audit/review", json={"decision": "rejected", "claim_id": ids[0]})
    assert restarted.get(f"/api/tasks/{task_id}").json()["audit"]["claim_id"] == ids[1]


def test_undo_completed_review_blocks_generated_reports_and_cross_task_claims(tmp_path: Path) -> None:
    client = TestClient(create_app(database_path=tmp_path / "workbench.sqlite3"))
    task_id, ids = _task_with_two_claims(client)
    client.post(f"/api/tasks/{task_id}/audit/start")
    for _ in ids:
        client.post(f"/api/tasks/{task_id}/audit/review", json={"decision": "rejected"})
    assert client.post(f"/api/tasks/{task_id}/claims/{ids[1]}/undo-review").status_code == 200
    assert client.get(f"/api/tasks/{task_id}").json()["audit"]["claim_id"] == ids[1]
    client.post(f"/api/tasks/{task_id}/audit/review", json={"decision": "rejected"})
    assert client.get(f"/api/tasks/{task_id}/report").status_code == 200
    before = client.get(f"/api/tasks/{task_id}").json()
    assert client.post(f"/api/tasks/{task_id}/claims/{ids[0]}/undo-review").status_code == 409
    assert client.get(f"/api/tasks/{task_id}").json() == before
    other_id = client.post("/api/tasks", json={"name": "其他任务"}).json()["id"]
    assert client.post(f"/api/tasks/{other_id}/claims/{ids[0]}/undo-review").status_code == 404


@pytest.mark.parametrize("verdict, expected_status", [("none", 409), ("partial", 409), ("conflict", 409), ("strong", 200)])
def test_acceptance_guard_respects_persisted_gate(tmp_path: Path, verdict: str, expected_status: int) -> None:
    path = tmp_path / "workbench.sqlite3"
    client = TestClient(create_app(database_path=path))
    task_id, ids = _task_with_two_claims(client)
    repository = SQLiteRepository(path)
    repository.save_assessment(EvidenceAssessment(ids[0], (), verdict, "受控测试判定"))
    repository.save_gate_decision(ids[0], decide_gate(verdict))
    client.post(f"/api/tasks/{task_id}/audit/start")
    response = client.post(f"/api/tasks/{task_id}/audit/review", json={"decision": "accepted", "claim_id": ids[0]})
    assert response.status_code == expected_status
    if expected_status == 409:
        assert client.get(f"/api/tasks/{task_id}").json()["claims"][0]["status"] == "pending_review"


def test_undo_transaction_rolls_back_business_state_if_event_write_fails(tmp_path: Path) -> None:
    path = tmp_path / "workbench.sqlite3"
    client = TestClient(create_app(database_path=path))
    task_id, ids = _task_with_two_claims(client)
    client.post(f"/api/tasks/{task_id}/audit/start")
    client.post(f"/api/tasks/{task_id}/audit/review", json={"decision": "rejected"})
    before = client.get(f"/api/tasks/{task_id}").json()
    with sqlite3.connect(tmp_path / "workflow.db") as connection:
        connection.execute("CREATE TRIGGER fail_event BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'test failure'); END")
    with pytest.raises(sqlite3.IntegrityError):
        SQLiteRepository(path).undo_claim_review(task_id, ids[0], tmp_path / "workflow.db")
    assert client.get(f"/api/tasks/{task_id}").json() == before
