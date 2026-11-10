"""Business-type change cleanup must never break startup nor lose referenced history."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-cleanup-test-")
os.environ["MANAGER_STOCK_DB"] = str(Path(TEMP.name) / "manager_stock_test.db")
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402
from backend.core.db import connection  # noqa: E402
from backend.main import app  # noqa: E402
from backend.services.business_types import process_due_type_transitions  # noqa: E402

FEATURES = {"inventory": True, "pos": True, "reservations": False, "tables": False, "rooms": False, "warehouse": False, "services": False, "delivery": False}
WAREHOUSE = {"type": "warehouse", "name": "Bodega X", "currency": "COP", "taxRate": 0, "features": {**FEATURES, "pos": False, "warehouse": True}}
RETAIL = {"type": "retail", "name": "Tienda X", "currency": "COP", "taxRate": 0, "features": FEATURES}


def run() -> None:
    with TestClient(app) as client:
        token = client.post("/api/auth/register", json={"name": "Ana Uno", "email": "a@t.local", "password": "PruebaSegura123!"}).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        assert client.put("/api/business/config", headers=headers, json=WAREHOUSE).status_code == 200
        location = client.post("/api/inventory/locations", headers=headers, json={"name": "Estante A", "code": "A1"}).json()
        product = client.post("/api/products", headers=headers, json={"name": "Caja", "sku": "C1", "category": "Otros", "price": 1000,
                                                                      "cost": 500, "stock": 5, "minStock": 1, "defaultLocationId": location["id"]})
        assert product.status_code == 201, product.text
        assert client.put("/api/business/config", headers=headers, json=RETAIL).status_code == 200

    with connection() as conn:
        conn.execute("UPDATE business_type_transitions SET expires_at='2000-01-01T00:00:00+00:00'")

    # A location still referenced by a product (and its stock history) must not crash the cleanup...
    assert process_due_type_transitions() == 1
    with connection() as conn:
        assert conn.execute("SELECT count(*) FROM warehouse_locations WHERE id=?", (location["id"],)).fetchone()[0] == 1, "referenced history is kept"
        assert conn.execute("SELECT status FROM business_type_transitions").fetchone()[0] == "expired"
    # ...and the server must still start.
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200

    print("OK: type-change cleanup keeps referenced history and never blocks startup.")
    TEMP.cleanup()


if __name__ == "__main__":
    run()
