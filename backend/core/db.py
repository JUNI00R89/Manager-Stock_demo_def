from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from backend.core.config import DB_PATH
from backend.core.context import current_business_id


@contextmanager
def connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    try:
        yield conn
    finally:
        conn.close()


def timestamp_iso(value: str | None) -> str | None:
    """Normalize SQLite timestamps (often naive UTC) to explicit UTC ISO strings."""
    if not value:
        return None
    raw = str(value).strip().replace(" ", "T", 1)
    parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds")


def audit(conn: sqlite3.Connection, action: str, entity_type: str, entity_id: str, details: dict | None = None):
    conn.execute(
        "INSERT INTO audit_log (business_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)",
        (current_business_id(), action, entity_type, entity_id, json.dumps(details or {}, ensure_ascii=False)),
    )


def table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return bool(conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone())


def table_has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    if not table_exists(conn, table):
        return False
    return column in {row["name"] for row in conn.execute(f'PRAGMA table_info("{table}")').fetchall()}


def colombia_now_iso() -> str:
    """Now in Colombia time ("...-05:00"), independent of the server's time zone, so sale dates sort consistently."""
    from zoneinfo import ZoneInfo

    return datetime.now(ZoneInfo("America/Bogota")).isoformat(timespec="seconds")
