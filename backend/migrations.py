"""Ordered, atomic migrations for additions after the legacy bootstrap schema."""
from pathlib import Path
import hashlib
import sqlite3


def migrate(conn: sqlite3.Connection) -> None:
    conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
    for path in sorted((Path(__file__).parent.parent / "database" / "migrations").glob("*.sql")):
        script = path.read_text(encoding="utf-8")
        checksum = hashlib.sha256(script.encode()).hexdigest()
        conn.execute("BEGIN IMMEDIATE")
        try:
            previous = conn.execute("SELECT checksum FROM schema_migrations WHERE version=?", (path.name,)).fetchone()
            if previous:
                if previous[0] != checksum:
                    raise RuntimeError(f"La migración aplicada {path.name} fue modificada. Crea una migración nueva.")
            else:
                # executescript commits implicitly; execute complete SQL statements instead.
                statement = ""
                for line in script.splitlines(keepends=True):
                    statement += line
                    if sqlite3.complete_statement(statement):
                        conn.execute(statement)
                        statement = ""
                if statement.strip():
                    raise RuntimeError(f"SQL incompleto en {path.name}")
                conn.execute("INSERT INTO schema_migrations(version,checksum) VALUES (?,?)", (path.name, checksum))
            conn.commit()
        except Exception:
            conn.rollback()
            raise
