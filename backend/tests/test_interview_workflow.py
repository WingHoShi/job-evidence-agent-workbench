import pytest

from job_evidence_agent.database import SQLiteRepository
from job_evidence_agent.interview_contracts import InterviewOptions
from job_evidence_agent.interview_store import InterviewStore
from job_evidence_agent.workflows.interview import InterviewNotReadyError, ModelInterviewWorkflow
from interview_helpers import InterviewModel, configured_store


def test_workflow_requires_generated_report_before_starting(tmp_path):
    repository = SQLiteRepository(tmp_path / "test.db")
    task = repository.create_task("测试")
    store = InterviewStore(repository)
    store.initialize()
    workflow = ModelInterviewWorkflow(repository, store, configured_store(tmp_path), InterviewModel())
    with pytest.raises(InterviewNotReadyError, match="报告"):
        workflow.start(task.id, "start-key", InterviewOptions())


def test_workflow_requires_accepted_claims(tmp_path):
    repository = SQLiteRepository(tmp_path / "test.db")
    task = repository.create_task("测试")
    from job_evidence_agent.models import Claim
    repository.create_claim(Claim(0, task.id, "FastAPI", "简历", (), "rejected"))
    repository.mark_report_generated(task.id)
    store = InterviewStore(repository)
    store.initialize()
    workflow = ModelInterviewWorkflow(repository, store, configured_store(tmp_path), InterviewModel())
    with pytest.raises(InterviewNotReadyError, match="接受"):
        workflow.start(task.id, "start-key", InterviewOptions())
