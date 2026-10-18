from fastapi import APIRouter, HTTPException
from dataclasses import asdict
from fastapi.responses import Response
from job_evidence_agent.database import SQLiteRepository
from job_evidence_agent.reporting import ReportNotReadyError, build_report, report_to_markdown

def create_reports_router(repository: SQLiteRepository) -> APIRouter:
    router = APIRouter(prefix="/api/tasks", tags=["reports"])
    def make_report(task_id: int):
        if repository.get_task(task_id) is None:
            raise HTTPException(404, "任务不存在")
        try:
            report = build_report(repository, task_id)
            repository.mark_report_generated(task_id)
            return report
        except ReportNotReadyError as error: raise HTTPException(409, str(error))
    @router.get("/{task_id}/report")
    def report(task_id: int):
        item = make_report(task_id)
        return asdict(item)
    @router.get("/{task_id}/report.md")
    def markdown(task_id: int):
        return Response(report_to_markdown(make_report(task_id)), media_type="text/markdown; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="report-{task_id}.md"'})
    return router
