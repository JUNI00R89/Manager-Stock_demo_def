"""Deactivating warehouse locations keeps the warehouse usable, and negative stock needs its own permission."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-locations-test-")
os.environ["MANAGER_STOCK_DB"] = str(Path(TEMP.name) / "manager_stock_test.db")
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402
from backend.core.db import connection  # noqa: E402
from backend.main import app  # noqa: E402

WAREHOUSE = {"type": "warehouse", "name": "Bodega Ubicaciones", "currency": "COP", "taxRate": 0,
             "features": {"inventory": True, "pos": True, "warehouse": True}}
PASSWORD = "EmpleadoSeguro123!"
SETTINGS = {"allowNegativeStock": False, "expiryAlertDays": 30, "lowStockAlerts": True}


def run() -> None:
    with TestClient(app) as client:
        owner = client.post("/api/auth/register", json={"name": "Dueña", "email": "ubicaciones@test.local", "password": "PruebaSegura123!"}).json()
        h = {"Authorization": f"Bearer {owner['access_token']}"}
        assert client.put("/api/business/config", headers=h, json=WAREHOUSE).status_code == 200

        def location(code: str) -> str:
            created = client.post("/api/inventory/locations", headers=h, json={"code": code, "name": code})
            assert created.status_code == 201, created.text
            return created.json()["id"]

        # 1. The business default location cannot be deactivated, by delete or by editing it inactive.
        default = location("DEF-1")
        assert client.put("/api/inventory/settings", headers=h, json={**SETTINGS, "defaultLocationId": default}).status_code == 200
        refused = client.delete(f"/api/inventory/locations/{default}", headers=h)
        assert refused.status_code == 409 and "por defecto" in refused.json()["detail"], refused.text
        edited = client.patch(f"/api/inventory/locations/{default}", headers=h, json={"code": "DEF-1", "active": False})
        assert edited.status_code == 409, edited.text

        # 2. Nor a location that products use as their default.
        shelf = location("EST-1")
        product = client.post("/api/products", headers=h, json={"name": "Arroz", "sku": "AR1", "category": "Mercancía", "price": 4500, "cost": 3000, "stock": 0, "minStock": 0, "defaultLocationId": shelf})
        assert product.status_code == 201, product.text
        refused = client.delete(f"/api/inventory/locations/{shelf}", headers=h)
        assert refused.status_code == 409 and "producto" in refused.json()["detail"], refused.text

        # 3. A free location is deactivated, still listed with includeInactive, and can be reactivated.
        spare = location("LIB-1")
        assert client.delete(f"/api/inventory/locations/{spare}", headers=h).status_code == 200
        assert all(item["id"] != spare for item in client.get("/api/inventory/locations", headers=h).json())
        listed = {item["id"]: item for item in client.get("/api/inventory/locations?includeInactive=true", headers=h).json()}
        assert listed[spare]["active"] is False
        back = client.patch(f"/api/inventory/locations/{spare}", headers=h, json={"code": "LIB-1", "name": "LIB-1", "active": True})
        assert back.status_code == 200 and back.json()["active"] is True, back.text

        # 4. Turning negative stock on requires inventory.negative, even for a role that may edit warehouse settings.
        with connection() as conn:  # lift the free-plan user limit
            conn.execute("INSERT INTO business_subscriptions (business_id,plan_id,status) VALUES (?, 'enterprise','active') ON CONFLICT(business_id) DO UPDATE SET plan_id='enterprise',status='active'", (owner["user"]["businessId"],))
        role = client.post("/api/custom-roles", headers=h, json={"name": "Bodeguero", "permissions": ["inventory.view", "inventory.edit"]}).json()
        assert client.post("/api/users", headers=h, json={"name": "Bodeguero", "email": "bodeguero@test.local", "password": PASSWORD, "customRoleId": role["id"]}).status_code == 201
        clerk = {"Authorization": "Bearer " + client.post("/api/auth/login", json={"email": "bodeguero@test.local", "password": PASSWORD}).json()["access_token"]}
        current = {**SETTINGS, "defaultLocationId": default}
        assert client.put("/api/inventory/settings", headers=clerk, json={**current, "expiryAlertDays": 15}).status_code == 200, "other settings stay editable"
        denied = client.put("/api/inventory/settings", headers=clerk, json={**current, "allowNegativeStock": True})
        assert denied.status_code == 403, denied.text
        assert client.get("/api/inventory/settings", headers=h).json()["allowNegativeStock"] is False
        assert client.put("/api/inventory/settings", headers=h, json={**current, "allowNegativeStock": True}).status_code == 200, "the owner may"
    print("OK: ubicaciones por defecto protegidas y stock negativo con permiso propio")


def test_inventory_locations() -> None:
    run()


if __name__ == "__main__":
    run()
