import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from job_evidence_agent.routes.setup import ModelClient, create_setup_router
from job_evidence_agent.routes.tasks import create_tasks_router
from job_evidence_agent.routes.audit import create_audit_router
from job_evidence_agent.routes.reports import create_reports_router
from job_evidence_agent.routes.interviews import create_interviews_router
from job_evidence_agent.workflows.audit import AuditWorkflow
from job_evidence_agent.database import SQLiteRepository
from job_evidence_agent.settings import ModelConfigStore
from job_evidence_agent.model_client import OpenAICompatibleClient


def create_app(
    frontend_dist_dir: Path | None = None,
    config_path: Path | None = None,
    model_client: ModelClient | None = None,
    database_path: Path | None = None,
) -> FastAPI:
    """创建本地工作台的 HTTP 应用。"""
    app = FastAPI(title="求职证据审计与模拟面试工作台", version="0.1.0")
    config_store = ModelConfigStore(config_path)
    runtime_model_client = model_client or OpenAICompatibleClient()
    app.include_router(
        create_setup_router(
            config_store=config_store, model_client=runtime_model_client
        )
    )
    repository = SQLiteRepository(database_path or Path("data/workbench.sqlite3"))
    audit_workflow = AuditWorkflow(repository.database_path.with_name("workflow.db"))
    app.include_router(
        create_tasks_router(repository, audit_workflow, config_store, runtime_model_client)
    )
    app.include_router(create_audit_router(repository, audit_workflow))
    app.include_router(create_reports_router(repository))
    app.include_router(create_interviews_router(repository, config_store, runtime_model_client))

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    resolved_frontend_dist_dir = frontend_dist_dir or Path(
        os.environ.get("JOB_EVIDENCE_FRONTEND_DIST_DIR", "frontend/dist")
    )

    if (resolved_frontend_dist_dir / "index.html").is_file():
        app.mount(
            "/",
            StaticFiles(directory=str(resolved_frontend_dist_dir), html=True),
            name="frontend",
        )

    return app


app = create_app()
