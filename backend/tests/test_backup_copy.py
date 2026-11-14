"""Verified backup copies: work on Windows, tolerate legacy orphan rows, survive filesystems without hard links, keep a bounded history."""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
from contextlib import closing
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend import backups  # noqa: E402
from backend.backups import create_backup, prune_automatic_backups  # noqa: E402


def make_db(path: Path, orphan: bool = False) -> None:
    with closing(sqlite3.connect(path)) as conn:
        conn.execute("CREATE TABLE ventas (id INTEGER PRIMARY KEY, total REAL)")
        conn.execute("CREATE TABLE lineas (id INTEGER PRIMARY KEY, venta_id INTEGER REFERENCES ventas(id))")
        conn.execute("INSERT INTO ventas (total) VALUES (21420)")
        if orphan:
            conn.execute("INSERT INTO lineas (venta_id) VALUES (999)")  # legacy row; foreign keys were off
        conn.commit()


def run() -> None:
    with tempfile.TemporaryDirectory(prefix="manager-stock-backup-test-") as folder:
        source = Path(folder) / "negocio.db"
        make_db(source)
        backups_dir = Path(folder) / "backups"
        target = create_backup(source, backups_dir)  # raised PermissionError on Windows before the fix
        assert target.exists() and target.with_suffix(".json").exists()
        assert not list(backups_dir.glob(".sqlite-copy-*.tmp")), "temporary copy is cleaned up"
        with closing(sqlite3.connect(target)) as copy:
            assert copy.execute("SELECT total FROM ventas").fetchone()[0] == 21420

        # A legacy orphan row must not block every backup (and the API start-up on upgrade).
        legacy = Path(folder) / "legado.db"
        make_db(legacy, orphan=True)
        assert create_backup(legacy, Path(folder) / "legado-backups").exists()

        # Filesystems without hard links (USB FAT32/exFAT, some network shares).
        with mock.patch.object(os, "link", side_effect=OSError("hard links not supported")):
            no_links = create_backup(source, Path(folder) / "usb")
        assert no_links.exists() and not list((Path(folder) / "usb").glob(".sqlite-copy-*.tmp"))

        # Only automatic copies of this database are pruned; others are kept.
        history = Path(folder) / "history"
        for _ in range(16):
            create_backup(source, history, automatic=True)
        manual = create_backup(source, history)
        prune_automatic_backups(history, source, keep=14)
        automatic_left = [p for p in history.glob("manager_stock_*.db") if json.loads(p.with_suffix(".json").read_text()).get("automatic")]
        assert len(automatic_left) == 14, len(automatic_left)
        assert manual.exists(), "a manual/older copy is never deleted"
    print("OK: backups are verified, portable and bounded.")


if __name__ == "__main__":
    run()
