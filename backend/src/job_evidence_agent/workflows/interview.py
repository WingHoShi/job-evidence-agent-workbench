"""受约束的模型面试；内容生成与短事务恢复相互隔离。"""

import time
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from job_evidence_agent.interview_context import (
    build_interview_snapshot, build_question_input, build_review_input,
    select_question_target, validate_question, validate_review, _fit_budget,
)
from job_evidence_agent.interview_contracts import GeneratedReview, InterviewConflictError, ModelResult
from job_evidence_agent.model_client import ModelConnectionError


class InterviewNotReadyError(ValueError):
    pass


class QuestionState(TypedDict, total=False):
    session: object
    snapshot: object
    config: object
    context: object
    result: object


class ModelInterviewWorkflow:
    def __init__(self, repository, store, config_store, model_client):
        self.repository = repository
        self.store = store
        self.config_store = config_store
        self.model_client = model_client
        graph = StateGraph(QuestionState)
        graph.add_node("prepare_context", self._prepare_question)
        graph.add_node("generate_question", self._generate_question)
        graph.add_node("validate_question", self._validate_question)
        graph.add_edge(START, "prepare_context")
        graph.add_edge("prepare_context", "generate_question")
        graph.add_edge("generate_question", "validate_question")
        graph.add_edge("validate_question", END)
        self.question_graph = graph.compile()

    def _config(self):
        config = self.config_store.get()
        if config is None:
            raise InterviewNotReadyError("请先配置可用的模型")
        return config

    def start(self, task_id, request_key, options):
        if not self.repository.has_generated_report(task_id):
            raise InterviewNotReadyError("请先完成并生成审计报告")
        config = self._config()
        session = self.store.find_started(task_id, request_key, options)
        if session is None:
            snapshot = build_interview_snapshot(self.repository, task_id)
            if not snapshot.claims:
                raise InterviewNotReadyError("报告中没有人工接受的主张，无法开始面试")
            session = self.store.create_or_get_session(task_id, request_key, options, snapshot)
        return self._drive(session, config)

    def answer(self, session_id, turn_id, answer, request_key):
        config = self._config()
        session = self.store.save_answer(session_id, turn_id, answer, request_key)
        return self._drive(session, config)

    def retry(self, session_id, operation_id):
        session = self.store.get_session(session_id)
        if not session or not session.operation or session.operation.id != operation_id:
            raise InterviewConflictError("生成操作已改变，请重新加载")
        return self._drive(session, self._config(), retry=True)

    def finish(self, session_id, request_key):
        session = self.store.get_session(session_id)
        if not session:
            raise InterviewConflictError("面试不存在")
        if session.status == "completed":
            return session
        config = self._config() if any(turn.answer is not None for turn in session.turns) else None
        return self._drive(self.store.prepare_finish(session_id, request_key), config)

    def _prepare_question(self, state):
        session = state["session"]
        target = select_question_target(state["snapshot"], session.turns, session.question_count)
        context = build_question_input(state["snapshot"], session.turns, target)
        context.focus_areas = session.focus_areas
        context.duration_minutes = session.duration_minutes
        context.question_count = session.question_count
        return {"context": _fit_budget(context, 20000)}

    def _generate_question(self, state):
        return {"result": self.model_client.generate_interview_question(state["config"], state["context"])}

    def _validate_question(self, state):
        validate_question(state["result"].value, state["context"])
        return {}

    def _drive(self, session, config, retry=False):
        operation = session.operation
        if not operation or session.status in {"completed", "awaiting_answer", "ready_to_finish"}:
            return session
        lease = self.store.claim_operation(operation.id, time.time(), retry=retry)
        if lease is None:
            return self.store.get_session(session.id)
        try:
            snapshot = self.store.get_snapshot(session.id)
            if lease.kind == "question":
                state = self.question_graph.invoke({"session": session, "snapshot": snapshot, "config": config})
                self.store.complete_question(lease, state["result"].value, state["result"].usage, state["context"].truncated)
            else:
                answered = [turn for turn in session.turns if turn.answer is not None]
                context = build_review_input(snapshot, session.turns) if answered else None
                if answered:
                    result = self.model_client.generate_interview_review(config, context)
                    validate_review(result.value, context)
                else:
                    result = ModelResult(value=GeneratedReview(turn_reviews=[], consistency=[], omissions=[], technical_gaps=[], next_steps=[]))
                covered = {turn.claim_id for turn in answered}
                review = result.value.model_dump()
                review.update({
                    "summary": {"answered_count": len(answered), "unanswered_count": sum(turn.answer is None for turn in session.turns), "question_count": session.question_count, "partial": len(answered) < session.question_count, "covered_claim_ids": sorted(covered), "uncovered_claims": [{"id": c.id, "text": c.text} for c in snapshot.claims if c.id not in covered], "context_truncated": session.context_truncated or bool(context and context.truncated)},
                    "turns": [turn.model_dump() for turn in session.turns],
                    "evidence": [item.model_dump() for claim in context.snapshot.claims for item in claim.evidence] if context else [],
                    "notice": "模型分析仅供练习参考，不认证能力、项目真实性或个人贡献。" if answered else "尚无可分析回答，请重新开始一轮练习。",
                })
                self.store.complete_review(lease, review, result.usage)
        except ModelConnectionError as error:
            self.store.fail_operation(lease, str(error))
        except ValueError:
            self.store.fail_operation(lease, "面试内容或必要上下文不符合协议，请检查材料长度与模型兼容性后重试")
        return self.store.get_session(session.id)
