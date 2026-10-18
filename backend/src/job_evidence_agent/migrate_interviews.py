"""显式备份与初始化新版面试表；应用启动不会自动调用此命令。"""

import argparse
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from job_evidence_agent.database import SQLiteRepository
from job_evidence_agent.interview_store import InterviewStore


def migrate(database_path: Path, backup_dir: Path) -> Path:
    database_path = database_path.resolve()
    backup_dir = backup_dir.resolve()
    if not database_path.is_file():
        raise ValueError("目标数据库不存在，拒绝创建空库")
    # 先只读核实原库；备份完成前不初始化或更改任何表。
    with closing(sqlite3.connect(database_path.as_uri() + "?mode=ro", uri=True)) as source:
        if source.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'").fetchone() is None:
            raise ValueError("目标不是工作台业务数据库")
        backup_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_path = backup_dir / f"{database_path.stem}-before-interview-v2-{timestamp}-{uuid4().hex[:8]}.sqlite3"
        with closing(sqlite3.connect(backup_path)) as backup:
            source.backup(backup)
            backup.commit()
            if backup.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("备份完整性检查失败，未执行迁移")
    InterviewStore(SQLiteRepository(database_path)).initialize()
    return backup_path


def main():
    parser = argparse.ArgumentParser(description="备份业务库并创建新版面试表（保留旧表）")
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--backup-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        backup = migrate(args.database, args.backup_dir)
    except (ValueError, OSError, sqlite3.Error) as error:
        parser.exit(1, f"迁移未完成：{error}\n")
    print(f"新版面试初始化完成；迁移前备份：{backup}")


if __name__ == "__main__":
    main()
