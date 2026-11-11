"""Custom roles can be edited (effective immediately) and deleted once no user holds them."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-roles-test-")
os.environ["MANAGER_STOCK_DB"] = str(Path(TEMP.name) / "manager_stock_test.db")
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402
from backend.core.db import connection  # noqa: E402
from backend.main import app  # noqa: E402

RETAIL = {"type": "retail", "name": "Tienda Roles", "currency": "COP", "taxRate": 0,
          "features": {"inventory": True, "pos": True, "reservations": False, "tables": False, "rooms": False,
                       "warehouse": False, "services": False, "delivery": False}}
PASSWORD = "EmpleadoSeguro123!"


def login(client, email, password):
    return {"Authorization": "Bearer " + client.post("/api/auth/login", json={"email": email, "password": password}).json()["access_token"]}


def run() -> None:
    with TestClient(app) as client:
        owner = client.post("/api/auth/register", json={"name": "Dueña Roles", "email": "roles@test.local", "password": "PruebaSegura123!"}).json()
        h = {"Authorization": f"Bearer {owner['access_token']}"}
        assert client.put("/api/business/config", headers=h, json=RETAIL).status_code == 200
        with connection() as conn:  # lift the free-plan user limit
            conn.execute("INSERT INTO business_subscriptions (business_id,plan_id,status) VALUES (?, 'enterprise','active') ON CONFLICT(business_id) DO UPDATE SET plan_id='enterprise',status='active'", (owner["user"]["businessId"],))

        role = client.post("/api/custom-roles", headers=h, json={"name": "Ventas", "permissions": ["sales.view"]}).json()
        assert client.post("/api/users", headers=h, json={"name": "Empleado Uno", "email": "uno@test.local", "password": PASSWORD, "customRoleId": role["id"]}).status_code == 201
        admin = client.post("/api/users", headers=h, json={"name": "Admin Uno", "email": "admin@test.local", "password": PASSWORD, "role": "business_admin"})
        assert admin.status_code == 201, admin.text
        staff = login(client, "uno@test.local", PASSWORD)
        assert client.get("/api/sales", headers=staff).status_code == 200

        # Edit: rename and swap permissions; the change applies to the next request.
        edited = client.put(f"/api/custom-roles/{role['id']}", headers=h, json={"name": "Solo catálogo", "permissions": ["catalog.view"]})
        assert edited.status_code == 200, edited.text
        assert edited.json()["name"] == "Solo catálogo" and "sales.view" not in edited.json()["permissions"]
        assert client.get("/api/sales", headers=staff).status_code == 403
        assert client.get("/api/products", headers=staff).status_code == 200

        # Only the owner manages roles.
        admin_h = login(client, "admin@test.local", PASSWORD)
        assert client.put(f"/api/custom-roles/{role['id']}", headers=admin_h, json={"name": "Intento admin", "permissions": ["sales.view"]}).status_code == 403
        assert client.delete(f"/api/custom-roles/{role['id']}", headers=admin_h).status_code == 403

        # Delete: blocked while someone holds the role, allowed afterwards.
        assert client.delete(f"/api/custom-roles/{role['id']}", headers=h).status_code == 409
        holder = next(u for u in client.get("/api/users", headers=h).json() if u["email"] == "uno@test.local")
        assert client.patch(f"/api/users/{holder['id']}", headers=h, json={"role": "cashier"}).status_code == 200
        assert client.delete(f"/api/custom-roles/{role['id']}", headers=h).status_code == 204
        assert all(r["id"] != role["id"] for r in client.get("/api/custom-roles", headers=h).json())

    print("OK: custom roles can be edited (immediate effect) and deleted when unassigned; owner only.")
    TEMP.cleanup()


if __name__ == "__main__":
    run()
