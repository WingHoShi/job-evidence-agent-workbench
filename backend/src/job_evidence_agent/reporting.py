from dataclasses import dataclass
from datetime import datetime
import re

from job_evidence_agent.database import SQLiteRepository
from job_evidence_agent.taxonomy import capability_tags

class ReportNotReadyError(ValueError):
    pass


@dataclass(frozen=True)
class ReportEvidence:
    chunk_id: int
    source_kind: str
    source_label: str
    relative_path: str
    locator: str
    excerpt: str


@dataclass(frozen=True)
class ClaimReview:
    claim_id: int
    text: str
    resume_locator: str
    review_status: str
    verdict: str
    risk: str
    rationale: str
    gate_reason: str
    warning: str
    evidence: tuple[ReportEvidence, ...]
    suggestions: tuple[str, ...]


@dataclass(frozen=True)
class JobRequirement:
    text: str
    locator: str
    keywords: tuple[str, ...]
    claim_ids: tuple[int, ...]
    status: str


@dataclass(frozen=True)
class Report:
    task_id: int
    generated_at: str
    confirmed_claims: tuple[tuple[str, str], ...]
    insufficient_claims: tuple[str, ...]
    conflicts: tuple[str, ...]
    jd_coverage: str
    next_steps: tuple[str, ...]
    claim_reviews: tuple[ClaimReview, ...]
    jd_requirements: tuple[JobRequirement, ...]

def build_report(repository: SQLiteRepository, task_id: int) -> Report:
    claims = repository.list_claims(task_id)
    if not claims:
        raise ReportNotReadyError("尚无能力主张，不能生成正式报告")
    if any(item.status not in {"confirmed", "rejected"} for item in claims):
        raise ReportNotReadyError("仍有待审核主张，不能生成正式报告")
    sources = repository.list_sources(task_id)
    chunks = [(source, chunk) for source in sources for chunk in repository.list_chunks(source.id)]
    evidence_by_id = {chunk.id: (source, chunk) for source, chunk in chunks if source.kind in {"project", "supplement"}}
    reviews = []
    for claim in claims:
        assessment = repository.get_assessment(claim.id)
        gate = repository.get_gate_decision(claim.id)
        links = tuple(dict.fromkeys(assessment.links)) if assessment else ()
        valid_links = tuple(link for link in links if link in evidence_by_id)
        invalid_links = len(valid_links) != len(links)
        evidence = tuple(ReportEvidence(
            link, evidence_by_id[link][0].kind,
            _safe_text(evidence_by_id[link][0].label),
            _safe_text(evidence_by_id[link][0].relative_path),
            _safe_text(evidence_by_id[link][1].locator),
            _safe_text(evidence_by_id[link][1].text)[:600],
        ) for link in valid_links)
        fully_supported = bool(
            assessment and assessment.verdict == "strong" and gate and gate.eligible
            and not gate.requires_review and not invalid_links
            and any(item.source_kind == "project" for item in evidence)
        )
        risk = "低" if fully_supported else ("待评估" if not assessment or not gate else "需关注")
        warnings = []
        if claim.status == "confirmed" and not fully_supported:
            warnings.append("人工接受不等于证据充分；本条仍需关注或补证。")
        if invalid_links:
            warnings.append("历史引用包含简历、岗位描述、缺失或跨任务片段，已从报告证据列表排除；原判定未改写。")
        suggestions = []
        if not fully_supported:
            normalized = claim.text.lower()
            if "docker" in normalized:
                suggestions.append("补充 Docker Compose 配置、启动日志与服务验证记录。")
            if "kubernetes" in normalized or "k8s" in normalized:
                suggestions.append("补充 Kubernetes 配置或实践记录，并说明 Pod、Deployment、Service 的关系。")
            if any(term in normalized for term in ("优化", "性能", "响应时间", "延迟", "吞吐")):
                suggestions.append("补充优化前后性能测试：同一环境、数据集、并发条件、计时口径及原始结果。")
            if assessment and assessment.verdict == "conflict":
                suggestions.append("核对冲突材料的版本、适用条件和原始记录，不能用人工接受消除冲突。")
            if not suggestions:
                suggestions.append("补充实现代码、测试或验收记录，并标明本人负责的范围。")
        if claim.status == "rejected":
            suggestions.append("本条人工已拒绝，不计入已接受主张；补证前不要作为已核验能力使用。")
        reviews.append(ClaimReview(
            claim.id, _safe_text(claim.text), _safe_text(claim.resume_locator),
            "人工已接受" if claim.status == "confirmed" else "人工已拒绝",
            {"strong": "充分支持", "partial": "部分支持", "none": "没有证据", "conflict": "材料冲突"}.get(assessment.verdict if assessment else "", "未判定"),
            risk, _safe_text(assessment.rationale) if assessment else "尚无证据判定，不应视为已核验。",
            _safe_text(gate.reason) if gate else "尚未运行确定性门禁",
            " ".join(warnings), evidence, tuple(suggestions),
        ))
    confirmed = tuple((item.text, item.resume_locator) for item in claims if item.status == "confirmed")
    insufficient = tuple(claim.text for claim, item in zip(claims, reviews) if item.risk != "低")
    conflicts = tuple(item.text for item in reviews if item.verdict == "材料冲突")
    requirements = _job_requirements(chunks, tuple(reviews))
    jd_coverage = (
        "规则初筛：按岗位条目中的技术关键词关联简历主张，不代表岗位匹配率或完整语义分析；未识别条目需人工分析。"
        if any(source.kind == "job_description" for source in sources)
        else "未导入岗位描述，无法分析岗位覆盖情况。"
    )
    steps = [f"主张 {item.claim_id}：{suggestion}" for item in reviews for suggestion in item.suggestions]
    if any(item.status != "有关联主张，证据充分（关键词）" for item in requirements):
        steps.append("逐项核对岗位要求；关键词关联不代表整条要求已满足，补充未覆盖能力材料。")
    return Report(task_id, datetime.now().isoformat(timespec="seconds"), confirmed, insufficient, conflicts, jd_coverage, tuple(steps), tuple(reviews), requirements)


