"""不可由模型绕过的证据门禁。"""

from job_evidence_agent.models import GateDecision


def decide_gate(verdict: str) -> GateDecision:
    if verdict == "strong":
        return GateDecision(True, False, "证据充分")
    if verdict == "conflict":
        return GateDecision(False, True, "材料存在冲突，必须人工复核")
    if verdict == "partial":
        return GateDecision(False, True, "证据不足，需要补充或人工确认")
    return GateDecision(False, True, "没有可核验的证据")
