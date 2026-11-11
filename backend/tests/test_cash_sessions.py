"""Cash received by any role must land inside a cash session so the till count adds up."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-cash-test-")
os.environ["MANAGER_STOCK_DB"] = str(Path(TEMP.name) / "manager_stock_test.db")
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402
from backend.main import app  # noqa: E402

RETAIL = {"type": "retail", "name": "Tienda Caja", "currency": "COP", "taxRate": 0,
          "features": {"inventory": True, "pos": True, "reservations": False, "tables": False, "rooms": False,
                       "warehouse": False, "services": False, "delivery": False}}


def run() -> None:
    with TestClient(app) as client:
        token = client.post("/api/auth/register", json={"name": "Dueño Caja", "email": "caja@test.local", "password": "PruebaSegura123!"}).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        assert client.put("/api/business/config", headers=headers, json=RETAIL).status_code == 200
        product = client.post("/api/products", headers=headers, json={"name": "Agua", "sku": "AG1", "category": "Bebidas", "price": 2000, "cost": 1000, "stock": 50, "minStock": 1}).json()

        def sell(key, method, payments=None):
            return client.post("/api/sales", headers=headers, json={"idempotencyKey": f"venta-{key}", "items": [{"productId": product["id"], "quantity": 1}],
                                                                    "paymentMethod": method, "payments": payments or []})

        blocked = sell("efectivo-sin-turno", "cash")
        assert blocked.status_code == 409 and "turno" in blocked.json()["detail"], blocked.text
        assert sell("tarjeta-sin-turno", "card").status_code == 201, "card does not touch the till"
        assert sell("mixto-sin-turno", "split", [{"method": "card", "amount": 1000}, {"method": "cash", "amount": 1000}]).status_code == 409

        session = client.post("/api/cash/sessions", headers=headers, json={"openingAmount": 5000}).json()
        attached = sell("efectivo-con-turno", "cash")
        assert attached.status_code == 201, attached.text
        assert attached.json()["cashSessionId"] == session["id"], "cash sale joins the seller's open session"
        assert client.get("/api/cash/sessions/current", headers=headers).json()["expectedAmount"] == 7000

    print("OK: cash sales always belong to the seller's open cash session; card sales unaffected.")
    TEMP.cleanup()


if __name__ == "__main__":
    run()
