from pathlib import Path

from fastapi.testclient import TestClient

from job_evidence_agent.app import create_app


def test_report_routes_return_json_and_markdown_after_review(tmp_path: Path) -> None:
    client = TestClient(create_app(database_path=tmp_path / "workbench.sqlite3"))
    task_id = client.post("/api/tasks", json={"name": "AI 应用开发"}).json()["id"]
    client.post(
        f"/api/tasks/{task_id}/sources/text",
        json={"kind": "resume", "label": "简历", "text": "熟悉 FastAPI。"},
    )
    claim_id = client.post(f"/api/tasks/{task_id}/claims/generate").json()[0]["id"]
    client.patch(f"/api/tasks/{task_id}/claims/{claim_id}", json={"status": "confirmed"})

    report = client.get(f"/api/tasks/{task_id}/report")
    markdown = client.get(f"/api/tasks/{task_id}/report.md")

    assert report.status_code == 200
    assert report.json()["confirmed_claims"]
    assert report.json()["claim_reviews"][0]["verdict"] == "未判定"
    assert report.json()["claim_reviews"][0]["risk"] == "待评估"
    assert "未导入岗位描述" in report.json()["jd_coverage"]
    assert markdown.status_code == 200
    assert "岗位匹配与证据审计报告" in markdown.text


def test_report_route_refuses_pending_review(tmp_path: Path) -> None:
    client = TestClient(create_app(database_path=tmp_path / "workbench.sqlite3"))
    task_id = client.post("/api/tasks", json={"name": "AI 应用开发"}).json()["id"]
    client.post(
        f"/api/tasks/{task_id}/sources/text",
        json={"kind": "resume", "label": "简历", "text": "熟悉 FastAPI。"},
    )
    client.post(f"/api/tasks/{task_id}/claims/generate")

    response = client.get(f"/api/tasks/{task_id}/report")

    assert response.status_code == 409
