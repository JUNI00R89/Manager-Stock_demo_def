from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.core.context import current_business_id, current_identity
from backend.core.db import audit, connection, timestamp_iso
from backend.services.inventory import allows_negative_stock, consume_product_stock, resolve_kitchen_requirements, reverse_movements, validate_product_quantity, validate_stock_requirements


router = APIRouter()


@router.get("/api/orders")
def list_orders(status: str | None = None, table_number: int | None = None, open: bool = False):
    with connection() as conn:
        query = "SELECT * FROM orders WHERE business_id=?"
        params: list = [current_business_id()]
        if status:
            query += " AND status=?"
            params.append(status)
        if table_number is not None:
            query += " AND table_number=?"
            params.append(table_number)
        if open:
            query += " AND status NOT IN ('delivered','cancelled')"
        query += " ORDER BY created_at DESC"
        rows = conn.execute(query, params).fetchall()
        result = []
        for row in rows:
            items = conn.execute("SELECT * FROM order_items WHERE order_id=?", (row["id"],)).fetchall()
            order_data = dict(row)
            order_data["created_at"] = timestamp_iso(order_data.get("created_at"))
            order_data["updated_at"] = timestamp_iso(order_data.get("updated_at"))
            result.append({**order_data, "items": [dict(i) for i in items]})
        return result


class OrderItemPayload(BaseModel):
    productId: str
    quantity: float = Field(gt=0)
    notes: str = Field(default="", max_length=300)


class RestaurantMetadata(BaseModel):
    mesaId: str = Field(default="", max_length=100)
    meseroId: str = Field(default="", max_length=100)
    jornada: str = Field(default="", max_length=10)
    directProductIds: list[str] = Field(default_factory=list, max_length=200)


class OrderPayload(BaseModel):
    restaurantMetadata: RestaurantMetadata = Field(default_factory=RestaurantMetadata)
    channel: Literal["counter", "takeaway", "delivery", "table"] = "counter"
    customer: str = Field(default="Cliente general", max_length=120)
    phone: str = Field(default="", max_length=60)
    address: str = Field(default="", max_length=240)
    notes: str = Field(default="", max_length=1000)
    tableNumber: int | None = Field(default=None, ge=1, le=999)
    waiter: str = Field(default="", max_length=80)
    items: list[OrderItemPayload] = Field(min_length=1, max_length=200)


@router.post("/api/orders", status_code=201)
def create_order(payload: OrderPayload):
    order_id = f"PED-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        total = 0.0
        resolved = []
        quantities: dict[str, float] = {}
        for item in payload.items:
            product = conn.execute("SELECT * FROM products WHERE id=? AND business_id=? AND active=1 AND product_type='sale_item'", (item.productId, current_business_id())).fetchone()
            if not product:
                conn.rollback()
                raise HTTPException(404, f"Producto no encontrado: {item.productId}")
            validate_product_quantity(product, item.quantity)
            quantities[item.productId] = round(quantities.get(item.productId, 0.0) + item.quantity, 6)
            total += product["price"] * item.quantity
            resolved.append((item, product))
        direct, ingredients = resolve_kitchen_requirements(conn, quantities)
        combined = {key: round(direct.get(key, 0.0) + ingredients.get(key, 0.0), 6) for key in set(direct) | set(ingredients)}
        try:
            validate_stock_requirements(conn, combined)
        except HTTPException:
            conn.rollback()
            raise
        channel = "table" if payload.tableNumber else payload.channel
        conn.execute("INSERT INTO orders (id,business_id,channel,customer,phone,address,status,notes,total,table_number,waiter) VALUES (?,?,?,?,?,?,'received',?,?,?,?)",
                     (order_id, current_business_id(), channel, payload.customer, payload.phone, payload.address, payload.notes, round(total, 2), payload.tableNumber, payload.waiter.strip()))
        for item, product in resolved:
            conn.execute("INSERT INTO order_items (order_id,product_id,product_name,quantity,unit_price,notes) VALUES (?,?,?,?,?,?)",
                         (order_id, item.productId, product["name"], item.quantity, product["price"], item.notes))
        metadata = payload.restaurantMetadata.model_dump()
        initial_status = "ready" if all(item.productId in metadata["directProductIds"] for item in payload.items) else "received"
        metadata["numero"] = conn.execute("SELECT rowid FROM orders WHERE id=?", (order_id,)).fetchone()[0]
        conn.execute("UPDATE orders SET restaurant_metadata=?,status=? WHERE id=?", (json.dumps(metadata), initial_status, order_id))
        audit(conn, "create", "order", order_id, {"total": total, "channel": channel, "tableNumber": payload.tableNumber, "waiter": payload.waiter.strip()})
        conn.commit()
        return {"id": order_id, "status": initial_status, "total": round(total, 2), "tableNumber": payload.tableNumber, "waiter": payload.waiter.strip(), "createdAt": datetime.now().astimezone().isoformat(timespec="seconds")}


