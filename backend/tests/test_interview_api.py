from fastapi.testclient import TestClient

from job_evidence_agent.app import create_app


def test_old_start_returns_safe_upgrade_message(tmp_path):
    client = TestClient(create_app(database_path=tmp_path / "test.db", config_path=tmp_path / "model.env"))
    response = client.post("/api/tasks/1/interviews", json={})
    assert response.status_code == 409
    assert "新版" in response.json()["detail"]


def test_legacy_missing_session_is_404(tmp_path):
    client = TestClient(create_app(database_path=tmp_path / "test.db", config_path=tmp_path / "model.env"))
    assert client.get("/api/interviews/999").status_code == 404


def test_legacy_finish_never_fabricates_unsaved_review(tmp_path):
    client = TestClient(create_app(database_path=tmp_path / "test.db", config_path=tmp_path / "model.env"))
    assert client.post("/api/interviews/999/finish").status_code == 409
