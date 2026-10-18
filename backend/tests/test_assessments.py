from pathlib import Path
from unittest.mock import patch
import json

import httpx

from fastapi.testclient import TestClient

from job_evidence_agent.database import SQLiteRepository
from job_evidence_agent.models import Claim, EvidenceAssessment
from job_evidence_agent.gates import decide_gate
from job_evidence_agent.app import create_app
from job_evidence_agent.settings import ModelConfig, ModelConfigStore


def test_resume_and_jd_alone_produce_no_evidence_without_calling_model(tmp_path: Path) -> None:
    config_path = tmp_path / "model.env"
    ModelConfigStore(config_path).save(ModelConfig.create(base_url="https://example.invalid/v1", model_name="test", api_key="fake"))
    client = TestClient(create_app(database_path=tmp_path / "workbench.sqlite3", config_path=config_path))
    task_id = client.post("/api/tasks", json={"name": "自述不是证明"}).json()["id"]
    for kind in ("resume", "job_description"):
        client.post(f"/api/tasks/{task_id}/sources/text", json={"kind": kind, "label": kind, "text": "了解 Kubernetes 基础概念。"})
    claim_id = client.post(f"/api/tasks/{task_id}/claims/generate").json()[0]["id"]
    assert client.get(f"/api/tasks/{task_id}/claims/{claim_id}/evidence").json() == []
    with patch("job_evidence_agent.model_client.httpx.post", side_effect=AssertionError("No model needed without evidence")):
        response = client.post(f"/api/tasks/{task_id}/claims/{claim_id}/assessment")
    assert response.status_code == 200
    assert response.json()["assessment"]["verdict"] == "none"
    assert response.json()["assessment"]["links"] == []
    assert response.json()["gate"]["eligible"] is False


def test_strong_verdict_requires_a_linked_project_source(tmp_path: Path) -> None:
    config_path = tmp_path / "model.env"
    ModelConfigStore(config_path).save(ModelConfig.create(base_url="https://example.invalid/v1", model_name="test", api_key="fake"))
    client = TestClient(create_app(database_path=tmp_path / "workbench.sqlite3", config_path=config_path))
    task_id = client.post("/api/tasks", json={"name": "强结论来源门禁"}).json()["id"]
    for kind, text in [("resume", "熟悉 FastAPI。"), ("supplement", "我熟悉 FastAPI。"), ("project", "FastAPI app.get('/health') 接口实现")]:
        client.post(f"/api/tasks/{task_id}/sources/text", json={"kind": kind, "label": kind, "text": text})
    claim_id = client.post(f"/api/tasks/{task_id}/claims/generate").json()[0]["id"]
    repository = SQLiteRepository(tmp_path / "workbench.sqlite3")
    sources = {source.kind: source for source in repository.list_sources(task_id)}
    supplement_id = repository.list_chunks(sources["supplement"].id)[0].id
    project_id = repository.list_chunks(sources["project"].id)[0].id
    endpoint = f"/api/tasks/{task_id}/claims/{claim_id}/assessment"
    resume_id = repository.list_chunks(sources["resume"].id)[0].id
    content = json.dumps({"verdict": "strong", "links": [resume_id], "rationale": "自述一致"})
    with patch("job_evidence_agent.model_client.httpx.post", return_value=httpx.Response(200, json={"choices": [{"message": {"content": content}}]})):
        invalid = client.post(endpoint)
    assert invalid.status_code == 502
    assert client.get(f"/api/tasks/{task_id}").json()["assessments"] == {}
    for links, verdict, eligible in [([], "none", False), ([supplement_id], "partial", False), ([project_id], "strong", True)]:
        content = json.dumps({"verdict": "strong", "links": links, "rationale": "材料支持主张"})
        with patch("job_evidence_agent.model_client.httpx.post", return_value=httpx.Response(200, json={"choices": [{"message": {"content": content}}]})):
            response = client.post(endpoint)
        assert response.status_code == 200
        assert response.json()["assessment"]["verdict"] == verdict
        assert response.json()["gate"]["eligible"] is eligible
        snapshot = client.get(f"/api/tasks/{task_id}").json()
        assert snapshot["assessments"][str(claim_id)]["verdict"] == verdict
        assert snapshot["gates"][str(claim_id)]["eligible"] is eligible


