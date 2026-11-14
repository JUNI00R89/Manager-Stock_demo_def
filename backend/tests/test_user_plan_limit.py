"""The plan's user limit is checked in the same transaction as the insert."""
from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-user-limit-test-")
DB = Path(TEMP.name) / "manager_stock_test.db"
os.environ["MANAGER_STOCK_DB"] = str(DB)
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402


def run() -> None:
    with TestClient(app) as client:
        token = client.post("/api/auth/register", json={"name": "Dueña Límite", "email": "limite@test.local", "password": "PruebaSegura123!"}).json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}
        business_id = client.get("/api/auth/me", headers=h).json()["businessId"]
        new_user = lambda email: client.post("/api/users", headers=h, json={"name": "Caja", "email": email, "password": "PruebaSegura123!", "role": "cashier"})  # noqa: E731

        full = new_user("caja1@test.local")
        assert full.status_code == 409 and "usuarios" in full.json()["detail"], "free plan: only the owner"

        with closing(sqlite3.connect(DB)) as conn:
            conn.execute("INSERT OR REPLACE INTO business_subscriptions (business_id,plan_id,status) VALUES (?,'entrepreneur','active')", (business_id,))
            conn.commit()
        assert new_user("caja1@test.local").status_code == 201
        assert new_user("caja1@test.local").status_code == 409, "duplicate email"
        assert new_user("caja2@test.local").status_code == 201, "a failed duplicate does not use a slot"
        assert new_user("caja3@test.local").status_code == 409, "entrepreneur plan: 3 users in total"

    print("OK: plan user limit holds, duplicates do not consume a slot.")
    TEMP.cleanup()


if __name__ == "__main__":
    run()