def _keywords(text: str) -> set[str]:
    return set(re.findall(r"[a-z][a-z0-9_+#.-]*", text.lower())) | set(capability_tags(text)) | {
        term for term in ("性能", "部署", "接口", "测试", "数据库", "并发", "流式", "检索") if term in text
    }


def _job_requirements(chunks: list, reviews: tuple[ClaimReview, ...]) -> tuple[JobRequirement, ...]:
    requirements = []
    seen = set()
    for source, chunk in chunks:
        if source.kind != "job_description":
            continue
        for raw in re.split(r"[\n。；！？]+", chunk.text):
            text = re.sub(r"^\s*(?:[-*+•]\s+|\d+[.)、]\s*)", "", raw).strip()
            if not text or text.startswith("#") or text in seen:
                continue
            seen.add(text)
            keywords = _keywords(text)
            matched = [item for item in reviews if keywords & _keywords(item.text)]
            accepted = [item for item in matched if item.review_status == "人工已接受"]
            covered = set().union(*(_keywords(item.text) for item in accepted if item.risk == "低"))
            if not keywords:
                status = "待人工分析"
            elif accepted:
                status = "有关联主张，证据充分（关键词）" if keywords <= covered else "有关联主张，证据待补"
            else:
                status = "仅有已拒绝主张" if matched else "未找到关联主张"
            requirements.append(JobRequirement(_safe_text(text), _safe_text(f"{source.label} · {chunk.locator}"), tuple(sorted(keywords)), tuple(item.claim_id for item in matched), status))
    return tuple(requirements)

def report_to_markdown(report: Report) -> str:
    lines = ["# 岗位匹配与证据审计报告", "", f"生成时间：{report.generated_at}", "", "人工接受不等于证据充分；未找到证据不代表能力主张虚假。报告不认证项目真实性或个人贡献。", "", "## 逐条审计结论"]
    for item in report.claim_reviews:
        lines += ["", f"### 主张 {item.claim_id}：{_safe_text(item.text)}", f"- 人工决定：{item.review_status}", f"- 证据支持度：{item.verdict}", f"- 风险：{item.risk}", f"- 简历定位：{_safe_text(item.resume_locator)}", f"- 判定理由：{_safe_text(item.rationale)}", f"- 确定性门禁：{_safe_text(item.gate_reason)}"]
        if item.warning:
            lines.append(f"- 提醒：{item.warning}")
        lines.append("- 可核验证据：")
        lines += [f"  - [E{e.chunk_id}] {'项目材料' if e.source_kind == 'project' else '用户补充说明（非独立证明）'} · {_safe_text(e.source_label)} · {_safe_text(e.relative_path)} · {_safe_text(e.locator)}\n    摘录：{_safe_text(e.excerpt).replace(chr(10), ' ')}" for e in item.evidence] or ["  - 暂无合规引用；请结合判定理由补充材料。"]
        lines += [f"- 建议：{suggestion}" for suggestion in item.suggestions]
    lines += ["", "## 岗位要求覆盖（规则初筛）", report.jd_coverage]
    for item in report.jd_requirements:
        lines += [f"- {_safe_text(item.text)}：{item.status}", f"  - 岗位定位：{_safe_text(item.locator)}；关联主张：{', '.join(map(str, item.claim_ids)) or '无'}；关键词：{', '.join(item.keywords) or '未识别'}"]
    lines += ["", "## 冲突材料", *([f"- {_safe_text(text)}" for text in report.conflicts] or ["- 暂无已记录冲突（不代表已证明不存在冲突）"]), "", "## 下一步建议"]
    lines += [f"- {_safe_text(item)}" for item in report.next_steps] or ["- 暂无"]
    return "\n".join(lines) + "\n"


def _safe_text(text: str) -> str:
    """隐藏不应随导出报告扩散的本机路径与常见密钥字面量。"""
    text = re.sub(r"[A-Za-z]:[\\/][^\s）)]+", "[本机路径已隐藏]", text)
    text = re.sub(r"\bsk-[A-Za-z0-9_-]{6,}\b", "[密钥已隐藏]", text)
    return re.sub(
        r"(?i)\b(api[_ -]?key|token|secret)\s*[:=]\s*\S+",
        r"\1=[敏感信息已隐藏]",
        text,
    )
