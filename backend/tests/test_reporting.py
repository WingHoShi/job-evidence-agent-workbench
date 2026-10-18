from pathlib import Path
import pytest

from job_evidence_agent.database import SQLiteRepository
from job_evidence_agent.models import Claim, EvidenceAssessment, GateDecision
from job_evidence_agent.reporting import ReportNotReadyError, build_report, report_to_markdown


def test_report_only_includes_confirmed_claims_with_locator(tmp_path: Path) -> None:
    repository = SQLiteRepository(tmp_path / "data.sqlite3")
    task = repository.create_task("AI 应用开发")
    repository.create_claim(Claim(0, task.id, "熟悉 FastAPI，API_KEY=sk-secret123", "C:\\Users\\Syh\\resume.md", ("fastapi",), "confirmed"))
    repository.create_claim(Claim(0, task.id, "掌握 Kubernetes", "简历第 2 段", ("k8s",), "rejected"))

    report = build_report(repository, task.id)
    markdown = report_to_markdown(report)

    assert report.confirmed_claims == (("熟悉 FastAPI，API_KEY=sk-secret123", "C:\\Users\\Syh\\resume.md"),)
    assert report.insufficient_claims == ("熟悉 FastAPI，API_KEY=sk-secret123", "掌握 Kubernetes")
    assert "人工已接受" in markdown
    assert "[本机路径已隐藏]" in markdown
    assert "API Key" not in markdown
    assert "sk-secret123" not in markdown
    assert "C:\\Users\\Syh" not in markdown


def test_report_refuses_when_pending_review_exists(tmp_path: Path) -> None:
    repository = SQLiteRepository(tmp_path / "data.sqlite3")
    task = repository.create_task("AI 应用开发")
    repository.create_claim(Claim(0, task.id, "熟悉 FastAPI", "第 1 段", ("fastapi",), "pending_review"))

    with pytest.raises(ReportNotReadyError):
        build_report(repository, task.id)


def test_report_preserves_risky_acceptance_and_rejected_decisions(tmp_path: Path) -> None:
    repo = SQLiteRepository(tmp_path / "db.sqlite3")
    task = repo.create_task("岗位")
    source = repo.create_source(task_id=task.id, kind="project", label="服务代码", relative_path="src/app.py")
    chunk = repo.create_chunk(source_id=source.id, text="from fastapi import FastAPI", locator="第 1 行", language="python")
    accepted = repo.create_claim(Claim(0, task.id, "使用 FastAPI 和 Docker Compose", "简历第1段", (), "confirmed"))
    rejected = repo.create_claim(Claim(0, task.id, "将服务响应时间从 5 秒优化至 1 秒", "简历第2段", (), "rejected"))
    repo.save_assessment(EvidenceAssessment(accepted.id, (chunk.id,), "partial", "只有接口代码，缺少编排配置"))
    repo.save_gate_decision(accepted.id, GateDecision(False, True, "证据不足，需要补充或人工确认"))
    repo.save_assessment(EvidenceAssessment(rejected.id, (), "none", "没有性能测试记录"))
    repo.save_gate_decision(rejected.id, GateDecision(False, True, "没有可核验的证据"))

    report = build_report(repo, task.id)
    first, second = report.claim_reviews
    assert (first.review_status, first.verdict, first.risk) == ("人工已接受", "部分支持", "需关注")
    assert first.evidence[0].relative_path == "src/app.py"
    assert first.evidence[0].locator == "第 1 行"
    assert second.review_status == "人工已拒绝"
    assert len(report.insufficient_claims) == 2
    markdown = report_to_markdown(report)
    for text in ("人工接受不等于证据充分", "部分支持", "需关注", "src/app.py", "第 1 行", "只有接口代码", "人工已拒绝", "性能测试"):
        assert text in markdown
    assert repo.list_claims(task.id)[0].status == "confirmed"


def test_report_flags_legacy_self_citations_and_cross_task_links(tmp_path: Path) -> None:
    repo = SQLiteRepository(tmp_path / "db.sqlite3")
    task = repo.create_task("本任务")
    other = repo.create_task("另一任务")
    links = []
    for task_id, kind in ((task.id, "resume"), (task.id, "job_description"), (other.id, "project")):
        source = repo.create_source(task_id=task_id, kind=kind, label="不应成为证据", relative_path="private.md")
        links.append(repo.create_chunk(source_id=source.id, text="另一任务私有内容" if task_id == other.id else "本任务自述内容", locator="全文", language="zh").id)
    claim = repo.create_claim(Claim(0, task.id, "熟悉 FastAPI", "简历", (), "confirmed"))
    repo.save_assessment(EvidenceAssessment(claim.id, tuple(links), "strong", "旧判定"))
    repo.save_gate_decision(claim.id, GateDecision(True, False, "证据充分"))
    report = build_report(repo, task.id)
    review = report.claim_reviews[0]
    assert review.evidence == ()
    assert review.risk == "需关注"
    assert "历史引用" in review.warning
    assert "另一任务私有内容" not in report_to_markdown(report)
    assert repo.get_assessment(claim.id).verdict == "strong"


