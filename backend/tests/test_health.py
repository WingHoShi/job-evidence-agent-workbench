from fastapi.testclient import TestClient

from job_evidence_agent.app import create_app


def test_health_endpoint_returns_ok_status() -> None:
    client = TestClient(create_app())

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_app_serves_frontend_build_when_available(tmp_path) -> None:
    (tmp_path / "index.html").write_text("<h1>前端已加载</h1>", encoding="utf-8")
    client = TestClient(create_app(frontend_dist_dir=tmp_path))

    response = client.get("/")

    assert response.status_code == 200
    assert "前端已加载" in response.text


def test_app_reads_frontend_build_directory_from_environment(
    tmp_path, monkeypatch
) -> None:
    (tmp_path / "index.html").write_text("<h1>环境变量前端</h1>", encoding="utf-8")
    monkeypatch.setenv("JOB_EVIDENCE_FRONTEND_DIST_DIR", str(tmp_path))
    client = TestClient(create_app())

    response = client.get("/")

    assert response.status_code == 200
    assert "环境变量前端" in response.text
