"""Fiado: credit sales need a registered customer within the limit the owner set; abonos go through the till; returns and cancellations lower the debt."""
from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-credit-")
DB = Path(TEMP.name) / "manager_stock_test.db"
os.environ["MANAGER_STOCK_DB"] = str(DB)
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402

PASSWORD = "PruebaSegura123!"
RETAIL = {"type": "retail", "name": "Tienda Fiado", "currency": "COP", "taxRate": 0,
          "features": {"inventory": True, "pos": True, "reservations": False, "tables": False, "rooms": False,
                       "warehouse": False, "services": False, "delivery": False}}


def run() -> None:
    with TestClient(app) as client:
        owner = {"Authorization": "Bearer " + client.post("/api/auth/register", json={"name": "Dueña", "email": "duena@fiado.local", "password": PASSWORD}).json()["access_token"]}
        assert client.put("/api/business/config", headers=owner, json=RETAIL).status_code == 200
        business_id = client.get("/api/auth/me", headers=owner).json()["businessId"]
        with closing(sqlite3.connect(DB)) as conn:
            conn.execute("INSERT OR REPLACE INTO business_subscriptions (business_id,plan_id,status) VALUES (?,'entrepreneur','active')", (business_id,))
            conn.commit()
        assert client.post("/api/users", headers=owner, json={"name": "Caja", "email": "caja@fiado.local", "password": PASSWORD, "role": "cashier"}).status_code == 201
        cashier = {"Authorization": "Bearer " + client.post("/api/auth/login", json={"email": "caja@fiado.local", "password": PASSWORD}).json()["access_token"]}
        product = client.post("/api/products", headers=owner, json={"name": "Arroz", "sku": "AR1", "category": "Bebidas", "price": 10000, "cost": 6000, "stock": 100, "minStock": 1}).json()
        assert "id" in product, product
        customer = client.post("/api/customers", headers=owner, json={"name": "Don Pedro", "documentType": "CC", "documentNumber": "2020"}).json()
        assert customer["creditLimit"] == 0
        till = client.post("/api/cash/sessions", headers=cashier, json={"openingAmount": 0}).json()

        def sell(key, quantity, method="credit", payments=None, customer_id=customer["id"]):
            return client.post("/api/sales", headers=cashier, json={
                "idempotencyKey": f"fiado-{key}", "items": [{"productId": product["id"], "quantity": quantity}],
                "paymentMethod": method, "payments": payments or [], "customerId": customer_id, "cashSessionId": till["id"]})

        def credit():
            response = client.get(f"/api/customers/{customer['id']}/credit", headers=cashier)
            assert response.status_code == 200, response.text
            return response.json()

        no_customer = sell("sin-cliente", 1, customer_id=None)
        assert no_customer.status_code == 422 and "cliente" in no_customer.json()["detail"].lower(), no_customer.text
        no_limit = sell("sin-cupo", 1)
        assert no_limit.status_code == 409 and "cupo" in no_limit.json()["detail"].lower(), no_limit.text

        limit_url = f"/api/customers/{customer['id']}/credit-limit"
        assert client.put(limit_url, headers=cashier, json={"creditLimit": 50000}).status_code == 403, "only owner/admin set the limit"
        assert client.put(limit_url, headers=owner, json={"creditLimit": 50000}).json()["creditLimit"] == 50000

        first = sell("primera", 3)
        assert first.status_code == 201, first.text
        assert credit()["balance"] == 30000 and credit()["available"] == 20000
        over = sell("excede", 3)
        assert over.status_code == 409 and "cupo" in over.json()["detail"].lower(), over.text
        mixed = sell("mixta", 3, "split", [{"method": "cash", "amount": 10000}, {"method": "credit", "amount": 20000}])
        assert mixed.status_code == 201, mixed.text
        assert credit()["balance"] == 50000

        current = client.get("/api/cash/sessions/current", headers=cashier).json()
        assert current["expectedAmount"] == 10000, "credit is not cash in the drawer"
        assert any(r["method"] == "credit" and r["amount"] == 50000 for r in current["breakdown"]), current["breakdown"]

        pay_url = f"/api/customers/{customer['id']}/credit-payments"
        abono = {"idempotencyKey": "abono-0001", "amount": 15000, "method": "cash", "cashSessionId": till["id"]}
        paid = client.post(pay_url, headers=cashier, json=abono)
        assert paid.status_code == 201, paid.text
        assert client.post(pay_url, headers=cashier, json=abono).status_code in (200, 201), "a retry returns the same abono"
        assert credit()["balance"] == 35000, "the retry did not charge twice"
        assert client.post(pay_url, headers=cashier, json={**abono, "amount": 20000}).status_code == 409, "same key, other content"
        too_much = client.post(pay_url, headers=cashier, json={**abono, "idempotencyKey": "abono-0002", "amount": 35001})
        assert too_much.status_code == 422, too_much.text
        nequi = client.post(pay_url, headers=cashier, json={"idempotencyKey": "abono-0003", "amount": 5000, "method": "digital", "provider": "nequi", "cashSessionId": till["id"]})
        assert nequi.status_code == 201, nequi.text
        assert client.get("/api/cash/sessions/current", headers=cashier).json()["expectedAmount"] == 25000, "cash abono enters the till"
        history = credit()
        assert history["balance"] == 30000
        assert [m["type"] for m in history["movements"]].count("payment") == 2 and [m["type"] for m in history["movements"]].count("sale") == 2

        assert client.post(pay_url, headers=owner, json={**abono, "idempotencyKey": "abono-0004", "amount": 1000, "cashSessionId": None}).status_code == 409, "abonos need an open till"

        # Returning a credit line lowers the debt; cancelling a credit sale removes it.
        sale = first.json()
        item = sale["items"][0]
        owner_till = client.post("/api/cash/sessions", headers=owner, json={"openingAmount": 50000}).json()["id"]
        refund = client.post(f"/api/sales/{sale['id']}/returns", headers=owner, json={
            "idempotencyKey": "devolucion-fiado-1", "cashSessionId": owner_till,
            "reason": "Producto en mal estado", "items": [{"itemId": item["id"], "quantity": 1, "restock": True}],
            "payments": [{"method": "credit", "amount": 10000}], "expectedTotal": 10000})
        assert refund.status_code == 201, refund.text
        assert credit()["balance"] == 20000
        cancelled = client.post(f"/api/sales/{mixed.json()['id']}/cancel", headers=owner)
        assert cancelled.status_code == 200, cancelled.text
        assert credit()["balance"] == 0
        # Already paid off: what was sold on credit is now refunded in cash, never pushed into a negative balance.
        quote = client.post(f"/api/sales/{sale['id']}/returns/quote", headers=owner, json={"items": [{"itemId": item["id"], "quantity": 1, "restock": True}]}).json()
        assert quote["availablePayments"] == {"cash": 20000}, quote["availablePayments"]
        cash_back = client.post(f"/api/sales/{sale['id']}/returns", headers=owner, json={
            "idempotencyKey": "devolucion-fiado-2", "cashSessionId": owner_till, "reason": "Cliente ya pagó y devuelve",
            "items": [{"itemId": item["id"], "quantity": 1, "restock": True}], "payments": [{"method": "cash", "amount": 10000}], "expectedTotal": 10000})
        assert cash_back.status_code == 201, cash_back.text
        assert credit()["balance"] == 0, "a cash refund does not touch the debt"
        listed = next(c for c in client.get("/api/customers", headers=owner).json() if c["id"] == customer["id"])
        assert listed["creditBalance"] == 0 and listed["creditLimit"] == 50000

    print("OK: fiado respects the customer's limit, abonos go through the till once, returns and cancellations lower the debt.")
    TEMP.cleanup()


if __name__ == "__main__":
    run()
