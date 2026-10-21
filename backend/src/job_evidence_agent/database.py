"""SQLite 业务仓储与 FTS5 文本索引。"""

from __future__ import annotations

import sqlite3
import json
from pathlib import Path

from job_evidence_agent.models import (
    Claim,
    EvidenceAssessment,
    EvidenceChunk,
    GateDecision,
    InterviewSession,
    InterviewTurn,
    Source,
    Task,
)


class SQLiteRepository:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def create_task(self, name: str) -> Task:
        if not name.strip():
            raise ValueError("任务名称不能为空")
        with self._connect() as connection:
            cursor = connection.execute(
                "INSERT INTO tasks (name, status) VALUES (?, ?)", (name.strip(), "draft")
            )
            return Task(cursor.lastrowid, name.strip(), "draft")

    def list_tasks(self) -> list[Task]:
        with self._connect() as connection:
            rows = connection.execute("SELECT id, name, status FROM tasks ORDER BY id DESC").fetchall()
        return [Task(*row) for row in rows]

    def get_task(self, task_id: int) -> Task | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT id, name, status FROM tasks WHERE id = ?", (task_id,)
            ).fetchone()
        return Task(*row) if row else None

    def update_task_status(self, task_id: int, status: str) -> None:
        with self._connect() as connection:
            connection.execute("UPDATE tasks SET status = ? WHERE id = ?", (status, task_id))

    def create_source(
        self, *, task_id: int, kind: str, label: str, relative_path: str
    ) -> Source:
        with self._connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO sources (task_id, kind, label, relative_path)
                VALUES (?, ?, ?, ?)
                """,
                (task_id, kind, label, relative_path),
            )
            return Source(cursor.lastrowid, task_id, kind, label, relative_path)

    def list_sources(self, task_id: int) -> list[Source]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, task_id, kind, label, relative_path
                FROM sources WHERE task_id = ? ORDER BY id
                """,
                (task_id,),
            ).fetchall()
        return [Source(*row) for row in rows]

    def update_source_label(self, source_id: int, label: str) -> None:
        with self._connect() as connection:
            connection.execute(
                "UPDATE sources SET label = ? WHERE id = ?", (label, source_id)
            )

    def create_chunk(
        self, *, source_id: int, text: str, locator: str, language: str
    ) -> EvidenceChunk:
        with self._connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO evidence_chunks (source_id, text, locator, language)
                VALUES (?, ?, ?, ?)
                """,
                (source_id, text, locator, language),
            )
            chunk_id = cursor.lastrowid
            connection.execute(
                "INSERT INTO evidence_chunks_fts (rowid, text, source_id) VALUES (?, ?, ?)",
                (chunk_id, text, source_id),
            )
            return EvidenceChunk(chunk_id, source_id, text, locator, language)

    def list_chunks(self, source_id: int) -> list[EvidenceChunk]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, source_id, text, locator, language
                FROM evidence_chunks WHERE source_id = ? ORDER BY id
                """,
                (source_id,),
            ).fetchall()
        return [EvidenceChunk(*row) for row in rows]

    def preview_chunks(self, source_id: int, offset: int, limit: int) -> tuple[int, list[EvidenceChunk]]:
        with self._connect() as connection:
            connection.execute("BEGIN")
            total = connection.execute(
                "SELECT count(*) FROM evidence_chunks WHERE source_id = ?", (source_id,)
            ).fetchone()[0]
            rows = connection.execute(
                """SELECT id, source_id, text, locator, language FROM evidence_chunks
                   WHERE source_id = ? ORDER BY id LIMIT ? OFFSET ?""",
                (source_id, limit, offset),
            ).fetchall()
        return total, [EvidenceChunk(*row) for row in rows]

    def search_chunks(self, task_id: int, query: str, limit: int) -> list[EvidenceChunk]:
        terms = [term for term in query.replace("/", " ").split() if term]
        if not terms:
            return []
        fts_query = " OR ".join(f'"{term.replace(chr(34), "")}"' for term in terms)
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT evidence_chunks.id, evidence_chunks.source_id, evidence_chunks.text,
                       evidence_chunks.locator, evidence_chunks.language
                FROM evidence_chunks_fts
                JOIN evidence_chunks ON evidence_chunks.id = evidence_chunks_fts.rowid
                JOIN sources ON sources.id = evidence_chunks.source_id
                WHERE sources.task_id = ? AND sources.kind IN ('project', 'supplement')
                      AND evidence_chunks_fts MATCH ?
                ORDER BY bm25(evidence_chunks_fts) LIMIT ?
                """,
                (task_id, fts_query, limit),
            ).fetchall()
        return [EvidenceChunk(*row) for row in rows]

    def create_claim(self, claim: Claim) -> Claim:
        with self._connect() as connection:
            cursor = connection.execute(
                """INSERT INTO claims (task_id, text, resume_locator, capability_tags, status)
                VALUES (?, ?, ?, ?, ?)""",
                (claim.task_id, claim.text, claim.resume_locator, json.dumps(claim.capability_tags), claim.status),
            )
        return Claim(cursor.lastrowid, claim.task_id, claim.text, claim.resume_locator, claim.capability_tags, claim.status)

    def update_claim_status(self, claim_id: int, status: str) -> None:
        with self._connect() as connection:
            connection.execute("UPDATE claims SET status = ? WHERE id = ?", (status, claim_id))

    def create_claims_once(self, task_id: int, claims: list[Claim]) -> list[Claim]:
        # The check and whole batch share one writer transaction, including
        # requests from other tabs/processes. Existing rows are never rebuilt.
        query = "SELECT id, task_id, text, resume_locator, capability_tags, status FROM claims WHERE task_id = ? ORDER BY id"
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            rows = connection.execute(query, (task_id,)).fetchall()
            if not rows:
                for claim in claims:
                    connection.execute(
                        "INSERT INTO claims (task_id, text, resume_locator, capability_tags, status) VALUES (?, ?, ?, ?, ?)",
                        (task_id, claim.text, claim.resume_locator, json.dumps(claim.capability_tags), claim.status),
                    )
                rows = connection.execute(query, (task_id,)).fetchall()
        return [Claim(row[0], row[1], row[2], row[3], tuple(json.loads(row[4])), row[5]) for row in rows]

    def undo_claim_review(self, task_id: int, claim_id: int, checkpoint_path: Path) -> None:
        """同一 SQLite 事务恢复主张、审核队列和事件，保留证据判定。"""
        with self._connect() as connection:
            connection.execute("ATTACH DATABASE ? AS audit_store", (str(checkpoint_path),))
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT status FROM claims WHERE task_id = ? AND id = ?", (task_id, claim_id)).fetchone()
            if row is None:
                raise LookupError("主张不存在")
            if row[0] not in {"confirmed", "rejected"}:
                raise ValueError("该主张尚未审核或已撤销")
            if connection.execute("SELECT 1 FROM generated_reports WHERE task_id = ?", (task_id,)).fetchone():
                raise ValueError("任务已生成报告，暂不支持撤销审核，以免报告与审核状态不一致")
            pending_ids = [item[0] for item in connection.execute(
                "SELECT id FROM claims WHERE task_id = ? AND status = 'pending_review' AND id != ? ORDER BY id", (task_id, claim_id)
            ).fetchall()]
            connection.execute("UPDATE claims SET status = 'pending_review' WHERE id = ?", (claim_id,))
            connection.execute(
                "INSERT OR REPLACE INTO audit_store.audit_checkpoints (task_id, claim_ids, position, status) VALUES (?, ?, 0, 'awaiting_review')",
                (task_id, ",".join(map(str, [claim_id, *pending_ids]))),
            )
            connection.execute("INSERT INTO audit_store.audit_events (task_id, event) VALUES (?, ?)", (task_id, f"主张 {claim_id} 已撤销审核，返回待审核"))

    def update_claim_text(self, claim_id: int, text: str) -> None:
        with self._connect() as connection:
            connection.execute("UPDATE claims SET text = ? WHERE id = ?", (text, claim_id))

    def list_claims(self, task_id: int) -> list[Claim]:
        with self._connect() as connection:
            rows = connection.execute("SELECT id, task_id, text, resume_locator, capability_tags, status FROM claims WHERE task_id = ? ORDER BY id", (task_id,)).fetchall()
        return [Claim(row[0], row[1], row[2], row[3], tuple(json.loads(row[4])), row[5]) for row in rows]

    def save_assessment(self, assessment: EvidenceAssessment) -> None:
        with self._connect() as connection:
            connection.execute(
                """INSERT INTO evidence_assessments (claim_id, links, verdict, rationale)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(claim_id) DO UPDATE SET
                    links = excluded.links,
                    verdict = excluded.verdict,
                    rationale = excluded.rationale""",
                (
                    assessment.claim_id,
                    json.dumps(assessment.links),
                    assessment.verdict,
                    assessment.rationale,
                ),
            )

    def get_assessment(self, claim_id: int) -> EvidenceAssessment | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT claim_id, links, verdict, rationale FROM evidence_assessments WHERE claim_id = ?",
                (claim_id,),
            ).fetchone()
        if row is None:
            return None
        return EvidenceAssessment(row[0], tuple(json.loads(row[1])), row[2], row[3])

    def save_gate_decision(self, claim_id: int, decision: GateDecision) -> None:
        with self._connect() as connection:
            connection.execute(
                """INSERT INTO gate_decisions (claim_id, eligible, requires_review, reason)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(claim_id) DO UPDATE SET
                    eligible = excluded.eligible,
                    requires_review = excluded.requires_review,
                    reason = excluded.reason""",
                (claim_id, int(decision.eligible), int(decision.requires_review), decision.reason),
            )

    def get_gate_decision(self, claim_id: int) -> GateDecision | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT eligible, requires_review, reason FROM gate_decisions WHERE claim_id = ?",
                (claim_id,),
            ).fetchone()
        if row is None:
            return None
        return GateDecision(bool(row[0]), bool(row[1]), row[2])

    def mark_report_generated(self, task_id: int) -> None:
        with self._connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO generated_reports (task_id) VALUES (?)", (task_id,)
            )

    def has_generated_report(self, task_id: int) -> bool:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT 1 FROM generated_reports WHERE task_id = ?", (task_id,)
            ).fetchone()
        return row is not None

    def create_interview(
        self,
        *,
        task_id: int,
        mode: str,
        question_count: int,
        focus_areas: tuple[str, ...],
        duration_minutes: int | None,
    ) -> InterviewSession:
        with self._connect() as connection:
            cursor = connection.execute(
                """INSERT INTO interviews
                (task_id, mode, question_count, focus_areas, status, duration_minutes)
                VALUES (?, ?, ?, ?, ?, ?)""",
                (task_id, mode, question_count, json.dumps(focus_areas), "in_progress", duration_minutes),
            )
        return InterviewSession(
            cursor.lastrowid, task_id, mode, question_count, focus_areas, "in_progress", duration_minutes
        )

    def get_interview(self, session_id: int) -> InterviewSession | None:
        with self._connect() as connection:
            row = connection.execute(
                """SELECT id, task_id, mode, question_count, focus_areas, status, duration_minutes
                FROM interviews WHERE id = ?""", (session_id,)
            ).fetchone()
        if row is None:
            return None
        return InterviewSession(row[0], row[1], row[2], row[3], tuple(json.loads(row[4])), row[5], row[6])

    def update_interview_status(self, session_id: int, status: str) -> None:
        with self._connect() as connection:
            connection.execute("UPDATE interviews SET status = ? WHERE id = ?", (status, session_id))

    def create_interview_turn(
        self, *, session_id: int, question: str, evidence_ids: tuple[int, ...]
    ) -> InterviewTurn:
        with self._connect() as connection:
            cursor = connection.execute(
                "INSERT INTO interview_turns (session_id, question, answer, evidence_ids) VALUES (?, ?, NULL, ?)",
                (session_id, question, json.dumps(evidence_ids)),
            )
        return InterviewTurn(cursor.lastrowid, session_id, question, None, evidence_ids)

    def answer_interview_turn(self, turn_id: int, answer: str) -> None:
        with self._connect() as connection:
            connection.execute("UPDATE interview_turns SET answer = ? WHERE id = ?", (answer, turn_id))

    def list_interview_turns(self, session_id: int) -> list[InterviewTurn]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT id, session_id, question, answer, evidence_ids FROM interview_turns WHERE session_id = ? ORDER BY id",
                (session_id,),
            ).fetchall()
        return [InterviewTurn(row[0], row[1], row[2], row[3], tuple(json.loads(row[4]))) for row in rows]

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                PRAGMA foreign_keys = ON;
                CREATE TABLE IF NOT EXISTS tasks (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    status TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sources (
                    id INTEGER PRIMARY KEY,
                    task_id INTEGER NOT NULL REFERENCES tasks(id),
                    kind TEXT NOT NULL,
                    label TEXT NOT NULL,
                    relative_path TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS evidence_chunks (
                    id INTEGER PRIMARY KEY,
                    source_id INTEGER NOT NULL REFERENCES sources(id),
                    text TEXT NOT NULL,
                    locator TEXT NOT NULL,
                    language TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS claims (
                    id INTEGER PRIMARY KEY,
                    task_id INTEGER NOT NULL REFERENCES tasks(id),
                    text TEXT NOT NULL,
                    resume_locator TEXT NOT NULL,
                    capability_tags TEXT NOT NULL,
                    status TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS generated_reports (
                    task_id INTEGER PRIMARY KEY REFERENCES tasks(id)
                );
                CREATE TABLE IF NOT EXISTS evidence_assessments (
                    claim_id INTEGER PRIMARY KEY REFERENCES claims(id),
                    links TEXT NOT NULL,
                    verdict TEXT NOT NULL,
                    rationale TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS gate_decisions (
                    claim_id INTEGER PRIMARY KEY REFERENCES claims(id),
                    eligible INTEGER NOT NULL,
                    requires_review INTEGER NOT NULL,
                    reason TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS interviews (
                    id INTEGER PRIMARY KEY,
                    task_id INTEGER NOT NULL REFERENCES tasks(id),
                    mode TEXT NOT NULL,
                    question_count INTEGER NOT NULL,
                    focus_areas TEXT NOT NULL,
                    status TEXT NOT NULL,
                    duration_minutes INTEGER
                );
                CREATE TABLE IF NOT EXISTS interview_turns (
                    id INTEGER PRIMARY KEY,
                    session_id INTEGER NOT NULL REFERENCES interviews(id),
                    question TEXT NOT NULL,
                    answer TEXT,
                    evidence_ids TEXT NOT NULL
                );
                CREATE VIRTUAL TABLE IF NOT EXISTS evidence_chunks_fts
                USING fts5(text, source_id UNINDEXED);
                """
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path)
        connection.execute("PRAGMA foreign_keys = ON")
        return connection
