from pathlib import Path

from fastapi.testclient import TestClient

from job_evidence_agent.app import create_app
from job_evidence_agent.model_client import ModelConnectionError
from job_evidence_agent.settings import ModelConfig, ModelConfigStore


class FailingModelClient:
    def test_connection(self, config: object) -> None:
        raise ModelConnectionError("无法连接到模型服务")


class SuccessfulModelClient:
    def __init__(self) -> None:
        self.received_config: object | None = None

    def test_connection(self, config: object) -> None:
        self.received_config = config


def test_setup_status_reports_unconfigured_without_sensitive_fields(tmp_path: Path) -> None:
    client = TestClient(create_app(config_path=tmp_path / "model.env"))

    response = client.get("/api/setup/status")

    assert response.status_code == 200
    assert response.json() == {
        "configured": False,
        "base_url": None,
        "model_name": None,
    }
    assert "key" not in response.text.lower()


def test_failed_connection_does_not_create_local_config(tmp_path: Path) -> None:
    config_path = tmp_path / "runtime-config" / "model.env"
    client = TestClient(
        create_app(config_path=config_path, model_client=FailingModelClient())
    )

    response = client.post(
        "/api/setup",
        json={
            "base_url": "https://api.example.com/v1",
            "model_name": "test-model",
            "api_key": "sk-secret-value",
        },
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "无法连接到模型服务"}
    assert not config_path.exists()
    assert "sk-secret-value" not in response.text


def test_successful_setup_saves_config_and_only_returns_safe_status(tmp_path: Path) -> None:
    config_path = tmp_path / "runtime-config" / "model.env"
    model_client = SuccessfulModelClient()
    client = TestClient(create_app(config_path=config_path, model_client=model_client))

    response = client.post(
        "/api/setup",
        json={
            "base_url": "https://api.example.com/v1",
            "model_name": "test-model",
            "api_key": "sk-secret-value",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "configured": True,
        "base_url": "https://api.example.com/v1",
        "model_name": "test-model",
    }
    assert model_client.received_config is not None
    assert config_path.is_file()
    assert "sk-secret-value" in config_path.read_text(encoding="utf-8")
    assert "sk-secret-value" not in response.text


def test_rejected_replacement_preserves_existing_config_bytes(tmp_path: Path) -> None:
    config_path = tmp_path / "model.env"
    store = ModelConfigStore(config_path)
    store.save(ModelConfig.create(base_url="https://example.com/v1", model_name="old-model", api_key="fictional-old-key"))
    before = config_path.read_bytes()
    client = TestClient(create_app(config_path=config_path, model_client=FailingModelClient()))
    response = client.post("/api/setup", json={"base_url": "https://new.example.com/v1", "model_name": "new-model", "api_key": "fictional-new-key"})
    assert response.status_code == 400
    assert config_path.read_bytes() == before
    status = client.get("/api/setup/status")
    assert status.json() == {"configured": True, "base_url": "https://example.com/v1", "model_name": "old-model"}
    assert "fictional-old-key" not in status.text


def test_testing_replacement_does_not_save_existing_config(tmp_path: Path) -> None:
    config_path = tmp_path / "model.env"
    store = ModelConfigStore(config_path)
    store.save(ModelConfig.create(base_url="https://example.com/v1", model_name="old-model", api_key="fictional-old-key"))
    before = config_path.read_bytes()
    model_client = SuccessfulModelClient()
    client = TestClient(create_app(config_path=config_path, model_client=model_client))
    response = client.post("/api/setup/test", json={"base_url": "https://new.example.com/v1", "model_name": "new-model", "api_key": "fictional-new-key"})
    assert response.status_code == 200
    assert response.json()["model_name"] == "new-model"
    assert model_client.received_config.model_name == "new-model"
    assert config_path.read_bytes() == before
    assert client.get("/api/setup/status").json()["model_name"] == "old-model"

