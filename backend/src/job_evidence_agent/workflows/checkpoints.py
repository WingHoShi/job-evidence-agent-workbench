"""审核工作流的 SQLite checkpoint 存储。"""

from __future__ import annotations

import sqlite3
from pathlib import Path


class SQLiteAuditCheckpointer:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path
        database_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute(
                """CREATE TABLE IF NOT EXISTS audit_checkpoints (
                task_id INTEGER PRIMARY KEY, claim_ids TEXT NOT NULL,
                position INTEGER NOT NULL, status TEXT NOT NULL)"""
            )
            connection.execute(
                "CREATE TABLE IF NOT EXISTS audit_events (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL, event TEXT NOT NULL)"
            )

    def save(self, task_id: int, claim_ids: list[int], position: int, status: str) -> None:
        with self._connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO audit_checkpoints VALUES (?, ?, ?, ?)",
                (task_id, ",".join(map(str, claim_ids)), position, status),
            )

    def load(self, task_id: int) -> tuple[list[int], int, str] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT claim_ids, position, status FROM audit_checkpoints WHERE task_id = ?", (task_id,)
            ).fetchone()
        if row is None:
            return None
        return [int(value) for value in row[0].split(",") if value], row[1], row[2]

    def add_event(self, task_id: int, event: str) -> None:
        with self._connect() as connection:
            connection.execute("INSERT INTO audit_events (task_id, event) VALUES (?, ?)", (task_id, event))

    def events(self, task_id: int) -> list[str]:
        with self._connect() as connection:
            rows = connection.execute("SELECT event FROM audit_events WHERE task_id = ? ORDER BY id", (task_id,)).fetchall()
        return [row[0] for row in rows]

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.database_path)
