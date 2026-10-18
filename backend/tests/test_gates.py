from job_evidence_agent.gates import decide_gate


def test_gate_rejects_missing_evidence_and_requires_review_for_conflict() -> None:
    only_resume = decide_gate("none")
    assert only_resume.eligible is False
    assert only_resume.requires_review is True

    partial_code = decide_gate("partial")
    assert partial_code.eligible is False
    assert partial_code.requires_review is True

    strong_evidence = decide_gate("strong")
    assert strong_evidence.eligible is True
    assert strong_evidence.requires_review is False

    conflict = decide_gate("conflict")
    assert conflict.eligible is False
    assert conflict.requires_review is True
