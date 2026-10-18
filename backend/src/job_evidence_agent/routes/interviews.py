from contextlib import closing
from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import Field, StrictInt

from job_evidence_agent.interview_contracts import Contract, InterviewOptions, RequestKey, InterviewConflictError
from job_evidence_agent.interview_store import InterviewStore
from job_evidence_agent.workflows.interview import ModelInterviewWorkflow, InterviewNotReadyError


class StartRequest(InterviewOptions):
    request_key: RequestKey


class AnswerRequest(Contract):
    request_key: RequestKey
    turn_id: StrictInt
    answer: Annotated[str, Field(strict=True, min_length=1, max_length=2000)]


class FinishRequest(Contract):
    request_key: RequestKey


class RetryRequest(Contract):
    operation_id: StrictInt


def create_interviews_router(repository, config_store, model_client):
    router = APIRouter(tags=["interviews"])
    store = InterviewStore(repository)
    workflow = ModelInterviewWorkflow(repository, store, config_store, model_client)

    def require_initialized():
        if not store.is_initialized():
            raise HTTPException(503, "新版面试尚未初始化，请先按部署说明备份并迁移")

    def require_session(session_id):
        require_initialized()
        session = store.get_session(session_id)
        if session is None:
            raise HTTPException(404, "面试不存在")
        return session

    def perform(call):
        try:
            return call()
        except (InterviewConflictError, InterviewNotReadyError) as error:
            raise HTTPException(409, str(error)) from error
        except ValueError as error:
            raise HTTPException(422, "面试输入或上下文不符合要求") from error

    @router.get("/api/v2/tasks/{task_id}/interviews")
    def list_interviews(task_id: int):
        require_initialized()
        if repository.get_task(task_id) is None:
            raise HTTPException(404, "任务不存在")
        sessions = [item.model_dump() for item in store.list_sessions(task_id)]
        with closing(repository._connect()) as connection:
            old = connection.execute("SELECT id,status,question_count FROM interviews WHERE task_id=? ORDER BY id DESC", (task_id,)).fetchall()
        return sessions + [{"id": row[0], "status": row[1], "question_count": row[2], "task_id": task_id, "version": 1} for row in old]

    @router.post("/api/v2/tasks/{task_id}/interviews", status_code=201)
    def start_interview(task_id: int, request: StartRequest):
        require_initialized()
        if repository.get_task(task_id) is None:
            raise HTTPException(404, "任务不存在")
        return perform(lambda: workflow.start(task_id, request.request_key, InterviewOptions(**request.model_dump(exclude={"request_key"}))))

    @router.get("/api/v2/interviews/{session_id}")
    def get_session(session_id: int):
        return require_session(session_id)

    @router.post("/api/v2/interviews/{session_id}/answers")
    def answer(session_id: int, request: AnswerRequest):
        require_session(session_id)
        return perform(lambda: workflow.answer(session_id, request.turn_id, request.answer, request.request_key))

    @router.post("/api/v2/interviews/{session_id}/retry")
    def retry(session_id: int, request: RetryRequest):
        require_session(session_id)
        return perform(lambda: workflow.retry(session_id, request.operation_id))

    @router.post("/api/v2/interviews/{session_id}/finish")
    def finish(session_id: int, request: FinishRequest):
        require_session(session_id)
        return perform(lambda: workflow.finish(session_id, request.request_key))

    @router.get("/api/interviews/{session_id}")
    def get_legacy(session_id: int):
        session = repository.get_interview(session_id)
        if session is None:
            raise HTTPException(404, "面试不存在")
        return {"session": {**asdict(session), "version": 1}, "turns": [asdict(turn) for turn in repository.list_interview_turns(session_id)], "review": None}

    @router.post("/api/tasks/{task_id}/interviews")
    @router.post("/api/interviews/{session_id}/turns")
    @router.post("/api/interviews/{session_id}/finish")
    def legacy_write_disabled():
        raise HTTPException(409, "旧版模板面试仅供查看，请通过新版入口开始面试")

    return router
