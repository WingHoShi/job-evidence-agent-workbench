"""受限材料导入：先过滤，再解析，最后保存快照。"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import PurePosixPath

from job_evidence_agent.database import SQLiteRepository
from job_evidence_agent.parsers.docx import parse_docx
from job_evidence_agent.parsers.markdown import parse_markdown
from job_evidence_agent.parsers.pdf import PdfExtractionError, parse_pdf
from job_evidence_agent.parsers.text import parse_text

MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_FILES_PER_IMPORT = 200
MAX_TEXT_BYTES_PER_IMPORT = 10 * 1024 * 1024

ALLOWED_SUFFIXES = {
    ".cfg", ".docx", ".ini", ".js", ".json", ".jsx", ".md", ".pdf", ".py", ".toml", ".ts", ".tsx", ".txt", ".yaml", ".yml"
}
BLOCKED_PATH_PARTS = {".git", ".venv", "__pycache__", "node_modules", "venv"}
BLOCKED_SUFFIXES = {".bin", ".dll", ".exe", ".gif", ".ico", ".jpeg", ".jpg", ".png", ".pyc", ".so", ".webp"}


@dataclass(frozen=True)
class ImportUpload:
    relative_path: str
    content: bytes


@dataclass(frozen=True)
class ImportSummary:
    imported_count: int
    skipped_paths: list[str]
    errors: list[str] = field(default_factory=list)


def allowed_file(relative_path: str, size_bytes: int) -> bool:
    normalized_path = normalize_relative_path(relative_path)
    if normalized_path is None or size_bytes < 0 or size_bytes > MAX_FILE_BYTES:
        return False
    path = PurePosixPath(normalized_path)
    lower_name = path.name.lower()
    if lower_name == ".env" or lower_name.startswith(".env."):
        return False
    if any(part.lower() in BLOCKED_PATH_PARTS for part in path.parts):
        return False
    if path.suffix.lower() in BLOCKED_SUFFIXES:
        return False
    return path.name == "Dockerfile" or path.suffix.lower() in ALLOWED_SUFFIXES


def import_sources(
    *, repository: SQLiteRepository, task_id: int, kind: str, uploads: list[ImportUpload]
) -> ImportSummary:
    imported_count = 0
    total_text_bytes = 0
    skipped_paths: list[str] = []
    errors: list[str] = []

    for upload in uploads[:MAX_FILES_PER_IMPORT]:
        normalized_path = normalize_relative_path(upload.relative_path)
        if normalized_path is None or not allowed_file(upload.relative_path, len(upload.content)):
            skipped_paths.append(upload.relative_path)
            continue
        suffix = PurePosixPath(normalized_path).suffix.lower()
        if suffix not in {".docx", ".pdf"} and b"\x00" in upload.content:
            skipped_paths.append(upload.relative_path)
            continue
        try:
            chunks = parse_content(normalized_path, upload.content)
        except (PdfExtractionError, UnicodeDecodeError, ValueError) as error:
            skipped_paths.append(upload.relative_path)
            errors.append(f"{upload.relative_path}: {error}")
            continue
        if not chunks:
            skipped_paths.append(upload.relative_path)
            continue
        text_size = sum(len(chunk.text.encode("utf-8")) for chunk in chunks)
        if total_text_bytes + text_size > MAX_TEXT_BYTES_PER_IMPORT:
            skipped_paths.append(upload.relative_path)
            continue
        source = repository.create_source(
            task_id=task_id,
            kind=kind,
            label=PurePosixPath(normalized_path).name,
            relative_path=normalized_path,
        )
        for chunk in chunks:
            repository.create_chunk(
                source_id=source.id,
                text=chunk.text,
                locator=chunk.locator,
                language=chunk.language,
            )
        total_text_bytes += text_size
        imported_count += 1

    if len(uploads) > MAX_FILES_PER_IMPORT:
        skipped_paths.extend(upload.relative_path for upload in uploads[MAX_FILES_PER_IMPORT:])
    return ImportSummary(imported_count, skipped_paths, errors)


def normalize_relative_path(relative_path: str) -> str | None:
    candidate = relative_path.replace("\\", "/").strip("/")
    if not candidate or candidate.startswith("/") or ":" in candidate:
        return None
    path = PurePosixPath(candidate)
    if any(part in {"", ".", ".."} for part in path.parts):
        return None
    return path.as_posix()


def parse_content(relative_path: str, content: bytes):
    suffix = PurePosixPath(relative_path).suffix.lower()
    if suffix == ".docx":
        return parse_docx(content)
    if suffix == ".pdf":
        return parse_pdf(content)
    text = content.decode("utf-8")
    return parse_markdown(text) if suffix == ".md" else parse_text(text)
