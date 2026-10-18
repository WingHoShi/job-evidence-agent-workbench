from pathlib import Path

from fastapi.testclient import TestClient

from job_evidence_agent.app import create_app
from job_evidence_agent.database import SQLiteRepository


def test_task_api_creates_task_and_imports_multiple_relative_files(tmp_path: Path) -> None:
    client = TestClient(create_app(database_path=tmp_path / "workbench.sqlite3"))

    task_response = client.post("/api/tasks", json={"name": "AI 应用开发岗位"})
    task_id = task_response.json()["id"]
    import_response = client.post(
        f"/api/tasks/{task_id}/sources/import",
        data={"kind": "project"},
        files=[
            ("files", ("demo/README.md", "# 项目\nFastAPI", "text/markdown")),
            ("files", ("demo/.env", "MODEL_API_KEY=sk-secret", "text/plain")),
        ],
    )
    detail_response = client.get(f"/api/tasks/{task_id}")

    assert task_response.status_code == 201
    assert import_response.status_code == 200
    assert import_response.json()["imported_count"] == 1
    assert detail_response.json()["sources"] == [
        {
            "id": 1,
            "kind": "project",
            "label": "README.md",
            "relative_path": "demo/README.md",
        }
    ]


def test_task_api_imports_pasted_text_without_exposing_local_path(tmp_path: Path) -> None:
    client = TestClient(create_app(database_path=tmp_path / "workbench.sqlite3"))
    task_id = client.post("/api/tasks", json={"name": "算法工程师"}).json()["id"]

    response = client.post(
        f"/api/tasks/{task_id}/sources/text",
        json={
            "kind": "resume",
            "label": "个人简历",
            "text": "熟悉 Python、FastAPI 与 Docker。",
        },
    )

    assert response.status_code == 201
    assert response.json() == {
        "id": 1,
        "kind": "resume",
        "label": "个人简历",
        "relative_path": "pasted/个人简历.txt",
    }


def test_task_detail_exposes_claim_assessment_and_gate_snapshot(tmp_path: Path) -> None:
    client = TestClient(
        create_app(
            database_path=tmp_path / "workbench.sqlite3",
            config_path=tmp_path / "runtime-config" / "missing.env",
        )
    )
    task_id = client.post("/api/tasks", json={"name": "AI 应用开发"}).json()["id"]
    client.post(
        f"/api/tasks/{task_id}/sources/text",
        json={"kind": "resume", "label": "简历", "text": "使用 FastAPI 提供服务。"},
    )
    client.post(
        f"/api/tasks/{task_id}/sources/text",
        json={"kind": "project", "label": "README", "text": "FastAPI 提供服务健康检查。"},
    )
    claim = client.post(f"/api/tasks/{task_id}/claims/generate").json()[0]
    assessment_response = client.post(f"/api/tasks/{task_id}/claims/{claim['id']}/assessment")

    detail = client.get(f"/api/tasks/{task_id}")

    assert detail.status_code == 200
    assert assessment_response.status_code == 200
    assert detail.json()["claims"] == [claim]
    assert detail.json()["assessments"][str(claim["id"])]["verdict"] == "partial"
    assert detail.json()["gates"][str(claim["id"])]["eligible"] is False
    assert detail.json()["gates"][str(claim["id"])]["requires_review"] is True
    assert "api_key" not in str(detail.json()).lower()


def test_task_detail_exposes_report_ready_snapshot(tmp_path: Path) -> None:
    database_path = tmp_path / "workbench.sqlite3"
    client = TestClient(create_app(database_path=database_path))
    task_id = client.post("/api/tasks", json={"name": "AI 应用开发"}).json()["id"]

    assert client.get(f"/api/tasks/{task_id}").json()["report_ready"] is False

    SQLiteRepository(database_path).mark_report_generated(task_id)

    assert client.get(f"/api/tasks/{task_id}").json()["report_ready"] is True
