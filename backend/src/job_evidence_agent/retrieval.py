"""基于 SQLite FTS5 召回项目材料与补充说明，不使用简历/JD 自证。"""

from job_evidence_agent.database import SQLiteRepository
from job_evidence_agent.models import EvidenceChunk
from job_evidence_agent.taxonomy import CAPABILITY_TERMS, capability_tags


def rrf_fuse(rankings: list[list[EvidenceChunk]], limit: int, k: int = 60) -> list[EvidenceChunk]:
    """将多条 BM25 排名用 Reciprocal Rank Fusion 合并，保留首次出现顺序处理同分。"""
    scores: dict[int, float] = {}
    chunks: dict[int, EvidenceChunk] = {}
    first_seen: dict[int, int] = {}
    position = 0
    for ranking in rankings:
        for rank, chunk in enumerate(ranking, start=1):
            scores[chunk.id] = scores.get(chunk.id, 0) + 1 / (k + rank)
            chunks[chunk.id] = chunk
            if chunk.id not in first_seen:
                first_seen[chunk.id] = position
                position += 1
    ordered_ids = sorted(scores, key=lambda chunk_id: (-scores[chunk_id], first_seen[chunk_id]))
    return [chunks[chunk_id] for chunk_id in ordered_ids[:limit]]


def retrieve_evidence(repository: SQLiteRepository, task_id: int, query: str) -> list[EvidenceChunk]:
    variants = [query]
    for tag in capability_tags(query):
        variants.extend(CAPABILITY_TERMS[tag])
    unique_variants = list(dict.fromkeys(item for item in variants if item.strip()))
    rankings = [repository.search_chunks(task_id, item, limit=8) for item in unique_variants]
    return rrf_fuse(rankings, limit=8)
