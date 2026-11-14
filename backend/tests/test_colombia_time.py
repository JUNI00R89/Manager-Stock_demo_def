"""Sale timestamps use Colombia time whatever the server time zone is (a UTC Linux server included)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.core.db import colombia_now_iso  # noqa: E402


def run() -> None:
    stamp = colombia_now_iso()
    assert stamp.endswith("-05:00") and "T" in stamp, stamp
    print("OK: timestamps are stored in Colombia time.")


if __name__ == "__main__":
    run()
