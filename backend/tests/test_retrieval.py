from pathlib import Path

from job_evidence_agent.database import SQLiteRepository
from job_evidence_agent.models import EvidenceChunk
from job_evidence_agent.retrieval import rrf_fuse, retrieve_evidence


def test_retrieval_returns_related_project_chunks_not_unrelated_content(tmp_path: Path) -> None:
    repository = SQLiteRepository(tmp_path / "workbench.sqlite3")
    task = repository.create_task("AI 开发")
    related = repository.create_source(task_id=task.id, kind="project", label="README", relative_path="README.md")
    unrelated = repository.create_source(task_id=task.id, kind="project", label="notes", relative_path="notes.md")
    repository.create_chunk(source_id=related.id, text="FastAPI 服务使用 Docker Compose 部署。", locator="部署", language="zh")
    repository.create_chunk(source_id=unrelated.id, text="校园活动安排。", locator="全文", language="zh")

    results = retrieve_evidence(repository, task.id, "FastAPI Docker 部署")

    assert [result.text for result in results] == ["FastAPI 服务使用 Docker Compose 部署。"]


def test_rrf_fuse_prioritizes_evidence_returned_by_multiple_bm25_queries() -> None:
    shared = EvidenceChunk(1, 1, "FastAPI 服务通过 Docker Compose 部署。", "README", "zh")
    fastapi_only = EvidenceChunk(2, 1, "FastAPI 健康检查接口。", "app.py", "zh")
    docker_only = EvidenceChunk(3, 1, "Docker Compose 编排服务。", "compose.yaml", "zh")

    results = rrf_fuse([[fastapi_only, shared], [docker_only, shared]], limit=3)

    assert [item.id for item in results] == [1, 2, 3]


def test_context_sources_cannot_crowd_out_project_evidence(tmp_path: Path) -> None:
    repository = SQLiteRepository(tmp_path / "workbench.sqlite3")
    task = repository.create_task("证据来源隔离")
    for index in range(12):
        source = repository.create_source(task_id=task.id, kind="resume" if index % 2 else "job_description", label="context", relative_path=f"{index}.txt")
        repository.create_chunk(source_id=source.id, text="Kubernetes", locator="全文", language="en")
    project = repository.create_source(task_id=task.id, kind="project", label="deployment", relative_path="deployment.yaml")
    chunk = repository.create_chunk(source_id=project.id, text="Kubernetes Deployment manifest", locator="全文", language="en")
    other_task = repository.create_task("其他任务")
    other = repository.create_source(task_id=other_task.id, kind="project", label="other", relative_path="other.txt")
    repository.create_chunk(source_id=other.id, text="Kubernetes", locator="全文", language="en")

    assert [item.id for item in retrieve_evidence(repository, task.id, "Kubernetes")] == [chunk.id]
