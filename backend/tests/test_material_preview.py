import sqlite3
from contextlib import closing

import pytest
from fastapi.testclient import TestClient

from job_evidence_agent.app import create_app
from job_evidence_agent.database import SQLiteRepository


@pytest.fixture
def material(tmp_path):
    path = tmp_path / 'workbench.sqlite3'
    client = TestClient(create_app(database_path=path, config_path=tmp_path / 'missing.env'))
    task = client.post('/api/tasks', json={'name': '虚构预览任务'}).json()['id']
    repo = SQLiteRepository(path)
    source = repo.create_source(task_id=task, kind='project', label='app.py', relative_path='demo/app.py')
    for index in range(13):
        repo.create_chunk(source_id=source.id, text=f'原文片段 {index}\n<script>仅作为文本</script>', locator=f'line:{index}', language='python')
    return client, path, repo, task, source


def dump(path):
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as db:
        return '\n'.join(db.iterdump())


def test_preview_returns_stored_chunks_in_order_without_mutation(material):
    client, path, _, task, source = material
    before = dump(path)
    response = client.get(f'/api/tasks/{task}/sources/{source.id}/chunks')
    assert response.status_code == 200
    body = response.json()
    assert body['task_id'] == task and body['source']['id'] == source.id
    assert body['total'] == 13 and body['offset'] == 0 and body['limit'] == 10
    assert len(body['chunks']) == 10
    assert body['chunks'][0]['text'] == '原文片段 0\n<script>仅作为文本</script>'
    assert body['chunks'][0]['locator'] == 'line:0'
    assert dump(path) == before


def test_preview_pages_without_overlap_and_handles_out_of_range(material):
    client, _, _, task, source = material
    endpoint = f'/api/tasks/{task}/sources/{source.id}/chunks'
    page = client.get(endpoint, params={'offset': 10, 'limit': 10}).json()
    assert page['total'] == 13 and len(page['chunks']) == 3
    assert page['chunks'][0]['text'].startswith('原文片段 10\n')
    assert client.get(endpoint, params={'offset': 100}).json()['chunks'] == []


def test_preview_never_reads_another_tasks_source(material):
    client, path, _, task, source = material
    other = client.post('/api/tasks', json={'name': '另一虚构任务'}).json()['id']
    before = dump(path)
    for owner, source_id in [(other, source.id), (9999, source.id), (task, 9999)]:
        response = client.get(f'/api/tasks/{owner}/sources/{source_id}/chunks')
        assert response.status_code == 404
        assert '原文片段' not in response.text
    assert dump(path) == before


@pytest.mark.parametrize('query', [{'offset': -1}, {'limit': 0}, {'limit': 51}, {'offset': 'invalid'}])
def test_preview_rejects_invalid_page_parameters(material, query):
    client, _, _, task, source = material
    assert client.get(f'/api/tasks/{task}/sources/{source.id}/chunks', params=query).status_code == 422


def test_preview_empty_source_is_not_fabricated_content(material):
    client, _, repo, task, _ = material
    empty = repo.create_source(task_id=task, kind='supplement', label='空材料', relative_path='empty.txt')
    body = client.get(f'/api/tasks/{task}/sources/{empty.id}/chunks').json()
    assert body['total'] == 0 and body['chunks'] == []