@router.patch("/api/orders/{order_id}/status")
def update_order_status(order_id: str, status: Literal["received", "preparing", "ready", "delivered", "cancelled"], expectedStatus: str | None = None, actorId: str = Query(default="", max_length=100), actorName: str = Query(default="", max_length=120), reason: str = Query(default="", max_length=1000)):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        order = conn.execute("SELECT * FROM orders WHERE id=? AND business_id=?", (order_id, current_business_id())).fetchone()
        if not order:
            conn.rollback()
            raise HTTPException(404, "Pedido no encontrado.")
        if order["sale_id"]:
            raise HTTPException(409, "El pedido ya fue cobrado. Gestiona su venta desde el historial.")
        if expectedStatus is not None and order["status"] != expectedStatus:
            raise HTTPException(409, "El pedido cambió de estado. Actualiza antes de continuar.")
        if order["status"] == "cancelled" and status != "cancelled":
            conn.rollback()
            raise HTTPException(409, "Un pedido cancelado no se puede reactivar.")
        movement_count = 0
        if status == "cancelled" and int(order["stock_consumed"] or 0) == 1:
            movements = conn.execute(
                "SELECT * FROM inventory_movements WHERE order_id=? AND movement_type IN ('consumption','recipe_consumption') ORDER BY id",
                (order_id,),
            ).fetchall()
            reverse_movements(conn, movements, f"Reversión de pedido {order_id}", "adjustment")
            movement_count = len(movements)
            conn.execute("UPDATE orders SET stock_consumed=0 WHERE id=?", (order_id,))
        elif status in ("preparing", "ready", "delivered") and int(order["stock_consumed"] or 0) == 0:
            quantities: dict[str, float] = {}
            for item in conn.execute("SELECT product_id,quantity FROM order_items WHERE order_id=?", (order_id,)).fetchall():
                quantities[item["product_id"]] = round(quantities.get(item["product_id"], 0.0) + float(item["quantity"] or 0), 6)
            direct, ingredients = resolve_kitchen_requirements(conn, quantities)
            combined = {key: round(direct.get(key, 0.0) + ingredients.get(key, 0.0), 6) for key in set(direct) | set(ingredients)}
            try:
                validate_stock_requirements(conn, combined)
            except HTTPException:
                conn.rollback()
                raise
            allow_negative = allows_negative_stock(conn)
            for product_id, quantity in direct.items():
                product = conn.execute("SELECT * FROM products WHERE id=? AND business_id=?", (product_id, current_business_id())).fetchone()
                if product:
                    consume_product_stock(
                        conn, product, quantity, movement_type="consumption",
                        note=f"Consumo pedido {order_id}", order_id=order_id,
                        reference_type="order", reference_id=order_id, allow_negative=allow_negative,
                    )
            for product_id, quantity in ingredients.items():
                product = conn.execute("SELECT * FROM products WHERE id=? AND business_id=?", (product_id, current_business_id())).fetchone()
                if product:
                    consume_product_stock(
                        conn, product, quantity, movement_type="recipe_consumption",
                        note=f"Consumo de receta · pedido {order_id}", order_id=order_id,
                        reference_type="order", reference_id=order_id, allow_negative=allow_negative,
                    )
            conn.execute("UPDATE orders SET stock_consumed=1 WHERE id=?", (order_id,))
        metadata = json.loads(order["restaurant_metadata"] or "{}")
        prefix = {"preparing": "tomado", "ready": "finalizado", "cancelled": "cancelado", "delivered": "entregado"}.get(status)
        if prefix:
            metadata.update({f"{prefix}PorId": actorId or current_identity()["id"], f"{prefix}PorNombre": actorName or current_identity()["name"], f"{prefix}En": datetime.now(timezone.utc).isoformat()})
        if status == "cancelled": metadata["motivoCancelacion"] = reason
        conn.execute("UPDATE orders SET restaurant_metadata=? WHERE id=?", (json.dumps(metadata), order_id))
        conn.execute("UPDATE orders SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND business_id=?", (status, order_id, current_business_id()))
        audit(conn, "status_change", "order", order_id, {"status": status, "restoredMovements": movement_count})
        conn.commit()
        return {"id": order_id, "status": status}


