"""可复制文本 PDF 解析。"""

from io import BytesIO

from pypdf import PdfReader

from job_evidence_agent.models import EvidenceChunk
from job_evidence_agent.parsers.text import detect_language


class PdfExtractionError(ValueError):
    """PDF 不含可用文本时的受控错误。"""


def parse_pdf(content: bytes) -> list[EvidenceChunk]:
    reader = PdfReader(BytesIO(content))
    chunks: list[EvidenceChunk] = []
    for page_number, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        if text:
            chunks.append(
                EvidenceChunk(0, 0, text, f"第 {page_number} 页", detect_language(text))
            )
    if not chunks:
        raise PdfExtractionError("该 PDF 没有可提取的文本，请改用可复制文本 PDF 或粘贴内容")
    return chunks
