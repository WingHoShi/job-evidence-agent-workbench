from fastapi.testclient import TestClient
import httpx

from job_evidence_agent.app import create_app
from job_evidence_agent.database import SQLiteRepository
from job_evidence_agent.interview_store import InterviewStore
from job_evidence_agent.model_client import OpenAICompatibleClient
from interview_helpers import InterviewModel, configured_store, confirmed_task


def fixture(tmp_path, initialize=True, configured=True):
    path = tmp_path / "test.db"
    repository = SQLiteRepository(path)
    task = confirmed_task(repository)
    if initialize:
        InterviewStore(repository).initialize()
    config = configured_store(tmp_path) if configured else None
    model = InterviewModel()
    app = create_app(database_path=path, config_path=tmp_path / "model.env", model_client=model)
    return TestClient(app), task, repository, model


def test_v2_requires_explicit_initialization_and_config(tmp_path):
    client, task, repo, model = fixture(tmp_path, initialize=False, configured=False)
    url = f"/api/v2/tasks/{task.id}/interviews"
    assert client.get(url).status_code == 503
    InterviewStore(repo).initialize()
    assert client.post(url, json={"request_key": "start-key"}).status_code == 409
    assert model.questions == []


def test_v2_full_chain_and_reload_do_not_write_evidence_or_regenerate(tmp_path):
    client, task, repository, model = fixture(tmp_path)
    created = client.post(f"/api/v2/tasks/{task.id}/interviews", json={"request_key": "start-key", "question_count": 2})
    assert created.status_code == 201
    session = created.json()
    url = f"/api/v2/interviews/{session['id']}"
    for index in range(2):
        response = client.post(url + "/answers", json={"turn_id": session["turns"][-1]["id"], "answer": "我写接口测试", "request_key": f"answer-key-{index}"})
        assert response.status_code == 200
        session = response.json()
        assert "score" not in session
    assert session["status"] == "ready_to_finish"
    finished = client.post(url + "/finish", json={"request_key": "finish-key"})
    assert finished.status_code == 200
    assert finished.json()["review"]["turns"][0]["answer"] == "我写接口测试"
    restored = TestClient(create_app(database_path=repository.database_path, config_path=tmp_path / "model.env", model_client=model)).get(url)
    assert restored.json()["review"] == finished.json()["review"]
    assert len(model.questions) == 2 and len(model.reviews) == 1
    assert repository.list_sources(task.id) == []


def test_truncated_review_keeps_answers_and_retries_only_on_explicit_request(tmp_path, monkeypatch):
    import json
    client, task, repository, model = fixture(tmp_path)
    session = client.post(f"/api/v2/tasks/{task.id}/interviews", json={"request_key": "truncate-start", "question_count": 1}).json()
    url = f"/api/v2/interviews/{session['id']}"
    session = client.post(url + "/answers", json={"turn_id": session["turns"][0]["id"], "answer": "不清楚", "request_key": "truncate-answer"}).json()
    calls = []
    review = {"turn_reviews": [{"turn_id": session["turns"][0]["id"], "strengths": [], "missing_details": ["未说明实现"], "technical_points": [], "suggestions": ["学习路由"], "evidence_ids": []}], "consistency": [], "omissions": [], "technical_gaps": [], "next_steps": []}
    def reply(*args, **kwargs):
        calls.append(kwargs)
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(review)}, "finish_reason": "length" if len(calls) == 1 else "stop"}]})
    monkeypatch.setattr(httpx, "post", reply)
    model.generate_interview_review = OpenAICompatibleClient().generate_interview_review
    failed = client.post(url + "/finish", json={"request_key": "truncate-finish"}).json()
    assert failed["review"] is None and failed["operation"]["state"] == "failed"
    restored = client.get(url).json()
    assert restored["turns"][0]["answer"] == "不清楚"
    assert len(calls) == 1
    completed = client.post(url + "/retry", json={"operation_id": failed["operation"]["id"]}).json()
    assert completed["status"] == "completed"
    assert completed["review"]["turns"][0]["answer"] == "不清楚"
    assert len(calls) == 2


def test_v2_input_guards_missing_task_and_cross_session_turn(tmp_path):
    client, task, repo, model = fixture(tmp_path)
    assert client.post("/api/v2/tasks/999/interviews", json={"request_key": "start-key"}).status_code == 404
    url = f"/api/v2/tasks/{task.id}/interviews"
    assert client.post(url, json={"request_key": "short"}).status_code == 422
    assert client.post(url, json={"request_key": "start-key", "focus_areas": [" "]}).status_code == 422
    session = client.post(url, json={"request_key": "start-key"}).json()
    answer_url = f"/api/v2/interviews/{session['id']}/answers"
    assert client.post(answer_url, json={"request_key": "answer-key", "turn_id": 999, "answer": "回答"}).status_code == 409
    assert client.post(answer_url, json={"request_key": "answer-key", "turn_id": session["turns"][0]["id"], "answer": "字" * 2001}).status_code == 422


def test_legacy_read_only_and_task_list_explicit_version(tmp_path):
    client, task, repo, model = fixture(tmp_path)
    old = repo.create_interview(task_id=task.id, mode="default", question_count=5, focus_areas=(), duration_minutes=None)
    repo.create_interview_turn(session_id=old.id, question="旧题", evidence_ids=())
    assert client.get(f"/api/interviews/{old.id}").json()["turns"][0]["question"] == "旧题"
    assert client.post(f"/api/interviews/{old.id}/turns", json={"answer": "回答"}).status_code == 409
    assert client.get(f"/api/v2/tasks/{task.id}/interviews").json()[0]["version"] == 1


def test_malformed_model_reply_records_failed_operation_not_http_500(tmp_path, monkeypatch):
    _, task, repository, _ = fixture(tmp_path)
    monkeypatch.setattr(httpx, "post", lambda *args, **kwargs: httpx.Response(200, json={"choices": [None]}))
    client = TestClient(create_app(database_path=repository.database_path, config_path=tmp_path / "model.env", model_client=OpenAICompatibleClient()))
    response = client.post(f"/api/v2/tasks/{task.id}/interviews", json={"request_key": "start-key"})
    assert response.status_code == 201
    assert response.json()["operation"]["state"] == "failed"
    assert response.json()["operation"]["retry_allowed"]
    assert response.json()["turns"] == []


def test_api_next_question_failure_retry_and_early_finish(tmp_path):
    client, task, repository, model = fixture(tmp_path)
    session = client.post(f"/api/v2/tasks/{task.id}/interviews", json={"request_key": "start-key", "question_count": 5}).json()
    url = f"/api/v2/interviews/{session['id']}"
    model.question_failure = True
    response = client.post(url + "/answers", json={"turn_id": session["turns"][0]["id"], "answer": "我定义了路由", "request_key": "answer-key"})
    assert response.status_code == 200
    assert response.json()["turns"][0]["answer"] == "我定义了路由"
    assert response.json()["operation"]["state"] == "failed"
    operation = response.json()["operation"]["id"]
    model.question_failure = False
    retry = client.post(url + "/retry", json={"operation_id": operation})
    assert retry.json()["turns"][-1]["kind"] == "followup"
    finished = client.post(url + "/finish", json={"request_key": "finish-key"}).json()
    assert finished["status"] == "completed" and finished["review"]["summary"]["partial"]
    assert finished["review"]["summary"]["answered_count"] == 1
    assert repository.list_sources(task.id) == []