def order_to_dict(conn: sqlite3.Connection, row) -> dict:
    items = conn.execute("SELECT * FROM order_items WHERE order_id=?", (row["id"],)).fetchall()
    order_data = dict(row)
    order_data["created_at"] = timestamp_iso(order_data.get("created_at"))
    order_data["updated_at"] = timestamp_iso(order_data.get("updated_at"))
    return {**order_data, "items": [dict(i) for i in items]}


@router.get("/api/orders/{order_id}")
def get_order(order_id: str):
    with connection() as conn:
        row = conn.execute("SELECT * FROM orders WHERE id=? AND business_id=?", (order_id, current_business_id())).fetchone()
        if not row:
            raise HTTPException(404, "Pedido no encontrado.")
        return order_to_dict(conn, row)


class OrderItemsPayload(BaseModel):
    items: list[OrderItemPayload] = Field(min_length=1, max_length=200)


@router.post("/api/orders/{order_id}/items", status_code=201)
def add_order_items(order_id: str, payload: OrderItemsPayload):
    """Agrega productos a una comanda abierta (la comanda de una mesa crece tras enviarse)."""
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        order = conn.execute("SELECT * FROM orders WHERE id=? AND business_id=?", (order_id, current_business_id())).fetchone()
        if not order:
            conn.rollback()
            raise HTTPException(404, "Pedido no encontrado.")
        if order["status"] not in ("received", "preparing"):
            conn.rollback()
            raise HTTPException(409, "Solo puedes agregar productos a una comanda abierta (recibida o en preparación).")
        total = float(order["total"] or 0)
        resolved = []
        added_quantities: dict[str, float] = {}
        for item in payload.items:
            product = conn.execute("SELECT * FROM products WHERE id=? AND business_id=? AND active=1 AND product_type='sale_item'", (item.productId, current_business_id())).fetchone()
            if not product:
                conn.rollback()
                raise HTTPException(404, f"Producto no encontrado: {item.productId}")
            validate_product_quantity(product, item.quantity)
            added_quantities[item.productId] = round(added_quantities.get(item.productId, 0.0) + item.quantity, 6)
            total += product["price"] * item.quantity
            resolved.append((item, product))
        full_quantities: dict[str, float] = {}
        for item in conn.execute("SELECT product_id,quantity FROM order_items WHERE order_id=?", (order_id,)).fetchall():
            full_quantities[item["product_id"]] = round(full_quantities.get(item["product_id"], 0.0) + float(item["quantity"] or 0), 6)
        for product_id, quantity in added_quantities.items():
            full_quantities[product_id] = round(full_quantities.get(product_id, 0.0) + quantity, 6)
        already_consumed = int(order["stock_consumed"] or 0) == 1
        direct, ingredients = resolve_kitchen_requirements(conn, added_quantities if already_consumed else full_quantities)
        combined = {key: round(direct.get(key, 0.0) + ingredients.get(key, 0.0), 6) for key in set(direct) | set(ingredients)}
        try:
            validate_stock_requirements(conn, combined)
        except HTTPException:
            conn.rollback()
            raise
        for item, product in resolved:
            conn.execute("INSERT INTO order_items (order_id,product_id,product_name,quantity,unit_price,notes) VALUES (?,?,?,?,?,?)",
                         (order_id, item.productId, product["name"], item.quantity, product["price"], item.notes))
        if already_consumed:
            allow_negative = allows_negative_stock(conn)
            for product_id, quantity in direct.items():
                product = conn.execute("SELECT * FROM products WHERE id=? AND business_id=?", (product_id, current_business_id())).fetchone()
                if product:
                    consume_product_stock(
                        conn, product, quantity, movement_type="consumption",
                        note=f"Consumo pedido {order_id}", order_id=order_id,
                        reference_type="order", reference_id=order_id, allow_negative=allow_negative,
                    )
            for product_id, quantity in ingredients.items():
                product = conn.execute("SELECT * FROM products WHERE id=? AND business_id=?", (product_id, current_business_id())).fetchone()
                if product:
                    consume_product_stock(
                        conn, product, quantity, movement_type="recipe_consumption",
                        note=f"Consumo de receta · pedido {order_id}", order_id=order_id,
                        reference_type="order", reference_id=order_id, allow_negative=allow_negative,
                    )
        conn.execute("UPDATE orders SET total=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND business_id=?",
                     (round(total, 2), order_id, current_business_id()))
        audit(conn, "update", "order_items", order_id, {"added": len(resolved), "total": round(total, 2)})
        conn.commit()
        updated = conn.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
        return order_to_dict(conn, updated)
