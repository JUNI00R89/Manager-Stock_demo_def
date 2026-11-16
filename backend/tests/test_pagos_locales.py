"""Local digital payments: Nequi/Daviplata/Bre-B provider is required, reference is optional, and the till shows the breakdown."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-pagos-locales-")
os.environ["MANAGER_STOCK_DB"] = str(Path(TEMP.name) / "manager_stock_test.db")
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402

RETAIL = {"type": "retail", "name": "Tienda Pagos", "currency": "COP", "taxRate": 0,
          "features": {"inventory": True, "pos": True, "reservations": False, "tables": False, "rooms": False,
                       "warehouse": False, "services": False, "delivery": False}}


def run() -> None:
    with TestClient(app) as client:
        token = client.post("/api/auth/register", json={"name": "Dueña Pagos", "email": "pagos@test.local", "password": "PruebaSegura123!"}).json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}
        assert client.put("/api/business/config", headers=h, json=RETAIL).status_code == 200
        product = client.post("/api/products", headers=h, json={"name": "Café", "sku": "CF1", "category": "Bebidas", "price": 9000, "cost": 3000, "stock": 50, "minStock": 1}).json()
        session = client.post("/api/cash/sessions", headers=h, json={"openingAmount": 0}).json()["id"]
        item = [{"productId": product["id"], "quantity": 1}]
        sale = lambda key, **extra: client.post("/api/sales", headers=h, json={"idempotencyKey": key, "items": item, "cashSessionId": session, **extra})  # noqa: E731

        missing = sale("pago-digital-0", paymentMethod="digital")
        assert missing.status_code == 422 and "proveedor" in missing.text.lower(), missing.text

        nequi = sale("pago-digital-1", paymentMethod="digital", paymentProvider="nequi", paymentReference=" 123456 ")
        assert nequi.status_code == 201, nequi.text
        assert nequi.json()["payments"] == [{"method": "digital", "amount": 9000, "provider": "nequi", "reference": "123456"}]

        assert sale("pago-digital-2", paymentMethod="digital", paymentProvider="breb").status_code == 201, "reference is optional"
        assert sale("pago-digital-3", paymentMethod="digital", paymentProvider="paypal").status_code == 422
        assert sale("pago-digital-4", paymentMethod="digital", paymentProvider="nequi", paymentReference="9" * 61).status_code == 422

        split = sale("pago-dividido-1", paymentMethod="split", payments=[{"method": "cash", "amount": 5000}, {"method": "digital", "amount": 4000, "provider": "daviplata", "reference": "DV-77"}])
        assert split.status_code == 201, split.text
        assert {"method": "digital", "amount": 4000, "provider": "daviplata", "reference": "DV-77"} in split.json()["payments"]
        assert sale("pago-dividido-2", paymentMethod="split", payments=[{"method": "cash", "amount": 5000}, {"method": "digital", "amount": 4000}]).status_code == 422

        # Tables send one explicit part: the provider travels in the part, not at the top level.
        one_part = sale("pago-mesa-1", paymentMethod="digital", payments=[{"method": "digital", "amount": 9000, "provider": "nequi"}])
        assert one_part.status_code == 201, one_part.text

        card = sale("pago-tarjeta-1", paymentMethod="card", paymentProvider="nequi")
        assert card.status_code == 201 and card.json()["payments"][0]["provider"] is None, "provider only applies to digital"

        current = client.get("/api/cash/sessions/current", headers=h).json()
        breakdown = {(row["method"], row["provider"]): row["amount"] for row in current["breakdown"]}
        assert breakdown == {("digital", "nequi"): 18000, ("digital", "breb"): 9000, ("cash", None): 5000,
                             ("digital", "daviplata"): 4000, ("card", None): 9000}, breakdown

    print("OK: digital payments carry Nequi/Daviplata/Bre-B and an optional reference; the till shows the breakdown.")
    TEMP.cleanup()


if __name__ == "__main__":
    run()
