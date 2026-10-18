from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from job_evidence_agent.app import create_app
from job_evidence_agent.database import SQLiteRepository
from job_evidence_agent.interview_contracts import GeneratedReview, TurnView
from job_evidence_agent.interview_context import build_question_input, select_question_target, validate_review, build_review_input
from test_interview_context import snapshot


def turns_for(answers):
    return [TurnView(id=i + 1, ordinal=i + 1, claim_id=1, kind="main", followup_of_turn_id=None, question="如何实现？", answer=answer, evidence_ids=[]) for i, answer in enumerate(answers)]


@pytest.mark.parametrize("answers, expected", [
    (["不太清楚", "这个我也不太清楚"], "foundation"),
    (["这个我不会", "这个也确实是不太清楚"], "foundation"),
    (["这个扩展设计我还不会，希望先问基础问题"], "foundation"),
    (["希望先问基础题"], "foundation"),
    (["请先问基础问题"], "foundation"),
    (["这个我不会，我没学过", "这题我也不会"], "foundation"),
    (["不太清楚"], "default"),
    (["不太清楚", "我定义了路由"], "default"),
    (["我不会直接返回 200，会检查依赖", "我不会使用无限重试，会设置超时"], "default"),
    (["GET", "JSON"], "default"),
])
def test_difficulty_guidance_only_for_clear_difficulty_signals(answers, expected):
    turns = turns_for(answers)
    context = build_question_input(snapshot(), turns, select_question_target(snapshot(), turns, 10))
    assert context.difficulty_hint == expected
    assert [turn.answer for turn in context.turns] == answers


def test_new_review_fields_are_optional_for_old_results_and_validate_new_references():
    old = dict(turn_reviews=[], consistency=[], omissions=[], technical_gaps=[], next_steps=[])
    legacy = GeneratedReview.model_validate(old)
    assert legacy.overall_summary is None
    assert legacy.answer_consistency == []
    new = GeneratedReview.model_validate(old | {"overall_summary": "本轮未展示实现细节。", "answer_consistency": [{"text": "回答一致", "turn_ids": [999], "claim_ids": [1], "evidence_ids": []}]})
    with pytest.raises(ValueError, match="引用"):
        validate_review(new, build_review_input(snapshot(), []))


def test_task_list_is_read_only_and_distinguishes_same_names(tmp_path: Path):
    path = tmp_path / "tasks.db"
    repository = SQLiteRepository(path)
    first = repository.create_task("同名任务")
    second = repository.create_task("同名任务")
    client = TestClient(create_app(database_path=path, config_path=tmp_path / "absent.env"))
    response = client.get("/api/tasks")
    assert response.status_code == 200
    assert response.json() == [{"id": second.id, "name": "同名任务", "status": "draft"}, {"id": first.id, "name": "同名任务", "status": "draft"}]
    assert client.get("/api/tasks").json() == response.json()
    assert repository.get_task(first.id).status == "draft"
