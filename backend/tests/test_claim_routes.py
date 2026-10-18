from pathlib import Path

from fastapi.testclient import TestClient

from job_evidence_agent.app import create_app


def test_claim_api_generates_resume_claims_and_updates_review_status(tmp_path: Path) -> None:
    client = TestClient(create_app(database_path=tmp_path / "workbench.sqlite3"))
    task_id = client.post("/api/tasks", json={"name": "AI 应用"}).json()["id"]
    client.post(f"/api/tasks/{task_id}/sources/text", json={"kind": "resume", "label": "简历", "text": "熟悉 FastAPI 与 Docker。"})
    client.post(f"/api/tasks/{task_id}/sources/text", json={"kind": "project", "label": "项目", "text": "FastAPI 服务已实现。"})

    generated = client.post(f"/api/tasks/{task_id}/claims/generate")
    claim_id = generated.json()[0]["id"]
    updated = client.patch(f"/api/tasks/{task_id}/claims/{claim_id}", json={"status": "confirmed"})

    assert generated.status_code == 200
    assert generated.json()[0]["text"] == "熟悉 FastAPI 与 Docker。"
    assert updated.json()["status"] == "confirmed"


def test_uploaded_example_resume_generates_three_claims_without_altering_sources(tmp_path: Path) -> None:
    client = TestClient(create_app(database_path=tmp_path / "workbench.sqlite3"))
    task_id = client.post("/api/tasks", json={"name": "逐条提取验收"}).json()["id"]
    resume_path = Path(__file__).resolve().parents[2] / "examples" / "resume.md"
    imported = client.post(
        f"/api/tasks/{task_id}/sources/import", data={"kind": "resume"},
        files=[("files", ("resume.md", resume_path.read_bytes(), "text/markdown"))],
    )
    assert imported.json()["imported_count"] == 1

    generated = client.post(f"/api/tasks/{task_id}/claims/generate")
    restored = client.get(f"/api/tasks/{task_id}").json()

    assert generated.status_code == 200
    assert [claim["text"] for claim in generated.json()] == [
        "使用 FastAPI 提供健康检查接口，并通过 Docker Compose 编排本地服务。",
        "了解 Kubernetes 基础概念。",
        "将服务响应时间从 5 秒优化至 1 秒。",
    ]
    assert len(restored["claims"]) == 3
    assert len(restored["sources"]) == 1
