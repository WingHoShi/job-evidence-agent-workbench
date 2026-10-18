from pathlib import Path

from docx import Document

from job_evidence_agent.database import SQLiteRepository
from job_evidence_agent.importing import ImportUpload, allowed_file, import_sources


def test_allowed_file_rejects_sensitive_binary_and_oversized_paths() -> None:
    assert allowed_file("src/app.py", 100)
    assert allowed_file("web/package.json", 100)
    assert allowed_file("Dockerfile", 100)
    assert not allowed_file(".env", 100)
    assert not allowed_file(".git/config", 100)
    assert not allowed_file("node_modules/react/index.js", 100)
    assert not allowed_file("assets/logo.png", 100)
    assert not allowed_file("C:/Users/Syh/secret.md", 100)
    assert not allowed_file("large.md", 2 * 1024 * 1024 + 1)


def test_import_excludes_unsafe_content_and_never_persists_absolute_paths(tmp_path: Path) -> None:
    repository = SQLiteRepository(tmp_path / "workbench.sqlite3")
    task = repository.create_task("AI 应用开发")

    summary = import_sources(
        repository=repository,
        task_id=task.id,
        kind="project",
        uploads=[
            ImportUpload("README.md", "# 项目说明\n使用 FastAPI。".encode()),
            ImportUpload("src/service.py", b"def run():\n    return 'ok'\n"),
            ImportUpload(".env", b"MODEL_API_KEY=sk-secret"),
            ImportUpload(".git/config", b"[remote]\nurl = private"),
            ImportUpload("node_modules/lib/index.js", b"module.exports = 1"),
            ImportUpload("assets/logo.png", b"\x89PNG\r\n\x1a\n"),
        ],
    )

    sources = repository.list_sources(task.id)
    saved_paths = [source.relative_path for source in sources]
    saved_text = "\n".join(
        chunk.text for source in sources for chunk in repository.list_chunks(source.id)
    )

    assert summary.imported_count == 2
    assert summary.skipped_paths == [
        ".env",
        ".git/config",
        "node_modules/lib/index.js",
        "assets/logo.png",
    ]
    assert saved_paths == ["README.md", "src/service.py"]
    assert "sk-secret" not in saved_text
    assert all(not Path(path).is_absolute() for path in saved_paths)


def test_import_accepts_docx_as_a_supported_document_format(tmp_path: Path) -> None:
    document = Document()
    document.add_paragraph("使用 FastAPI 完成服务开发。")
    output = tmp_path / "resume.docx"
    document.save(output)
    repository = SQLiteRepository(tmp_path / "workbench.sqlite3")
    task = repository.create_task("AI 应用开发")

    summary = import_sources(
        repository=repository,
        task_id=task.id,
        kind="resume",
        uploads=[ImportUpload("resume.docx", output.read_bytes())],
    )

    assert summary.imported_count == 1
    source = repository.list_sources(task.id)[0]
    assert repository.list_chunks(source.id)[0].text == "使用 FastAPI 完成服务开发。"
