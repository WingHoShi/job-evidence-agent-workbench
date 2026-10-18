"""仅从简历抽取用户已写出的能力主张。"""

import re

from job_evidence_agent.models import Claim, EvidenceChunk
from job_evidence_agent.taxonomy import capability_tags

CLAIM_MARKERS = ("熟悉", "掌握", "使用", "实现", "负责", "具备", "了解", "优化")
LIST_PREFIX = re.compile(r"^\s*(?:[-*+•]\s+|\d+[.)]\s+|\d+、\s*)")


def _claim_texts(text: str) -> list[str]:
    """按条目和中文句子拆分，保留同一条目内的换行续文。"""
    blocks: list[str] = []
    buffer: list[str] = []
    for line in text.splitlines():
        starts_claim = bool(line) and not line[0].isspace() and any(marker in line for marker in CLAIM_MARKERS)
        if not line.strip() or LIST_PREFIX.match(line) or starts_claim:
            if buffer:
                blocks.append(" ".join(buffer))
                buffer.clear()
        content = LIST_PREFIX.sub("", line, count=1).strip()
        if content:
            buffer.append(content)
    if buffer:
        blocks.append(" ".join(buffer))

    return [
        sentence.strip()
        for block in blocks
        for sentence in re.split(r"(?<=[。！？；])", block)
        if any(marker in sentence for marker in CLAIM_MARKERS)
    ]


def extract_resume_claims(
    resume_chunks: list[EvidenceChunk], project_chunks: list[EvidenceChunk]
) -> list[Claim]:
    del project_chunks
    claims: list[Claim] = []
    for chunk in resume_chunks:
        texts = _claim_texts(chunk.text)
        for index, text in enumerate(texts, start=1):
            claims.append(
                Claim(
                    id=0,
                    task_id=0,
                    text=text,
                    resume_locator=f"{chunk.locator} · 主张 {index}" if len(texts) > 1 else chunk.locator,
                    capability_tags=capability_tags(text),
                    status="pending_review",
                )
            )
    return claims
