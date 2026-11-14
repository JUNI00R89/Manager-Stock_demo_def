"""End to end: open the till, sell, stock goes down, close the till balanced, the dashboard shows the sale."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-flow-test-")
os.environ["MANAGER_STOCK_DB"] = str(Path(TEMP.name) / "manager_stock_test.db")
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402

RETAIL = {"type": "retail", "name": "Tienda Flujo", "currency": "COP", "taxRate": 0,
          "features": {"inventory": True, "pos": True, "reservations": False, "tables": False, "rooms": False,
                       "warehouse": False, "services": False, "delivery": False}}


def run() -> None:
    with TestClient(app) as client:
        token = client.post("/api/auth/register", json={"name": "Dueña Flujo", "email": "flujo@test.local", "password": "PruebaSegura123!"}).json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}
        assert client.put("/api/business/config", headers=h, json=RETAIL).status_code == 200
        product = client.post("/api/products", headers=h, json={"name": "Arroz 1kg", "sku": "ARZ1", "category": "Alimentos", "price": 4500, "cost": 3000, "stock": 10, "minStock": 1}).json()

        session = client.post("/api/cash/sessions", headers=h, json={"openingAmount": 50000})
        assert session.status_code == 201, session.text
        session_id = session.json()["id"]

        sale = client.post("/api/sales", headers=h, json={"idempotencyKey": "flujo-venta-0001", "items": [{"productId": product["id"], "quantity": 2}],
                                                          "paymentMethod": "cash", "cashSessionId": session_id})
        assert sale.status_code in (200, 201), sale.text
        total = sale.json()["totalPrice"]
        assert total == 9000, total

        stock = {p["id"]: p["stock"] for p in client.get("/api/products", headers=h).json()}[product["id"]]
        assert stock == 8, f"stock after selling 2: {stock}"

        current = client.get("/api/cash/sessions/current", headers=h).json()
        assert current["expectedAmount"] == 59000, current
        closed = client.post(f"/api/cash/sessions/{session_id}/close", headers=h, json={"closingAmount": 59000}).json()
        assert closed["status"] == "closed" and closed["difference"] == 0, closed

        dashboard = client.get("/api/dashboard", headers=h).json()
        assert dashboard["salesToday"] == 1 and dashboard["revenueToday"] == 9000, dashboard

    print("OK: sale -> stock -> balanced cash close -> dashboard, end to end.")
    TEMP.cleanup()


if __name__ == "__main__":
    run()
