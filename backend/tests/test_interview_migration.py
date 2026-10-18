import sqlite3

import pytest

from job_evidence_agent.database import SQLiteRepository
from job_evidence_agent.interview_store import InterviewStore
from job_evidence_agent.migrate_interviews import migrate


def test_migration_backup_preserves_old_records_and_can_restore(tmp_path):
    path = tmp_path / "test.sqlite3"
    repository = SQLiteRepository(path)
    task = repository.create_task("旧任务")
    old = repository.create_interview(task_id=task.id, mode="default", question_count=5, focus_areas=(), duration_minutes=None)
    repository.create_interview_turn(session_id=old.id, question="旧题", evidence_ids=())
    backup = migrate(path, tmp_path / "backups")
    assert InterviewStore(repository).is_initialized()
    assert repository.list_interview_turns(old.id)[0].question == "旧题"
    restored = tmp_path / "restored.sqlite3"
    with sqlite3.connect(backup) as source, sqlite3.connect(restored) as target:
        source.backup(target)
    original = SQLiteRepository(restored)
    assert original.get_task(task.id).name == "旧任务"
    assert not InterviewStore(original).is_initialized()
    second = migrate(path, tmp_path / "backups")
    assert second != backup and backup.is_file()


def test_backup_failure_prevents_schema_changes(tmp_path):
    path = tmp_path / "test.sqlite3"
    repository = SQLiteRepository(path)
    blocker = tmp_path / "not-a-directory"
    blocker.write_text("测试文件", encoding="utf-8")
    with pytest.raises(OSError):
        migrate(path, blocker)
    assert not InterviewStore(repository).is_initialized()


def test_missing_database_is_not_created(tmp_path):
    path = tmp_path / "missing.sqlite3"
    with pytest.raises(ValueError, match="不存在"):
        migrate(path, tmp_path / "backups")
    assert not path.exists()
