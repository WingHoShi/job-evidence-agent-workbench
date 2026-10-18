"""DOCX 段落解析。"""

from io import BytesIO

from docx import Document

from job_evidence_agent.models import EvidenceChunk
from job_evidence_agent.parsers.text import detect_language


def parse_docx(content: bytes) -> list[EvidenceChunk]:
    document = Document(BytesIO(content))
    chunks: list[EvidenceChunk] = []
    for paragraph_number, paragraph in enumerate(document.paragraphs, start=1):
        text = paragraph.text.strip()
        if text:
            chunks.append(
                EvidenceChunk(0, 0, text, f"第 {paragraph_number} 段", detect_language(text))
            )
    return chunks
