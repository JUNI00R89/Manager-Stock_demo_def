"""A base cashier may fix a customer's contact data but not deactivate it or change its tax document."""
from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-cashier-customers-")
DB = Path(TEMP.name) / "manager_stock_test.db"
os.environ["MANAGER_STOCK_DB"] = str(DB)
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402

PASSWORD = "PruebaSegura123!"
RETAIL = {"type": "retail", "name": "Tienda Clientes", "currency": "COP", "taxRate": 0,
          "features": {"inventory": True, "pos": True, "reservations": False, "tables": False, "rooms": False,
                       "warehouse": False, "services": False, "delivery": False}}


def run() -> None:
    with TestClient(app) as client:
        owner = {"Authorization": "Bearer " + client.post("/api/auth/register", json={"name": "Dueño", "email": "dueno@clientes.local", "password": PASSWORD}).json()["access_token"]}
        assert client.put("/api/business/config", headers=owner, json=RETAIL).status_code == 200
        business_id = client.get("/api/auth/me", headers=owner).json()["businessId"]
        with closing(sqlite3.connect(DB)) as conn:
            conn.execute("INSERT OR REPLACE INTO business_subscriptions (business_id,plan_id,status) VALUES (?,'entrepreneur','active')", (business_id,))
            conn.commit()
        assert client.post("/api/users", headers=owner, json={"name": "Caja", "email": "caja@clientes.local", "password": PASSWORD, "role": "cashier"}).status_code == 201
        cashier = {"Authorization": "Bearer " + client.post("/api/auth/login", json={"email": "caja@clientes.local", "password": PASSWORD}).json()["access_token"]}

        created = client.post("/api/customers", headers=owner, json={"name": "Ana Ruiz", "documentType": "CC", "documentNumber": "1010"})
        assert created.status_code in (200, 201), created.text
        customer = created.json()
        edit = {"name": "Ana Ruiz Gómez", "documentType": "NIT", "documentNumber": "9999", "phone": "3001234567",
                "active": False, "revision": customer["revision"]}
        saved = client.put(f"/api/customers/{customer['id']}", headers=cashier, json=edit)
        assert saved.status_code == 200, saved.text
        body = saved.json()
        assert body["name"] == "Ana Ruiz Gómez" and body["phone"] == "3001234567", "contact data can be fixed"
        assert (body["documentType"], body["documentNumber"], body["active"]) == ("CC", "1010", True), body

    print("OK: a base cashier cannot deactivate a customer or change its tax document.")
    TEMP.cleanup()


if __name__ == "__main__":
    run()
