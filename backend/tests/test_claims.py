from pathlib import Path

import pytest

from job_evidence_agent.claims import extract_resume_claims
from job_evidence_agent.models import EvidenceChunk
from job_evidence_agent.parsers.markdown import parse_markdown


def test_claim_extraction_uses_resume_only_and_attaches_capability_tags() -> None:
    claims = extract_resume_claims(
        [EvidenceChunk(1, 1, "熟悉 FastAPI 与 Docker Compose 部署。", "第 1 段", "zh")],
        [EvidenceChunk(2, 2, "项目使用 React。", "README", "zh")],
    )

    assert [(claim.text, claim.capability_tags) for claim in claims] == [
        ("熟悉 FastAPI 与 Docker Compose 部署。", ("fastapi", "docker"))
    ]


def test_example_resume_extracts_three_separate_claims_with_section_locators() -> None:
    resume_path = Path(__file__).resolve().parents[2] / "examples" / "resume.md"
    claims = extract_resume_claims(parse_markdown(resume_path.read_text(encoding="utf-8")), [])

    assert [claim.text for claim in claims] == [
        "使用 FastAPI 提供健康检查接口，并通过 Docker Compose 编排本地服务。",
        "了解 Kubernetes 基础概念。",
        "将服务响应时间从 5 秒优化至 1 秒。",
    ]
    assert len({claim.resume_locator for claim in claims}) == 3
    assert all("AI 应用开发项目" in claim.resume_locator for claim in claims)
    assert claims[0].capability_tags == ("fastapi", "docker")
    assert all(claim.status == "pending_review" for claim in claims)


@pytest.mark.parametrize("text", [
    "1. 熟悉 FastAPI。\n2. 了解 Kubernetes。\n3. 优化服务响应时间。",
    "1、熟悉 FastAPI。\n2、了解 Kubernetes。\n3、优化服务响应时间。",
    "熟悉 FastAPI。了解 Kubernetes。优化服务响应时间。",
])
def test_numbered_lists_and_plain_sentences_are_individually_auditable(text: str) -> None:
    claims = extract_resume_claims([EvidenceChunk(1, 1, text, "全文", "zh")], [])

    assert [claim.text for claim in claims] == [
        "熟悉 FastAPI。", "了解 Kubernetes。", "优化服务响应时间。",
    ]


def test_wrapped_bullet_stays_together_without_creating_project_only_claims() -> None:
    claims = extract_resume_claims(
        [EvidenceChunk(1, 1, "- 使用 FastAPI 提供接口，并通过\n  Docker Compose 编排本地服务。\n- 了解 Kubernetes。", "项目经历", "zh")],
        [EvidenceChunk(2, 2, "负责 React 前端开发。", "README", "zh")],
    )

    assert [claim.text for claim in claims] == [
        "使用 FastAPI 提供接口，并通过 Docker Compose 编排本地服务。", "了解 Kubernetes。",
    ]
    assert claims[0].capability_tags == ("fastapi", "docker")


def test_plain_lines_without_sentence_punctuation_are_separate_claims() -> None:
    claims = extract_resume_claims(
        [EvidenceChunk(1, 1, "熟悉 FastAPI\n了解 Kubernetes\n优化服务响应时间", "全文", "zh")], [],
    )

    assert [claim.text for claim in claims] == ["熟悉 FastAPI", "了解 Kubernetes", "优化服务响应时间"]
