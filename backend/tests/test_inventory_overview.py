"""The warehouse summary loads: it reuses the movements endpoint internally and used to pass a FastAPI Query object to SQLite."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-overview-")
os.environ["MANAGER_STOCK_DB"] = str(Path(TEMP.name) / "manager_stock_test.db")
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402

WAREHOUSE = {"type": "retail", "name": "Bodega Resumen", "currency": "COP", "taxRate": 0,
             "features": {"inventory": True, "pos": True, "warehouse": True}}


def run() -> None:
    with TestClient(app) as client:
        token = client.post("/api/auth/register", json={"name": "Dueña", "email": "duena@bodega.local", "password": "PruebaSegura123!"}).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        assert client.put("/api/business/config", headers=headers, json=WAREHOUSE).status_code == 200
        created = client.post("/api/products", headers=headers, json={"name": "Arroz", "sku": "AR1", "category": "Bebidas", "price": 4500, "cost": 3000, "stock": 20, "minStock": 5})
        assert created.status_code in (200, 201), created.text

        overview = client.get("/api/inventory/overview", headers=headers)
        assert overview.status_code == 200, overview.text
        body = overview.json()
        assert body["productCount"] == 1
        assert isinstance(body["recentMovements"], list) and body["recentMovements"], "the opening stock shows as a recent movement"

        # The endpoint itself keeps paging through the API.
        page = client.get("/api/inventory/movements?limit=1&offset=0", headers=headers)
        assert page.status_code == 200 and len(page.json()) == 1, page.text
        assert client.get("/api/inventory/movements?offset=-1", headers=headers).status_code == 422

    print("OK: the warehouse summary loads with its recent movements; movement paging still validates offset.")
    TEMP.cleanup()


if __name__ == "__main__":
    run()
