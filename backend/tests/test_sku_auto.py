"""Automatic SKU: an empty code becomes <CATEGORY PREFIX>-<NNNN>, per business, after the highest existing number."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-sku-test-")
os.environ["MANAGER_STOCK_DB"] = str(Path(TEMP.name) / "manager_stock_test.db")
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402
from backend.services.catalog import sku_prefix  # noqa: E402

RETAIL = {"type": "retail", "name": "Tienda SKU", "currency": "COP", "taxRate": 0,
          "features": {"inventory": True, "pos": True, "reservations": False, "tables": False, "rooms": False,
                       "warehouse": False, "services": False, "delivery": False}}


def owner(client: TestClient, email: str) -> dict:
    token = client.post("/api/auth/register", json={"name": "Dueño SKU", "email": email, "password": "PruebaSegura123!"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.put("/api/business/config", headers=headers, json=RETAIL).status_code == 200
    return headers


def product(name: str, category: str = "Bebidas", **extra) -> dict:
    return {"name": name, "category": category, "price": 1000, "cost": 0, "stock": 0, "minStock": 0, **extra}


def run() -> None:
    assert sku_prefix("Bebidas") == "BEB" and sku_prefix("Té") == "TE" and sku_prefix("123") == "PRD" and sku_prefix("Lácteos") == "LAC"

    with TestClient(app) as client:
        h = owner(client, "sku@test.local")
        post = lambda body, headers=h: client.post("/api/products", headers=headers, json=body)  # noqa: E731

        first = post(product("Agua"))
        assert first.status_code == 201, first.text
        assert first.json()["sku"] == "BEB-0001"
        assert post(product("Jugo", sku="")).json()["sku"] == "BEB-0002"
        assert post(product("Malta", sku="beb-0050")).json()["sku"] == "BEB-0050", "a typed code is kept"
        assert post(product("Soda")).json()["sku"] == "BEB-0051", "next after the highest existing number"

        assert client.post("/api/product-categories", headers=h, json={"name": "Té"}).status_code == 201
        assert post(product("Té verde", category="Té")).json()["sku"] == "TE-0001"

        other = owner(client, "sku-otro@test.local")
        assert post(product("Agua"), other).json()["sku"] == "BEB-0001", "each business has its own sequence"

        agua = first.json()
        edited = client.put(f"/api/products/{agua['id']}", headers=h, json=product("Agua grande", sku=""))
        assert edited.status_code == 200 and edited.json()["sku"] == "BEB-0001", edited.text

        assert post(product("Corto", sku="X")).status_code == 422
        # A typed code with an absurd number must not push generated codes past 60 characters.
        assert post(product("Raro", sku="BEB-" + "9" * 56)).status_code == 201
        assert len(post(product("Normal")).json()["sku"]) <= 60

    print("OK: empty SKU is generated per category prefix and business; typed codes are kept.")
    TEMP.cleanup()


if __name__ == "__main__":
    run()
