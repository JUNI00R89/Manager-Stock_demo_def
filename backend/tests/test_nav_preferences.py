"""Each user chooses which sidebar entries to hide; it only affects that user and never hides Inicio or Configuración."""
from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-nav-")
DB = Path(TEMP.name) / "manager_stock_test.db"
os.environ["MANAGER_STOCK_DB"] = str(DB)
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402

PASSWORD = "PruebaSegura123!"
URL = "/api/auth/me/preferences"


def run() -> None:
    with TestClient(app) as client:
        owner = {"Authorization": "Bearer " + client.post("/api/auth/register", json={"name": "Dueña", "email": "duena@menu.local", "password": PASSWORD}).json()["access_token"]}
        business_id = client.get("/api/auth/me", headers=owner).json()["businessId"]
        with closing(sqlite3.connect(DB)) as conn:
            conn.execute("INSERT OR REPLACE INTO business_subscriptions (business_id,plan_id,status) VALUES (?,'entrepreneur','active')", (business_id,))
            conn.commit()
        assert client.post("/api/users", headers=owner, json={"name": "Caja", "email": "caja@menu.local", "password": PASSWORD, "role": "cashier"}).status_code == 201
        cashier = {"Authorization": "Bearer " + client.post("/api/auth/login", json={"email": "caja@menu.local", "password": PASSWORD}).json()["access_token"]}

        assert client.get("/api/auth/me", headers=cashier).json()["hiddenNav"] == []
        saved = client.put(URL, headers=cashier, json={"hiddenNav": ["/reports", "/dashboard", "/settings", "/reports"]})
        assert saved.status_code == 200, saved.text
        assert saved.json()["hiddenNav"] == ["/reports"], "Inicio and Configuración stay visible; duplicates dropped"
        login = client.post("/api/auth/login", json={"email": "caja@menu.local", "password": PASSWORD}).json()
        assert login["user"]["hiddenNav"] == ["/reports"], "the choice follows the user to another device"
        assert client.get("/api/auth/me", headers=owner).json()["hiddenNav"] == [], "it never changes another user's menu"

        assert client.put(URL, headers=cashier, json={"hiddenNav": ["javascript:alert(1)"]}).status_code == 422
        assert client.put(URL, headers=cashier, json={"hiddenNav": [f"/x{i}" for i in range(61)]}).status_code == 422
        assert client.put(URL, json={"hiddenNav": []}).status_code == 401
        assert client.put(URL, headers=cashier, json={"hiddenNav": []}).json()["hiddenNav"] == []

    print("OK: each user hides their own sidebar entries; Inicio and Configuración always stay.")
    TEMP.cleanup()


if __name__ == "__main__":
    run()
