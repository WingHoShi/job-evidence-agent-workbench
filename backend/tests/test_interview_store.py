import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest

from job_evidence_agent.database import SQLiteRepository
from job_evidence_agent.interview_contracts import GeneratedQuestion, InterviewOptions, InterviewSnapshot
from job_evidence_agent.interview_store import InterviewConflictError, InterviewStore


@pytest.fixture
def store(tmp_path):
    repository = SQLiteRepository(tmp_path / "workbench.sqlite3")
    repository.create_task("测试")
    result = InterviewStore(repository)
    result.initialize()
    return result


def start(store, key="start-key", count=2):
    return store.create_or_get_session(1, key, InterviewOptions(question_count=count), InterviewSnapshot(claims=[{"id": 1, "text": "FastAPI", "verdict": "partial", "risk": "需关注", "evidence": []}]))


def question(store, session):
    lease = store.claim_operation(session.operation.id, 100)
    store.complete_question(lease, GeneratedQuestion(question="接口怎么实现？", kind="main", claim_id=1, followup_of_turn_id=None, evidence_ids=[]))
    return store.get_session(session.id)


def test_repeated_start_and_changed_parameters(store):
    session = start(store)
    assert start(store).id == session.id
    with pytest.raises(InterviewConflictError):
        start(store, count=3)
    with pytest.raises(InterviewConflictError):
        start(store, key="different-key")


def test_concurrent_start_only_one_active_session(store):
    def create(key):
        try:
            return start(store, key).id
        except InterviewConflictError:
            return None
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(create, ["parallel-a", "parallel-b"]))
    assert sum(value is not None for value in results) == 1
    assert len(store.list_sessions(1)) == 1


def test_concurrent_different_answers_only_one_is_saved(store):
    session = question(store, start(store))
    def answer(index):
        try:
            store.save_answer(session.id, session.turns[0].id, f"回答{index}", f"answer-key-{index}")
            return index
        except InterviewConflictError:
            return None
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(answer, [1, 2]))
    winners = [index for index in results if index is not None]
    assert len(winners) == 1
    assert store.get_session(session.id).turns[0].answer == f"回答{winners[0]}"


def test_answer_survives_reopen_and_duplicate_does_not_overwrite(store):
    session = question(store, start(store))
    turn = session.turns[0]
    saved = store.save_answer(session.id, turn.id, "使用路由函数", "answer-key")
    assert saved.status == "generating_question"
    assert store.save_answer(session.id, turn.id, "使用路由函数", "answer-key").turns[0].answer == "使用路由函数"
    for key, text in [("answer-key", "不同回答"), ("another-key", "使用路由函数")]:
        with pytest.raises(InterviewConflictError):
            store.save_answer(session.id, turn.id, text, key)
    reopened = InterviewStore(SQLiteRepository(store.database_path))
    assert reopened.get_session(session.id).turns[0].answer == "使用路由函数"


def test_expired_lease_replaced_and_late_result_cannot_commit(store):
    session = start(store)
    first = store.claim_operation(session.operation.id, 100)
    assert store.claim_operation(session.operation.id, 101) is None
    assert store.claim_operation(session.operation.id, 221) is None
    second = store.claim_operation(session.operation.id, 221, retry=True)
    store.fail_operation(first, "迟到失败不应覆盖新租约")
    assert store.get_session(session.id).operation.state == "running"
    payload = GeneratedQuestion(question="接口怎么实现？", kind="main", claim_id=1, followup_of_turn_id=None, evidence_ids=[])
    assert store.complete_question(first, payload) is False
    assert store.complete_question(second, payload) is True
    assert len(store.get_session(session.id).turns) == 1


def test_failed_operation_requires_explicit_retry(store):
    session = start(store)
    lease = store.claim_operation(session.operation.id, 100)
    store.fail_operation(lease, "模型连接超时")
    assert store.claim_operation(session.operation.id, 101) is None
    assert store.get_session(session.id).operation.retry_allowed
    retry = store.claim_operation(session.operation.id, 102, retry=True)
    assert retry is not None
    assert store.get_session(session.id).operation.attempt_count == 2


def test_last_answer_ready_and_review_idempotent(store):
    session = question(store, start(store, count=1))
    session = store.save_answer(session.id, session.turns[0].id, "路由函数", "answer-key")
    assert session.status == "ready_to_finish"
    session = store.prepare_finish(session.id, "finish-key")
    lease = store.claim_operation(session.operation.id, 100)
    store.complete_review(lease, {"summary": {"answered_count": 1}, "turn_reviews": []})
    restored = store.prepare_finish(session.id, "finish-key")
    assert restored.status == "completed"
    assert restored.review["summary"]["answered_count"] == 1


def test_question_and_operation_commit_roll_back_together(store):
    session = start(store)
    lease = store.claim_operation(session.operation.id, 100)
    with sqlite3.connect(store.database_path) as connection:
        connection.execute("CREATE TRIGGER fail_session_update BEFORE UPDATE OF status ON interview_v2_sessions BEGIN SELECT RAISE(ABORT, 'fault'); END")
    with pytest.raises(sqlite3.IntegrityError):
        store.complete_question(lease, GeneratedQuestion(question="怎么做？", kind="main", claim_id=1, followup_of_turn_id=None, evidence_ids=[]))
    restored = store.get_session(session.id)
    assert restored.turns == []
    assert restored.operation.state == "running"


def test_review_and_completed_commit_roll_back_together(store):
    session = question(store, start(store, count=1))
    session = store.prepare_finish(session.id, "finish-key")
    lease = store.claim_operation(session.operation.id, 100)
    with sqlite3.connect(store.database_path) as connection:
        connection.execute("CREATE TRIGGER fail_completed BEFORE UPDATE OF status ON interview_v2_sessions WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT, 'fault'); END")
    with pytest.raises(sqlite3.IntegrityError):
        store.complete_review(lease, {"summary": {"answered_count": 0}})
    restored = store.get_session(session.id)
    assert restored.review is None
    assert restored.status == "generating_review"


def test_initialization_is_explicit_and_preserves_legacy_records(tmp_path):
    repository = SQLiteRepository(tmp_path / "legacy.sqlite3")
    task = repository.create_task("旧任务")
    old = repository.create_interview(task_id=task.id, mode="default", question_count=5, focus_areas=(), duration_minutes=None)
    repository.create_interview_turn(session_id=old.id, question="旧题", evidence_ids=())
    store = InterviewStore(repository)
    assert not store.is_initialized()
    store.initialize()
    store.initialize()
    assert repository.list_interview_turns(old.id)[0].question == "旧题"
    assert repository.get_interview(old.id).status == "in_progress"
