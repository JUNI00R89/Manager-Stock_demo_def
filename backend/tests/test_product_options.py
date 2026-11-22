"""Restaurant add-ons: option groups priced per choice, enforced min/max, extra ingredients discounted, and a snapshot kept on orders and sales."""
from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-options-")
DB = Path(TEMP.name) / "manager_stock_test.db"
os.environ["MANAGER_STOCK_DB"] = str(DB)
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402

PASSWORD = "PruebaSegura123!"
FOOD = {"type": "restaurant", "name": "Comidas Test", "currency": "COP", "taxRate": 0,
        "features": {"inventory": True, "pos": True, "tables": True},
        "foodConfig": {"activeModules": ["menu", "caja", "pedidos", "inventario"]}}


def run() -> None:
    with TestClient(app) as client:
        owner = {"Authorization": "Bearer " + client.post("/api/auth/register", json={"name": "Dueña", "email": "duena@opciones.local", "password": PASSWORD}).json()["access_token"]}
        assert client.put("/api/business/config", headers=owner, json=FOOD).status_code == 200
        business_id = client.get("/api/auth/me", headers=owner).json()["businessId"]
        with closing(sqlite3.connect(DB)) as conn:
            conn.execute("INSERT OR REPLACE INTO business_subscriptions (business_id,plan_id,status) VALUES (?,'entrepreneur','active')", (business_id,))
            conn.commit()
        assert client.post("/api/users", headers=owner, json={"name": "Caja", "email": "caja@opciones.local", "password": PASSWORD, "role": "cashier"}).status_code == 201
        cashier = {"Authorization": "Bearer " + client.post("/api/auth/login", json={"email": "caja@opciones.local", "password": PASSWORD}).json()["access_token"]}

        def product(name, sku, price, stock, **extra):
            response = client.post("/api/products", headers=owner, json={"name": name, "sku": sku, "category": "Comidas rapidas", "price": price, "cost": 4000, "stock": stock, "minStock": 0, **extra})
            assert response.status_code == 201, response.text
            return response.json()["id"]

        def stock(product_id):
            return next(p for p in client.get("/api/products", headers=owner).json() if p["id"] == product_id)["stock"]

        burger = product("Hamburguesa", "HB1", 15000, 50)
        juice = product("Jugo", "JG1", 5000, 50)
        cheese = product("Queso tajado", "ING-QS", 0, 1000, productType="ingredient", unit="g")

        # ── Configuration ──────────────────────────────────────────────────────
        size = client.post("/api/product-options", headers=owner, json={"name": "Tamaño", "minSelect": 1, "maxSelect": 1, "options": [
            {"name": "Sencilla", "priceDelta": 0}, {"name": "Doble", "priceDelta": 6000}]})
        assert size.status_code == 201, size.text
        extras = client.post("/api/product-options", headers=owner, json={"name": "Adicionales", "minSelect": 0, "maxSelect": 1, "options": [
            {"name": "Queso", "priceDelta": 2000, "ingredientId": cheese, "ingredientQuantity": 30}, {"name": "Tocineta", "priceDelta": 3000}]})
        assert extras.status_code == 201, extras.text
        size, extras = size.json(), extras.json()
        single, double = (o["id"] for o in size["options"])
        queso, tocineta = (o["id"] for o in extras["options"])
        assert client.put(f"/api/product-options/links/{burger}", headers=owner, json={"groupIds": [size["id"], extras["id"]]}).status_code == 200
        listed = {g["id"]: g for g in client.get("/api/product-options", headers=cashier).json()}
        assert listed[size["id"]]["productIds"] == [burger], "the cashier reads the options to take orders"
        assert client.post("/api/product-options", headers=cashier, json={"name": "X", "minSelect": 0, "maxSelect": 1, "options": [{"name": "Y", "priceDelta": 0}]}).status_code == 403
        assert client.post("/api/product-options", headers=owner, json={"name": "Mal", "minSelect": 2, "maxSelect": 1, "options": [{"name": "Y", "priceDelta": 0}]}).status_code == 422

        # ── Orders: rules, price, snapshot ─────────────────────────────────────
        def order(options, quantity=1, product_id=burger):
            return client.post("/api/orders", headers=owner, json={"tableNumber": 3, "items": [{"productId": product_id, "quantity": quantity, "options": options}]})

        missing = order([])
        assert missing.status_code == 422 and "Tamaño" in missing.json()["detail"], missing.text
        too_many = order([double, queso, tocineta])
        assert too_many.status_code == 422 and "Adicionales" in too_many.json()["detail"], too_many.text
        assert order([double, single]).status_code == 422, "only one size"
        assert order([queso], product_id=juice).status_code == 422, "options of another product are refused"
        assert order([double, double]).status_code == 422, "the same option twice is refused"

        placed = order([double, queso], quantity=2)
        assert placed.status_code == 201, placed.text
        assert placed.json()["total"] == 46000, placed.json()
        detail = client.get(f"/api/orders/{placed.json()['id']}", headers=owner).json()
        line = detail["items"][0]
        assert line["unit_price"] == 23000 and [o["name"] for o in line["options"]] == ["Doble", "Queso"], line

        # The kitchen takes it: the product and the option's ingredient leave stock.
        assert client.patch(f"/api/orders/{placed.json()['id']}/status?status=preparing", headers=owner).status_code == 200
        assert stock(cheese) == 940 and stock(burger) == 48

        added = client.post(f"/api/orders/{placed.json()['id']}/items", headers=owner, json={"items": [{"productId": burger, "quantity": 1, "options": [single, queso]}]})
        assert added.status_code == 201, added.text
        assert added.json()["total"] == 63000 and stock(cheese) == 910, "an added line consumes its option too"

        # ── Charging the table keeps the agreed price, even if the menu changes later ──
        client.put(f"/api/product-options/{extras['id']}", headers=owner, json={"name": "Adicionales", "minSelect": 0, "maxSelect": 1, "options": [
            {"id": queso, "name": "Queso", "priceDelta": 9999, "ingredientId": cheese, "ingredientQuantity": 30}, {"id": tocineta, "name": "Tocineta", "priceDelta": 3000}]})
        till = client.post("/api/cash/sessions", headers=owner, json={"openingAmount": 0}).json()["id"]
        charged = client.post("/api/sales", headers=owner, json={"idempotencyKey": "cobro-mesa-opciones", "orderIds": [placed.json()["id"]], "paymentMethod": "cash", "cashSessionId": till})
        assert charged.status_code == 201, charged.text
        sale = charged.json()
        assert sale["totalPrice"] == 63000, sale["totalPrice"]
        assert {tuple(o["name"] for o in i["options"]) for i in sale["items"]} == {("Doble", "Queso"), ("Sencilla", "Queso")}, sale["items"]
        assert stock(cheese) == 910 and stock(burger) == 47, "moving the order to the sale does not discount twice"

        # ── Direct POS sale with options, then cancelled ───────────────────────
        pos = client.post("/api/sales", headers=owner, json={"idempotencyKey": "venta-pos-opciones", "items": [{"productId": burger, "quantity": 1, "options": [single, queso]}], "paymentMethod": "cash", "cashSessionId": till})
        assert pos.status_code == 201, pos.text
        assert pos.json()["totalPrice"] == 15000 + 9999, "a new sale uses today's option price"
        assert stock(cheese) == 880
        assert client.post("/api/sales", headers=owner, json={"idempotencyKey": "venta-pos-sin-tamano", "items": [{"productId": burger, "quantity": 1}], "paymentMethod": "cash", "cashSessionId": till}).status_code == 422
        assert client.post(f"/api/sales/{pos.json()['id']}/cancel", headers=owner).status_code == 200
        assert stock(cheese) == 910, "cancelling returns the option's ingredient"

        # Removing a group from the product frees it from the rule.
        assert client.put(f"/api/product-options/links/{burger}", headers=owner, json={"groupIds": []}).status_code == 200
        assert order([]).status_code == 201

    print("OK: add-ons enforce their rules, price each line, discount extra ingredients and keep their snapshot through the sale.")
    TEMP.cleanup()


if __name__ == "__main__":
    run()
