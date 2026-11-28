"""The legacy `users` table (replaced by auth_users, never written) is gone from new and existing databases."""
from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-legacy-users-")
DB = Path(TEMP.name) / "manager_stock_test.db"
os.environ["MANAGER_STOCK_DB"] = str(DB)
os.environ["MANAGER_STOCK_AUTO_BACKUP"] = "0"
sys.path.insert(0, str(ROOT))

from backend.main import prepare_database  # noqa: E402


def has_users_table() -> bool:
    with closing(sqlite3.connect(DB)) as conn:
        return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").fetchone() is not None


def run() -> None:
    prepare_database()
    assert not has_users_table(), "a new database does not create the legacy users table"

    # An existing database that still has it (created by an older version) loses it on the next start.
    with closing(sqlite3.connect(DB)) as conn, conn:
        conn.execute("DELETE FROM schema_migrations WHERE version='012_drop_legacy_users.sql'")
        conn.execute("CREATE TABLE users (id TEXT PRIMARY KEY, business_id TEXT, full_name TEXT, email TEXT, password_hash TEXT, role TEXT)")
    prepare_database()
    assert not has_users_table(), "the migration drops it from existing databases"
    prepare_database()  # and starting again does not bring it back
    assert not has_users_table()
    print("OK: tabla users heredada eliminada")


def test_legacy_users_table() -> None:
    run()


if __name__ == "__main__":
    run()
