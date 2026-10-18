"""新版面试短事务、幂等请求和生成租约。旧版面试表只读保留。"""

import json
import sqlite3
import time
from contextlib import contextmanager
from uuid import uuid4

from job_evidence_agent.database import SQLiteRepository
from job_evidence_agent.interview_contracts import (
    GeneratedQuestion, InterviewConflictError, InterviewOptions, InterviewSnapshot,
    OperationLease, OperationView, SessionSummary, SessionView, TurnView,
)


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


class InterviewStore:
    def __init__(self, repository: SQLiteRepository):
        self.database_path = repository.database_path

    @contextmanager
    def _connection(self, write=False):
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            if write:
                connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def is_initialized(self):
        with self._connection() as connection:
            return connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='interview_v2_sessions'").fetchone() is not None

    def initialize(self):
        with self._connection() as connection:
            connection.executescript("""
                BEGIN IMMEDIATE;
                CREATE TABLE IF NOT EXISTS interview_v2_sessions (
                    id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id),
                    start_key TEXT NOT NULL UNIQUE, options TEXT NOT NULL, snapshot TEXT NOT NULL,
                    status TEXT NOT NULL, review TEXT
                );
                CREATE UNIQUE INDEX IF NOT EXISTS interview_v2_one_active
                    ON interview_v2_sessions(task_id) WHERE status != 'completed';
                CREATE TABLE IF NOT EXISTS interview_v2_turns (
                    id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES interview_v2_sessions(id),
                    ordinal INTEGER NOT NULL, payload TEXT NOT NULL, answer TEXT,
                    UNIQUE(session_id, ordinal)
                );
                CREATE TABLE IF NOT EXISTS interview_v2_requests (
                    session_id INTEGER NOT NULL REFERENCES interview_v2_sessions(id),
                    request_key TEXT NOT NULL, payload TEXT NOT NULL,
                    PRIMARY KEY(session_id, request_key)
                );
                CREATE TABLE IF NOT EXISTS interview_v2_operations (
                    id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES interview_v2_sessions(id),
                    kind TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
                    attempt_count INTEGER NOT NULL DEFAULT 0, token TEXT, expires REAL, safe_error TEXT, usage TEXT
                );
                COMMIT;
            """)

    def _session(self, connection, session_id):
        row = connection.execute("SELECT * FROM interview_v2_sessions WHERE id=?", (session_id,)).fetchone()
        if row is None:
            raise InterviewConflictError("面试不存在")
        return row

    def _operation(self, connection, session_id, kind):
        connection.execute("INSERT INTO interview_v2_operations(session_id, kind) VALUES (?,?)", (session_id, kind))

    def create_or_get_session(self, task_id, request_key, options, snapshot):
        options_json = encode(options.model_dump())
        with self._connection(True) as connection:
            old = connection.execute("SELECT * FROM interview_v2_sessions WHERE start_key=?", (request_key,)).fetchone()
            if old:
                if old["task_id"] != task_id or old["options"] != options_json:
                    raise InterviewConflictError("开始请求已使用，参数不一致")
                session_id = old["id"]
            else:
                if connection.execute("SELECT 1 FROM interview_v2_sessions WHERE task_id=? AND status!='completed'", (task_id,)).fetchone():
                    raise InterviewConflictError("已有未结束面试，请先继续或结束")
                session_id = connection.execute(
                    "INSERT INTO interview_v2_sessions(task_id,start_key,options,snapshot,status) VALUES (?,?,?,?, 'preparing')",
                    (task_id, request_key, options_json, snapshot.model_dump_json()),
                ).lastrowid
                self._operation(connection, session_id, "question")
        return self.get_session(session_id)

    def get_snapshot(self, session_id):
        with self._connection() as connection:
            return InterviewSnapshot.model_validate_json(self._session(connection, session_id)["snapshot"])

    def find_started(self, task_id, request_key, options):
        with self._connection() as connection:
            row = connection.execute("SELECT * FROM interview_v2_sessions WHERE start_key=?", (request_key,)).fetchone()
            if row and (row["task_id"] != task_id or row["options"] != encode(options.model_dump())):
                raise InterviewConflictError("开始请求已使用，参数不一致")
            return self._view(connection, row) if row else None

    def _request(self, connection, session_id, key, payload):
        old = connection.execute("SELECT payload FROM interview_v2_requests WHERE session_id=? AND request_key=?", (session_id, key)).fetchone()
        if old:
            if old[0] != encode(payload):
                raise InterviewConflictError("重复请求内容不同，请重新加载")
            return True
        return False

    def _save_request(self, connection, session_id, key, payload):
        connection.execute("INSERT INTO interview_v2_requests VALUES (?,?,?)", (session_id, key, encode(payload)))

    def save_answer(self, session_id, turn_id, answer, request_key):
        normalized = answer.strip()
        if not normalized or len(normalized) > 2000:
            raise ValueError("回答须为 1–2000 字")
        payload = {"kind": "answer", "turn_id": turn_id, "answer": normalized}
        with self._connection(True) as connection:
            session = self._session(connection, session_id)
            if not self._request(connection, session_id, request_key, payload):
                turn = connection.execute("SELECT * FROM interview_v2_turns WHERE session_id=? AND id=?", (session_id, turn_id)).fetchone()
                if session["status"] != "awaiting_answer" or not turn or turn["answer"] is not None:
                    raise InterviewConflictError("当前回合已改变，请重新加载")
                connection.execute("UPDATE interview_v2_turns SET answer=? WHERE id=?", (normalized, turn_id))
                self._save_request(connection, session_id, request_key, payload)
                last = turn["ordinal"] >= json.loads(session["options"])["question_count"]
                status = "ready_to_finish" if last else "generating_question"
                connection.execute("UPDATE interview_v2_sessions SET status=? WHERE id=?", (status, session_id))
                if not last:
                    self._operation(connection, session_id, "question")
        return self.get_session(session_id)

    def prepare_finish(self, session_id, request_key):
        payload = {"kind": "finish"}
        with self._connection(True) as connection:
            session = self._session(connection, session_id)
            if session["status"] == "completed":
                return self._view(connection, session)
            if not self._request(connection, session_id, request_key, payload):
                if session["status"] == "generating_review":
                    raise InterviewConflictError("复盘已开始，请继续或重试现有操作")
                operation = connection.execute("SELECT * FROM interview_v2_operations WHERE session_id=? ORDER BY id DESC LIMIT 1", (session_id,)).fetchone()
                if operation and operation["state"] == "running" and operation["expires"] > time.time():
                    raise InterviewConflictError("正在生成内容，请稍后结束")
                # 使旧的待生成/过期题目失效，迟到结果不能落库。
                connection.execute("UPDATE interview_v2_operations SET state='failed', token=NULL, safe_error='已结束出题' WHERE session_id=? AND state!='succeeded'", (session_id,))
                self._save_request(connection, session_id, request_key, payload)
                connection.execute("UPDATE interview_v2_sessions SET status='generating_review' WHERE id=?", (session_id,))
                self._operation(connection, session_id, "review")
        return self.get_session(session_id)

    def claim_operation(self, operation_id, now, retry=False):
        with self._connection(True) as connection:
            row = connection.execute("SELECT * FROM interview_v2_operations WHERE id=?", (operation_id,)).fetchone()
            if not row:
                return None
            latest = connection.execute("SELECT max(id) FROM interview_v2_operations WHERE session_id=?", (row["session_id"],)).fetchone()[0]
            expired = row["state"] == "running" and row["expires"] <= now
            allowed = row["state"] == "pending" or (retry and (row["state"] == "failed" or expired))
            if not allowed or row["id"] != latest:
                return None
            token = uuid4().hex
            connection.execute("UPDATE interview_v2_operations SET state='running', token=?, expires=?, safe_error=NULL, attempt_count=attempt_count+1 WHERE id=?", (token, now + 120, operation_id))
            return OperationLease(id=operation_id, session_id=row["session_id"], kind=row["kind"], token=token)

    def _owns(self, connection, lease):
        return connection.execute("SELECT 1 FROM interview_v2_operations WHERE id=? AND session_id=? AND token=? AND state='running'", (lease.id, lease.session_id, lease.token)).fetchone() is not None

    def complete_question(self, lease, question, usage=None, truncated=False):
        with self._connection(True) as connection:
            if lease.kind != "question" or not self._owns(connection, lease):
                return False
            ordinal = connection.execute("SELECT count(*)+1 FROM interview_v2_turns WHERE session_id=?", (lease.session_id,)).fetchone()[0]
            connection.execute("INSERT INTO interview_v2_turns(session_id,ordinal,payload) VALUES (?,?,?)", (lease.session_id, ordinal, question.model_dump_json()))
            connection.execute("UPDATE interview_v2_sessions SET status='awaiting_answer' WHERE id=?", (lease.session_id,))
            connection.execute("UPDATE interview_v2_operations SET state='succeeded', token=NULL,usage=? WHERE id=?", (encode(usage) if usage else None, lease.id))
            self._mark_truncated(connection, lease.session_id, truncated)
        return True

    def complete_review(self, lease, review, usage=None):
        with self._connection(True) as connection:
            if lease.kind != "review" or not self._owns(connection, lease):
                return False
            connection.execute("UPDATE interview_v2_sessions SET review=?,status='completed' WHERE id=?", (encode(review), lease.session_id))
            connection.execute("UPDATE interview_v2_operations SET state='succeeded', token=NULL,usage=? WHERE id=?", (encode(usage) if usage else None, lease.id))
        return True

    def fail_operation(self, lease, safe_error):
        with self._connection(True) as connection:
            if self._owns(connection, lease):
                connection.execute("UPDATE interview_v2_operations SET state='failed', token=NULL,safe_error=? WHERE id=?", (safe_error, lease.id))

    def _mark_truncated(self, connection, session_id, truncated):
        if truncated:
            snapshot = json.loads(self._session(connection, session_id)["snapshot"])
            snapshot["truncated"] = True
            connection.execute("UPDATE interview_v2_sessions SET snapshot=? WHERE id=?", (encode(snapshot), session_id))

    def _view(self, connection, row):
        turns = [TurnView(id=turn["id"], ordinal=turn["ordinal"], answer=turn["answer"], **json.loads(turn["payload"])) for turn in connection.execute("SELECT * FROM interview_v2_turns WHERE session_id=? ORDER BY ordinal", (row["id"],))]
        op = connection.execute("SELECT * FROM interview_v2_operations WHERE session_id=? ORDER BY id DESC LIMIT 1", (row["id"],)).fetchone()
        operation = None if not op else OperationView(id=op["id"], kind=op["kind"], state=op["state"], attempt_count=op["attempt_count"], safe_error=op["safe_error"], retry_allowed=op["state"] == "failed" or (op["state"] == "running" and op["expires"] <= time.time()), usage=json.loads(op["usage"]) if op["usage"] else None)
        return SessionView(id=row["id"], task_id=row["task_id"], status=row["status"], turns=turns, review=json.loads(row["review"]) if row["review"] else None, operation=operation, context_truncated=json.loads(row["snapshot"])["truncated"], **json.loads(row["options"]))

    def get_session(self, session_id):
        with self._connection() as connection:
            row = connection.execute("SELECT * FROM interview_v2_sessions WHERE id=?", (session_id,)).fetchone()
            return self._view(connection, row) if row else None

    def list_sessions(self, task_id):
        with self._connection() as connection:
            return [SessionSummary(id=row["id"], task_id=task_id, version=2, status=row["status"], question_count=json.loads(row["options"])["question_count"]) for row in connection.execute("SELECT * FROM interview_v2_sessions WHERE task_id=? ORDER BY id DESC", (task_id,))]