def test_repository_persists_model_assessment_and_deterministic_gate(tmp_path: Path) -> None:
    repository = SQLiteRepository(tmp_path / "workbench.sqlite3")
    task = repository.create_task("AI 应用开发")
    claim = repository.create_claim(
        Claim(0, task.id, "熟悉 FastAPI", "简历第 1 段", ("fastapi",), "pending_review")
    )
    assessment = EvidenceAssessment(claim.id, (7,), "partial", "README 中存在相关服务实现。")

    repository.save_assessment(assessment)
    repository.save_gate_decision(claim.id, decide_gate(assessment.verdict))

    assert repository.get_assessment(claim.id) == assessment
    decision = repository.get_gate_decision(claim.id)
    assert decision is not None
    assert decision.eligible is False
    assert decision.requires_review is True
    assert decision.reason == "证据不足，需要补充或人工确认"


def test_assessment_endpoint_persists_candidate_only_judgement_and_gate(tmp_path: Path) -> None:
    client = TestClient(
        create_app(
            database_path=tmp_path / "workbench.sqlite3",
            config_path=tmp_path / "runtime-config" / "missing.env",
        )
    )
    task_id = client.post("/api/tasks", json={"name": "AI 应用开发"}).json()["id"]
    client.post(
        f"/api/tasks/{task_id}/sources/text",
        json={"kind": "resume", "label": "简历", "text": "熟悉 FastAPI。"},
    )
    client.post(
        f"/api/tasks/{task_id}/sources/text",
        json={"kind": "project", "label": "README", "text": "FastAPI 服务提供健康检查接口。"},
    )
    claim_id = client.post(f"/api/tasks/{task_id}/claims/generate").json()[0]["id"]

    response = client.post(f"/api/tasks/{task_id}/claims/{claim_id}/assessment")

    assert response.status_code == 200
    body = response.json()
    assert body["evidence"][0]["locator"] == "全文"
    assert body["assessment"]["verdict"] == "partial"
    assert body["assessment"]["links"] == [item["id"] for item in body["evidence"]]
    assert body["gate"] == {
        "eligible": False,
        "requires_review": True,
        "reason": "证据不足，需要补充或人工确认",
    }


def test_failed_model_results_do_not_persist_and_current_claim_can_recover(tmp_path: Path) -> None:
    config_path = tmp_path / "model.env"
    ModelConfigStore(config_path).save(ModelConfig.create(
        base_url="https://api.example.com/v1", model_name="test", api_key="sk-test-secret",
    ))
    client = TestClient(create_app(database_path=tmp_path / "workbench.sqlite3", config_path=config_path))
    task_id = client.post("/api/tasks", json={"name": "模型失败恢复"}).json()["id"]
    for kind, text in [("resume", "熟悉 FastAPI。"), ("project", "FastAPI 服务提供健康检查接口。")]:
        client.post(f"/api/tasks/{task_id}/sources/text", json={"kind": kind, "label": kind, "text": text})
    claim_id = client.post(f"/api/tasks/{task_id}/claims/generate").json()[0]["id"]
    endpoint = f"/api/tasks/{task_id}/claims/{claim_id}/assessment"

    with patch("job_evidence_agent.model_client.httpx.post", return_value=httpx.Response(200, json={"choices": [{"message": {"content": "private sk-test-secret invalid-json"}}]})):
        failed = client.post(endpoint)
    assert failed.status_code == 503
    assert "sk-test-secret" not in failed.text
    after_failure = client.get(f"/api/tasks/{task_id}").json()
    assert after_failure["assessments"] == {}
    assert after_failure["gates"] == {}
    assert after_failure["claims"][0]["status"] == "pending_review"

    def model_result(links: list[int]) -> httpx.Response:
        content = json.dumps({"verdict": "partial", "links": links, "rationale": "候选包含接口实现，但不能证明个人职责"})
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    with patch("job_evidence_agent.model_client.httpx.post", return_value=model_result([999999])):
        invalid_reference = client.post(endpoint)
    assert invalid_reference.status_code == 502
    assert client.get(f"/api/tasks/{task_id}").json()["assessments"] == {}

    evidence = client.get(f"/api/tasks/{task_id}/claims/{claim_id}/evidence").json()
    assert evidence
    with patch("job_evidence_agent.model_client.httpx.post", return_value=model_result([evidence[0]["id"]])):
        recovered = client.post(endpoint)
    assert recovered.status_code == 200
    assert recovered.json()["assessment"]["claim_id"] == claim_id
    assert recovered.json()["gate"]["eligible"] is False
    assert recovered.json()["gate"]["requires_review"] is True
    assert str(claim_id) in client.get(f"/api/tasks/{task_id}").json()["assessments"]