def test_report_jd_screening_does_not_count_rejected_claims_as_coverage(tmp_path: Path) -> None:
    repo = SQLiteRepository(tmp_path / "db.sqlite3")
    task = repo.create_task("岗位")
    source = repo.create_source(task_id=task.id, kind="job_description", label="岗位", relative_path="jd.md")
    repo.create_chunk(source_id=source.id, text="- 熟悉 FastAPI。\n- 掌握 Kubernetes。\n- 有团队协作经验。", locator="要求", language="zh")
    repo.create_claim(Claim(0, task.id, "熟悉 FastAPI", "简历1", (), "confirmed"))
    repo.create_claim(Claim(0, task.id, "掌握 Kubernetes", "简历2", (), "rejected"))
    report = build_report(repo, task.id)
    assert "规则初筛" in report.jd_coverage
    assert [item.status for item in report.jd_requirements] == ["有关联主张，证据待补", "仅有已拒绝主张", "待人工分析"]
    assert "不代表岗位匹配率" in report.jd_coverage


def test_empty_task_cannot_unlock_interview_by_generating_report(tmp_path: Path) -> None:
    repo = SQLiteRepository(tmp_path / "db.sqlite3")
    task = repo.create_task("空任务")
    with pytest.raises(ReportNotReadyError):
        build_report(repo, task.id)


@pytest.mark.parametrize("kind,verdict,has_gate,expected_risk", [
    ("project", "strong", True, "低"),
    ("supplement", "strong", True, "需关注"),
    ("project", "strong", False, "待评估"),
    ("project", "conflict", True, "需关注"),
])
def test_report_risk_keeps_evidence_type_gate_and_conflicts(
    tmp_path: Path, kind: str, verdict: str, has_gate: bool, expected_risk: str,
) -> None:
    repo = SQLiteRepository(tmp_path / "db.sqlite3")
    task = repo.create_task("岗位")
    source = repo.create_source(task_id=task.id, kind=kind, label="验证材料", relative_path="src/app.py")
    chunk = repo.create_chunk(source_id=source.id, text="FastAPI 测试记录", locator="全文", language="zh")
    jd = repo.create_source(task_id=task.id, kind="job_description", label="岗位", relative_path="jd.md")
    repo.create_chunk(source_id=jd.id, text="熟悉 FastAPI", locator="要求", language="zh")
    claim = repo.create_claim(Claim(0, task.id, "熟悉 FastAPI", "简历", (), "confirmed"))
    repo.save_assessment(EvidenceAssessment(claim.id, (chunk.id,), verdict, "判定说明"))
    if has_gate:
        repo.save_gate_decision(claim.id, GateDecision(verdict == "strong", verdict != "strong", "门禁说明"))
    report = build_report(repo, task.id)
    assert report.claim_reviews[0].risk == expected_risk
    assert report.jd_requirements[0].status == ("有关联主张，证据充分（关键词）" if expected_risk == "低" else "有关联主张，证据待补")
    assert bool(report.conflicts) == (verdict == "conflict")
    if kind == "supplement":
        assert "非独立证明" in report_to_markdown(report)


def test_export_redacts_secrets_in_new_evidence_and_rationale_fields(tmp_path: Path) -> None:
    repo = SQLiteRepository(tmp_path / "db.sqlite3")
    task = repo.create_task("岗位")
    source = repo.create_source(task_id=task.id, kind="project", label="代码", relative_path="C:/Users/Syh/private.py")
    chunk = repo.create_chunk(source_id=source.id, text="API_KEY=sk-sensitive123 FastAPI", locator="全文", language="zh")
    claim = repo.create_claim(Claim(0, task.id, "熟悉 FastAPI", "简历", (), "confirmed"))
    repo.save_assessment(EvidenceAssessment(claim.id, (chunk.id,), "partial", "token=private123 缺少记录"))
    markdown = report_to_markdown(build_report(repo, task.id))
    assert "sk-sensitive123" not in markdown
    assert "private123" not in markdown
    assert "C:/Users/Syh" not in markdown
    assert "敏感信息已隐藏" in markdown
