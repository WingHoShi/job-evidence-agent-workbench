import pytest

from job_evidence_agent.database import SQLiteRepository
from job_evidence_agent.interview_contracts import InterviewOptions
from job_evidence_agent.interview_store import InterviewStore
from job_evidence_agent.workflows.interview import ModelInterviewWorkflow
from interview_helpers import InterviewModel, configured_store, confirmed_task


@pytest.fixture
def setup(tmp_path):
    repository = SQLiteRepository(tmp_path / "test.db")
    task = confirmed_task(repository)
    store = InterviewStore(repository)
    store.initialize()
    model = InterviewModel()
    workflow = ModelInterviewWorkflow(repository, store, configured_store(tmp_path), model)
    return task, store, model, workflow


def start(setup, count=2):
    task, _, _, workflow = setup
    return workflow.start(task.id, "start-key", InterviewOptions(question_count=count))


def test_real_workflow_followup_uses_answer_and_preserves_claim(setup):
    session = start(setup)
    task, store, model, workflow = setup
    session = workflow.answer(session.id, session.turns[0].id, "我用 pytest 测试接口", "answer-key")
    assert session.turns[1].claim_id == session.turns[0].claim_id
    assert session.turns[1].followup_of_turn_id == session.turns[0].id
    assert "pytest" in session.turns[1].question
    assert session.operation.usage == {"total_tokens": 20}
    assert len(model.questions) == 2


def test_failure_preserves_answer_explicit_retry_only(setup):
    session = start(setup)
    _, store, model, workflow = setup
    model.question_failure = True
    saved = workflow.answer(session.id, session.turns[0].id, "我用路由函数", "answer-key")
    assert saved.turns[0].answer == "我用路由函数"
    assert saved.operation.state == "failed"
    workflow.answer(session.id, session.turns[0].id, "我用路由函数", "answer-key")
    assert len(model.questions) == 2
    model.question_failure = False
    recovered = workflow.retry(session.id, saved.operation.id)
    assert len(recovered.turns) == 2
    assert "路由函数" in recovered.turns[1].question


def test_last_answer_and_cached_review_survive_reopen(setup):
    session = start(setup, count=1)
    _, store, model, workflow = setup
    session = workflow.answer(session.id, session.turns[0].id, "我实现接口", "answer-key")
    assert session.status == "ready_to_finish"
    finished = workflow.finish(session.id, "finish-key")
    again = workflow.finish(session.id, "finish-key")
    assert again.review == finished.review
    assert len(model.reviews) == 1
    restored = InterviewStore(SQLiteRepository(store.database_path)).get_session(session.id)
    assert restored.status == "completed"
    assert restored.review["turns"][0]["answer"] == "我实现接口"
    assert restored.review["summary"]["partial"] is False


def test_review_failure_not_completed_and_can_retry(setup):
    session = start(setup, count=2)
    _, store, model, workflow = setup
    session = workflow.answer(session.id, session.turns[0].id, "我实现接口", "answer-key")
    model.review_failure = True
    failed = workflow.finish(session.id, "finish-key")
    assert failed.status == "generating_review"
    assert failed.review is None
    model.review_failure = False
    recovered = workflow.retry(session.id, failed.operation.id)
    assert recovered.status == "completed"
    assert recovered.review["summary"]["partial"] is True


def test_zero_answers_no_model_review_and_no_fake_evaluation(setup):
    session = start(setup)
    _, store, model, workflow = setup
    completed = workflow.finish(session.id, "finish-key")
    assert completed.status == "completed"
    assert model.reviews == []
    assert completed.review["summary"]["answered_count"] == 0
    assert completed.review["turn_reviews"] == []
    assert "尚无可分析回答" in completed.review["notice"]


def test_repeat_start_does_not_change_snapshot_or_charge_again(setup):
    session = start(setup)
    task, store, model, workflow = setup
    original = store.get_snapshot(session.id)
    source = workflow.repository.create_source(task_id=task.id, kind="job_description", label="新岗位", relative_path="new.md")
    workflow.repository.create_chunk(source_id=source.id, text="新内容", locator="全文", language="zh")
    assert start(setup).id == session.id
    assert store.get_snapshot(session.id) == original
    assert len(model.questions) == 1


def test_zero_answer_finish_still_works_after_context_budget_failure(setup):
    task, store, model, workflow = setup
    from job_evidence_agent.models import Claim
    workflow.repository.create_claim(Claim(0, task.id, "巨" * 32000, "超长主张", (), "confirmed"))
    # 首题选择无岗位关联时按风险/原顺序，这里强制当前接受主张过长。
    with store._connection(True) as connection:
        connection.execute("UPDATE claims SET text=? WHERE id=1", ("长" * 32000,))
    session = start(setup)
    assert session.operation.state == "failed"
    finished = workflow.finish(session.id, "finish-key")
    assert finished.status == "completed"
    assert model.reviews == []
