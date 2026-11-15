"""Regressions from the 2026-11-15 technical review: stock edits, appointment charges and sale idempotency keys."""
from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
from contextlib import closing
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-revision-")
DB = Path(TEMP.name) / "manager_stock_test.db"
os.environ["MANAGER_STOCK_DB"] = str(DB)
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402

PASSWORD = "PruebaSegura123!"
CONFIG = {"type": "services", "name": "Negocio Revisión", "currency": "COP", "taxRate": 0,
          "features": {"inventory": True, "pos": True, "reservations": True, "tables": False, "rooms": False,
                       "warehouse": False, "services": True, "delivery": False}}


def login(client: TestClient, email: str) -> dict:
    return {"Authorization": "Bearer " + client.post("/api/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]}


def staff(client: TestClient, owner: dict, email: str, permissions: list[str]) -> dict:
    role = client.post("/api/custom-roles", headers=owner, json={"name": email.split("@")[0], "permissions": permissions}).json()
    created = client.post("/api/users", headers=owner, json={"name": "Empleado", "email": email, "password": PASSWORD, "customRoleId": role["id"]})
    assert created.status_code == 201, created.text
    return login(client, email)


def movements(product_id: str) -> int:
    with closing(sqlite3.connect(DB)) as conn:
        return conn.execute("SELECT count(*) FROM inventory_movements WHERE product_id=?", (product_id,)).fetchone()[0]


def run() -> None:
    with TestClient(app) as client:
        owner = {"Authorization": "Bearer " + client.post("/api/auth/register", json={"name": "Dueña", "email": "duena@revision.local", "password": PASSWORD}).json()["access_token"]}
        assert client.put("/api/business/config", headers=owner, json=CONFIG).status_code == 200
        business_id = client.get("/api/auth/me", headers=owner).json()["businessId"]
        with closing(sqlite3.connect(DB)) as conn:
            conn.execute("INSERT OR REPLACE INTO business_subscriptions (business_id,plan_id,status) VALUES (?,'entrepreneur','active')", (business_id,))
            conn.commit()
        editor = staff(client, owner, "editor@revision.local", ["catalog.view", "catalog.edit"])
        seller = staff(client, owner, "vendedor@revision.local", ["sales.view", "sales.create", "cash.view", "cash.manage"])
        seller_session = client.post("/api/cash/sessions", headers=seller, json={"openingAmount": 0}).json()["id"]

        # 1. catalog.edit alone may rename a product but not change its stock.
        assert client.post("/api/product-categories", headers=owner, json={"name": "Insumos"}).status_code in (201, 409)
        product = client.post("/api/products", headers=owner, json={"name": "Champú", "sku": "CH1", "category": "Insumos", "price": 20000, "cost": 9000, "stock": 10, "minStock": 1}).json()
        body = {"name": "Champú grande", "sku": "CH1", "category": "Insumos", "price": 22000, "cost": 9000, "stock": 10, "minStock": 1}
        assert client.put(f"/api/products/{product['id']}", headers=editor, json=body).status_code == 200, "renaming is catalog work"
        before = movements(product["id"])
        blocked = client.put(f"/api/products/{product['id']}", headers=editor, json={**body, "stock": 15})
        assert blocked.status_code == 403, blocked.text
        stock = {p["id"]: p["stock"] for p in client.get("/api/products", headers=owner).json()}[product["id"]]
        assert stock == 10 and movements(product["id"]) == before, "no stock change and no movement"
        assert client.put(f"/api/products/{product['id']}", headers=owner, json={**body, "stock": 15}).status_code == 200, "the owner can adjust"

        # 2. Charging appointments through appointmentIds needs the same permissions as the single flow.
        service = client.post("/api/services/catalog", headers=owner, json={"name": "Corte", "durationMinutes": 30, "price": 25000}).json()
        professional = client.post("/api/services/professionals", headers=owner, json={"name": "Libre"}).json()
        day = (date.today() + timedelta(days=3)).isoformat()
        cita = client.post("/api/services/appointments", headers=owner, json={"serviceId": service["id"], "professionalId": professional["id"], "clientName": "Ana", "appointmentDate": day, "startTime": "10:00"}).json()
        assert client.patch(f"/api/services/appointments/{cita['id']}/status", headers=owner, json={"status": "attended"}).status_code == 200
        charge = {"idempotencyKey": "rev-cita-0001", "items": [], "appointmentIds": [cita["id"]], "customer": "Ana", "paymentMethod": "card"}
        denied = client.post("/api/sales", headers=seller, json={**charge, "cashSessionId": seller_session})  # has cash, lacks services.manage
        assert denied.status_code == 403, denied.text
        with closing(sqlite3.connect(DB)) as conn:
            assert conn.execute("SELECT sale_id FROM service_appointments WHERE id=?", (cita["id"],)).fetchone()[0] is None
        assert client.post("/api/sales", headers=owner, json={**charge, "idempotencyKey": "rev-cita-0002"}).status_code == 201

        # 3. A reused sale key with different content, or from another user, is not a retry.
        sale = {"idempotencyKey": "rev-venta-0001", "items": [{"productId": product["id"], "quantity": 1}], "paymentMethod": "card"}
        first = client.post("/api/sales", headers=owner, json=sale)
        assert first.status_code == 201, first.text
        retry = client.post("/api/sales", headers=owner, json=sale)
        assert retry.status_code in (200, 201) and retry.json()["id"] == first.json()["id"], "a true retry returns the same sale"
        changed = client.post("/api/sales", headers=owner, json={**sale, "items": [{"productId": product["id"], "quantity": 2}]})
        assert changed.status_code == 409, changed.text
        stolen = client.post("/api/sales", headers=seller, json={**sale, "cashSessionId": seller_session})
        assert stolen.status_code == 409 and first.json()["id"] not in stolen.text, stolen.text

    print("OK: stock edits need inventory.adjust, appointment charges need services+cash, sale keys are bound to content and user.")
    TEMP.cleanup()


if __name__ == "__main__":
    run()
