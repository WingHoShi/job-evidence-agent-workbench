from pathlib import Path

from job_evidence_agent.database import SQLiteRepository
from job_evidence_agent.models import Claim


def test_task_sources_and_chunks_survive_repository_restart(tmp_path: Path) -> None:
    database_path = tmp_path / "data" / "workbench.sqlite3"
    repository = SQLiteRepository(database_path)

    task = repository.create_task("后端开发工程师")
    source = repository.create_source(
        task_id=task.id,
        kind="resume",
        label="我的简历.md",
        relative_path="resume.md",
    )
    chunk = repository.create_chunk(
        source_id=source.id,
        text="熟悉 FastAPI 与 Docker Compose 部署。",
        locator="第 1 段",
        language="zh",
    )
    repository.update_task_status(task.id, "ready")

    restarted_repository = SQLiteRepository(database_path)
    restored_task = restarted_repository.get_task(task.id)
    restored_sources = restarted_repository.list_sources(task.id)
    restored_chunks = restarted_repository.list_chunks(source.id)

    assert restored_task is not None
    assert restored_task.name == "后端开发工程师"
    assert restored_task.status == "ready"
    assert [(item.label, item.relative_path) for item in restored_sources] == [
        ("我的简历.md", "resume.md")
    ]
    assert [(item.text, item.locator, item.language) for item in restored_chunks] == [
        ("熟悉 FastAPI 与 Docker Compose 部署。", "第 1 段", "zh")
    ]
    assert chunk.id > 0


def test_claim_review_status_survives_repository_restart(tmp_path: Path) -> None:
    database_path = tmp_path / "workbench.sqlite3"
    repository = SQLiteRepository(database_path)
    task = repository.create_task("AI 应用开发")
    claim = repository.create_claim(
        Claim(0, task.id, "熟悉 FastAPI", "第 1 段", ("fastapi",), "pending_review")
    )
    repository.update_claim_status(claim.id, "confirmed")

    restored = SQLiteRepository(database_path).list_claims(task.id)

    assert [(item.text, item.capability_tags, item.status) for item in restored] == [
        ("熟悉 FastAPI", ("fastapi",), "confirmed")
    ]
