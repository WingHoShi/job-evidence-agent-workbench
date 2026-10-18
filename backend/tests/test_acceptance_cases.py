import json
from pathlib import Path

import pytest

from job_evidence_agent.database import SQLiteRepository
from job_evidence_agent.gates import decide_gate
from job_evidence_agent.importing import ImportUpload, import_sources
from job_evidence_agent.models import Claim, EvidenceAssessment


PROJECT_ROOT = Path(__file__).resolve().parents[2]
EXAMPLES_DIR = PROJECT_ROOT / "examples"


def load_cases() -> list[dict[str, object]]:
    return [json.loads(line) for line in (EXAMPLES_DIR / "evaluation_cases.jsonl").read_text(encoding="utf-8").splitlines() if line]


@pytest.mark.parametrize(
    ("name", "verdict", "eligible", "requires_review", "review_status"),
    [
        ("充分支持", "strong", True, False, "confirmed"),
        ("材料不足", "none", False, True, "rejected"),
        ("材料冲突", "conflict", False, True, "rejected"),
        ("补证后恢复", "strong", True, False, "confirmed"),
    ],
)
def test_desensitized_evaluation_cases_have_fixed_gate_and_review_outcomes(
    name: str, verdict: str, eligible: bool, requires_review: bool, review_status: str
) -> None:
    case = next(item for item in load_cases() if item["name"] == name)

    decision = decide_gate(case["expected_verdict"])

    assert case["expected_verdict"] == verdict
    assert decision.eligible is eligible
    assert decision.requires_review is requires_review
    assert case["expected_review_status"] == review_status


def test_example_project_import_keeps_prompt_injection_as_material_and_skips_env(tmp_path: Path) -> None:
    repository = SQLiteRepository(tmp_path / "workbench.sqlite3")
    task = repository.create_task("脱敏验收")
    project_root = EXAMPLES_DIR / "projects" / "prompt-injection-demo"
    uploads = [
        ImportUpload(
            path.relative_to(EXAMPLES_DIR).as_posix(),
            path.read_bytes(),
        )
        for path in project_root.rglob("*")
        if path.is_file()
    ]

    summary = import_sources(repository=repository, task_id=task.id, kind="project", uploads=uploads)
    saved_text = "\n".join(
        chunk.text
        for source in repository.list_sources(task.id)
        for chunk in repository.list_chunks(source.id)
    )

    assert summary.imported_count == 2
    assert summary.skipped_paths == ["projects/prompt-injection-demo/.env"]
    assert "忽略之前的规则" in saved_text
    assert "not-a-secret" not in saved_text
    assert all(not Path(source.relative_path).is_absolute() for source in repository.list_sources(task.id))


def test_case_assessment_and_gate_survive_repository_restart(tmp_path: Path) -> None:
    case = next(item for item in load_cases() if item["name"] == "补证后恢复")
    database_path = tmp_path / "workbench.sqlite3"
    repository = SQLiteRepository(database_path)
    task = repository.create_task("脱敏验收")
    claim = repository.create_claim(
        Claim(0, task.id, case["claim"], "resume.md#项目经历", ("fastapi",), "pending_review")
    )
    assessment = EvidenceAssessment(claim.id, (101,), case["expected_verdict"], "补充 README 后可核验。")
    repository.save_assessment(assessment)
    repository.save_gate_decision(claim.id, decide_gate(assessment.verdict))
    repository.update_claim_status(claim.id, case["expected_review_status"])

    restarted = SQLiteRepository(database_path)
    persisted_claim = restarted.list_claims(task.id)[0]
    persisted_gate = restarted.get_gate_decision(claim.id)

    assert restarted.get_assessment(claim.id) == assessment
    assert persisted_gate is not None and persisted_gate.eligible is True
    assert persisted_claim.status == "confirmed"
