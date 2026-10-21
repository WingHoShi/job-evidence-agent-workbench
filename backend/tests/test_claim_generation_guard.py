import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from dataclasses import replace
from threading import Barrier

import pytest
from fastapi.testclient import TestClient

from job_evidence_agent.app import create_app
from job_evidence_agent.database import SQLiteRepository
from job_evidence_agent.models import Claim


@pytest.fixture
def task(tmp_path):
    database = tmp_path / 'workbench.sqlite3'
    client = TestClient(create_app(database_path=database, config_path=tmp_path / 'missing.env'))
    task_id = client.post('/api/tasks', json={'name': '虚构防重复任务'}).json()['id']
    return client, SQLiteRepository(database), database, task_id


def import_resume(client, task_id, text='熟悉 Python。\n使用 FastAPI 提供服务。'):
    response = client.post(f'/api/tasks/{task_id}/sources/text', json={'kind': 'resume', 'label': '虚构简历', 'text': text})
    assert response.status_code == 201


def dump(path):
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as db:
        return '\n'.join(db.iterdump())


def test_repeated_generation_returns_same_ids_without_new_rows(task):
    client, repo, database, task_id = task
    import_resume(client, task_id)
    first = client.post(f'/api/tasks/{task_id}/claims/generate')
    assert first.status_code == 200 and len(first.json()) == 2
    before = dump(database)
    second = client.post(f'/api/tasks/{task_id}/claims/generate')
    assert second.status_code == 200 and second.json() == first.json()
    assert len(repo.list_claims(task_id)) == 2 and dump(database) == before


def test_repeated_generation_preserves_review_report_and_interview(task):
    client, repo, database, task_id = task
    import_resume(client, task_id)
    first = client.post(f'/api/tasks/{task_id}/claims/generate').json()
    repo.update_claim_status(first[0]['id'], 'confirmed')
    repo.mark_report_generated(task_id)
    interview = repo.create_interview(task_id=task_id, mode='default', question_count=5, focus_areas=(), duration_minutes=None)
    turn = repo.create_interview_turn(session_id=interview.id, question='虚构旧题', evidence_ids=())
    repo.answer_interview_turn(turn.id, '已保存的虚构回答')
    # New material must not silently rebuild the previously reviewed task.
    import_resume(client, task_id, '掌握 Docker。')
    before = dump(database)
    result = client.post(f'/api/tasks/{task_id}/claims/generate').json()
    assert [row['id'] for row in result] == [row['id'] for row in first]
    assert result[0]['status'] == 'confirmed' and dump(database) == before


def test_parallel_requests_commit_only_one_batch(task, monkeypatch):
    client, repo, _, task_id = task
    import_resume(client, task_id)
    from job_evidence_agent.routes import tasks
    extract = tasks.extract_resume_claims
    barrier = Barrier(2)
    def simultaneous(*args):
        barrier.wait(timeout=10)
        return extract(*args)
    monkeypatch.setattr(tasks, 'extract_resume_claims', simultaneous)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: client.post(f'/api/tasks/{task_id}/claims/generate'), range(2)))
    assert all(response.status_code == 200 for response in responses)
    assert responses[0].json() == responses[1].json()
    assert len(repo.list_claims(task_id)) == 2


@pytest.mark.parametrize('kind,text,message', [('project', '使用 Python。', '导入简历'), ('resume', '姓名：虚构学生', '未找到可提取')])
def test_missing_or_empty_resume_has_clear_error_and_no_claims(task, kind, text, message):
    client, repo, database, task_id = task
    client.post(f'/api/tasks/{task_id}/sources/text', json={'kind': kind, 'label': '虚构材料', 'text': text})
    before = dump(database)
    response = client.post(f'/api/tasks/{task_id}/claims/generate')
    assert response.status_code == 422 and message in response.json()['detail']
    assert repo.list_claims(task_id) == [] and dump(database) == before


def test_atomic_batch_rolls_back_on_midway_failure(task):
    _, repo, database, task_id = task
    claim = Claim(0, task_id, '使用 Python。', 'line:1', ('python',), 'pending_review')
    before = dump(database)
    with pytest.raises(TypeError):
        repo.create_claims_once(task_id, [claim, replace(claim, capability_tags=(object(),))])
    assert repo.list_claims(task_id) == [] and dump(database) == before
    saved = repo.create_claims_once(task_id, [claim])
    assert len(saved) == 1 and saved[0].text == claim.text


def test_empty_attempt_does_not_prevent_first_success_after_adding_resume(task):
    client, repo, _, task_id = task
    assert client.post(f'/api/tasks/{task_id}/claims/generate').status_code == 422
    import_resume(client, task_id)
    response = client.post(f'/api/tasks/{task_id}/claims/generate')
    assert response.status_code == 200 and len(response.json()) == 2
    assert len(repo.list_claims(task_id)) == 2


def test_generation_is_scoped_to_task_and_does_not_clean_old_duplicates(task):
    client, repo, database, task_id = task
    claim = Claim(0, task_id, '历史重复项', 'line:1', (), 'confirmed')
    old = [repo.create_claim(claim), repo.create_claim(claim)]
    before = dump(database)
    result = client.post(f'/api/tasks/{task_id}/claims/generate').json()
    assert [row['id'] for row in result] == [row.id for row in old] and dump(database) == before
    other = client.post('/api/tasks', json={'name': '另一虚构任务'}).json()['id']
    import_resume(client, other)
    response = client.post(f'/api/tasks/{other}/claims/generate')
    assert response.status_code == 200 and len(response.json()) == 2
    assert set(row['id'] for row in response.json()).isdisjoint(row.id for row in old)
