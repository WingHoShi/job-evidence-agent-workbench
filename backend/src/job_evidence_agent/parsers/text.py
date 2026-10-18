"""纯文本解析。"""

from job_evidence_agent.models import EvidenceChunk


def parse_text(text: str) -> list[EvidenceChunk]:
    cleaned_text = text.strip()
    if not cleaned_text:
        return []
    return [EvidenceChunk(0, 0, cleaned_text, "全文", detect_language(cleaned_text))]


def detect_language(text: str) -> str:
    return "zh" if any("\u4e00" <= character <= "\u9fff" for character in text) else "en"
