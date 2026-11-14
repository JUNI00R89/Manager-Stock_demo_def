"""A verified backup copy works on Windows too: every SQLite connection is closed before the temp file is removed."""
from __future__ import annotations

import sqlite3
import sys
import tempfile
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.backups import create_backup  # noqa: E402


def run() -> None:
    with tempfile.TemporaryDirectory(prefix="manager-stock-backup-test-") as folder:
        source = Path(folder) / "negocio.db"
        with closing(sqlite3.connect(source)) as conn:
            conn.execute("CREATE TABLE ventas (id INTEGER PRIMARY KEY, total REAL)")
            conn.execute("INSERT INTO ventas (total) VALUES (21420)")
            conn.commit()
        backups = Path(folder) / "backups"
        target = create_backup(source, backups)  # raised PermissionError on Windows before the fix
        assert target.exists() and target.with_suffix(".json").exists()
        assert not list(backups.glob(".sqlite-copy-*.tmp")), "temporary copy is cleaned up"
        with closing(sqlite3.connect(target)) as copy:
            assert copy.execute("SELECT total FROM ventas").fetchone()[0] == 21420
    print("OK: backup copy is verified and leaves no temp file (also on Windows).")


if __name__ == "__main__":
    run()
