"""Markdown 标题分段解析。"""

from job_evidence_agent.models import EvidenceChunk
from job_evidence_agent.parsers.text import detect_language


def parse_markdown(text: str) -> list[EvidenceChunk]:
    chunks: list[EvidenceChunk] = []
    heading = "文档开头"
    buffer: list[str] = []

    def flush() -> None:
        content = "\n".join(buffer).strip()
        if content:
            chunks.append(EvidenceChunk(0, 0, content, heading, detect_language(content)))

    for line in text.splitlines():
        if line.startswith("#") and line.lstrip("#").startswith(" "):
            flush()
            buffer.clear()
            heading = line.lstrip("#").strip()
        else:
            buffer.append(line)
    flush()
    return chunks
