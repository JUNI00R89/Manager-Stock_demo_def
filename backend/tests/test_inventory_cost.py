"""Receiving stock averages the product cost (weighted) instead of overwriting it."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-cost-test-")
os.environ["MANAGER_STOCK_DB"] = str(Path(TEMP.name) / "manager_stock_test.db")
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402
from backend.main import app  # noqa: E402

WAREHOUSE = {"type": "warehouse", "name": "Bodega Costos", "currency": "COP", "taxRate": 0,
             "features": {"inventory": True, "pos": False, "reservations": False, "tables": False, "rooms": False,
                          "warehouse": True, "services": False, "delivery": False}}


def run() -> None:
    with TestClient(app) as client:
        token = client.post("/api/auth/register", json={"name": "Dueño Bodega", "email": "costos@test.local", "password": "PruebaSegura123!"}).json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}
        assert client.put("/api/business/config", headers=h, json=WAREHOUSE).status_code == 200
        product = client.post("/api/products", headers=h, json={"name": "Arroz", "sku": "AR1", "category": "Mercancía", "price": 3000, "cost": 1000, "stock": 100, "minStock": 1}).json()

        def cost():
            return next(p for p in client.get("/api/products", headers=h).json() if p["id"] == product["id"])["cost"]

        # Entry: 100 u at 1000 + 10 u at 1500 -> (100000 + 15000) / 110
        entry = client.post("/api/inventory/entries", headers=h, json={"items": [{"productId": product["id"], "quantity": 10, "unitCost": 1500}]})
        assert entry.status_code == 201, entry.text
        assert abs(cost() - 115000 / 110) < 0.01, cost()

        # Purchase order: 110 u at ~1045.45 + 40 u at 2000 -> (115000 + 80000) / 150 = 1300
        supplier = client.post("/api/suppliers", headers=h, json={"name": "Proveedor Uno", "company": "Granos SAS"}).json()
        order = client.post("/api/inventory/purchase-orders", headers=h, json={"supplierId": supplier["id"], "items": [{"productId": product["id"], "quantity": 40, "unitCost": 2000}]}).json()
        for step in ("approve", "send"):
            assert client.post(f"/api/inventory/purchase-orders/{order['id']}/{step}", headers=h).status_code == 200
        received = client.post(f"/api/inventory/purchase-orders/{order['id']}/receive", headers=h, json={"items": [{"itemId": order["items"][0]["id"], "quantity": 40}]})
        assert received.status_code == 200, received.text
        assert abs(cost() - 1300) < 0.01, cost()

    print("OK: entries and purchase receipts use the weighted average cost.")
    TEMP.cleanup()


if __name__ == "__main__":
    run()
