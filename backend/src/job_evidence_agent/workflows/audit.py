"""按主张顺序暂停的 LangGraph 审核工作流。"""

from pathlib import Path
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from job_evidence_agent.workflows.checkpoints import SQLiteAuditCheckpointer


class AuditGraphState(TypedDict):
    position: int
    total: int
    status: str


def build_audit_graph():
    graph = StateGraph(AuditGraphState)
    graph.add_node("advance", lambda state: {"position": state["position"] + 1})
    graph.add_node("await_review", lambda state: {"status": "awaiting_review"})
    graph.add_node("complete", lambda state: {"status": "completed"})
    graph.add_edge(START, "advance")
    graph.add_conditional_edges(
        "advance",
        lambda state: "complete" if state["position"] >= state["total"] else "await_review",
        {"await_review": "await_review", "complete": "complete"},
    )
    graph.add_edge("await_review", END)
    graph.add_edge("complete", END)
    return graph.compile()


class AuditWorkflow:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path
        self.checkpointer = SQLiteAuditCheckpointer(database_path)
        self.graph = build_audit_graph()

    def start(self, task_id: int, claim_ids: list[int]) -> None:
        self.checkpointer.save(task_id, claim_ids, 0, "awaiting_review" if claim_ids else "completed")
        self.checkpointer.add_event(task_id, "审核工作流已启动")

    def current(self, task_id: int) -> dict[str, object]:
        checkpoint = self.checkpointer.load(task_id)
        if checkpoint is None:
            return {"status": "created", "claim_id": None}
        ids, position, status = checkpoint
        return {"status": status, "claim_id": ids[position] if status == "awaiting_review" else None}

    def review(self, task_id: int, claim_id: int, decision: str) -> None:
        current = self.current(task_id)
        if current["claim_id"] != claim_id or decision not in {"accepted", "rejected"}:
            raise ValueError("审核状态或决策不合法")
        checkpoint = self.checkpointer.load(task_id)
        if checkpoint is None:
            raise ValueError("审核任务不存在")
        ids, position, _ = checkpoint
        state = self.graph.invoke({"position": position, "total": len(ids), "status": "awaiting_review"})
        self.checkpointer.save(task_id, ids, state["position"], state["status"])
        self.checkpointer.add_event(task_id, f"主张 {claim_id} 已{decision}")

    def events(self, task_id: int) -> list[str]:
        return self.checkpointer.events(task_id)
