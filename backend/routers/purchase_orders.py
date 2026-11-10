from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.core.context import current_business_id, current_identity
from backend.core.db import audit, connection, timestamp_iso
from backend.services.inventory import add_product_stock, convert_quantity, current_operator, fetch_inventory_product, inventory_settings, new_inventory_operation, normalize_date, require_inventory_location


router = APIRouter()


def purchase_order_out(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    supplier = conn.execute(
        "SELECT * FROM suppliers WHERE id=? AND business_id=?", (row["supplier_id"], current_business_id())
    ).fetchone()
    items = []
    total = 0.0
    for item in conn.execute(
        """SELECT poi.*, p.name AS product_name, p.sku, p.unit AS product_unit
           FROM purchase_order_items poi JOIN products p ON p.id=poi.product_id
           WHERE poi.purchase_order_id=? ORDER BY poi.id""",
        (row["id"],),
    ).fetchall():
        pending = max(0.0, round(float(item["quantity_ordered"] or 0) - float(item["quantity_received"] or 0), 6))
        total += float(item["quantity_ordered"] or 0) * float(item["unit_cost"] or 0)
        items.append({
            "id": item["id"], "productId": item["product_id"], "productName": item["product_name"],
            "sku": item["sku"], "productUnit": item["product_unit"], "unit": item["unit"] or item["product_unit"],
            "quantityOrdered": float(item["quantity_ordered"] or 0),
            "quantityReceived": float(item["quantity_received"] or 0),
            "pendingQuantity": pending, "unitCost": float(item["unit_cost"] or 0),
            "lineTotal": round(float(item["quantity_ordered"] or 0) * float(item["unit_cost"] or 0), 2),
        })
    return {
        "id": row["id"], "supplierId": row["supplier_id"],
        "supplierName": supplier["company"] if supplier else "", "supplierContact": supplier["name"] if supplier else "",
        "status": row["status"], "expectedDate": row["expected_date"], "notes": row["notes"],
        "createdBy": row["created_by"], "createdByName": row["created_by_name"],
        "approvedBy": row["approved_by"], "approvedAt": timestamp_iso(row["approved_at"]),
        "createdAt": timestamp_iso(row["created_at"]), "updatedAt": timestamp_iso(row["updated_at"]),
        "total": round(total, 2), "items": items,
        "pendingLines": len([item for item in items if item["pendingQuantity"] > 0]),
    }


class PurchaseOrderItemPayload(BaseModel):
    productId: str
    quantity: float = Field(gt=0, le=100000000)
    unitCost: float = Field(default=0, ge=0, le=100000000)
    unit: str = Field(default="", max_length=32)


class PurchaseOrderPayload(BaseModel):
    supplierId: str
    expectedDate: str | None = None
    notes: str = Field(default="", max_length=1000)
    items: list[PurchaseOrderItemPayload] = Field(min_length=1, max_length=200)


class PurchaseOrderReceiveItemPayload(BaseModel):
    itemId: int
    quantity: float = Field(gt=0, le=100000000)
    unit: str = Field(default="", max_length=32)
    unitCost: float | None = Field(default=None, ge=0, le=100000000)
    lotCode: str = Field(default="", max_length=80)
    expiryDate: str | None = None
    locationId: str | None = None


class PurchaseOrderReceivePayload(BaseModel):
    invoiceRef: str = Field(default="", max_length=120)
    notes: str = Field(default="", max_length=1000)
    items: list[PurchaseOrderReceiveItemPayload] = Field(min_length=1, max_length=200)


@router.get("/api/inventory/purchase-orders")
def list_purchase_orders(status: str | None = None, supplierId: str | None = None, search: str = ""):
    with connection() as conn:
        query = """SELECT po.* FROM purchase_orders po
                   LEFT JOIN suppliers s ON s.id=po.supplier_id
                   WHERE po.business_id=?"""
        params: list = [current_business_id()]
        if status:
            query += " AND po.status=?"
            params.append(status)
        if supplierId:
            query += " AND po.supplier_id=?"
            params.append(supplierId)
        if search:
            term = f"%{search.lower()}%"
            query += " AND (lower(po.id) LIKE ? OR lower(s.company) LIKE ? OR lower(po.notes) LIKE ?)"
            params.extend([term, term, term])
        rows = conn.execute(query + " ORDER BY po.created_at DESC, po.id DESC", params).fetchall()
        return [purchase_order_out(conn, row) for row in rows]


@router.post("/api/inventory/purchase-orders", status_code=201)
def create_purchase_order(payload: PurchaseOrderPayload):
    order_id = f"OC-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            supplier = conn.execute(
                "SELECT id FROM suppliers WHERE id=? AND business_id=? AND active=1",
                (payload.supplierId, current_business_id()),
            ).fetchone()
            if not supplier:
                raise HTTPException(422, "El proveedor seleccionado no está activo en este negocio.")
            products: dict[str, sqlite3.Row] = {}
            for item in payload.items:
                product = fetch_inventory_product(conn, item.productId)
                products[item.productId] = product
            user_id, user_name = current_operator()
            conn.execute(
                """INSERT INTO purchase_orders (id,business_id,supplier_id,status,expected_date,notes,created_by,created_by_name)
                   VALUES (?,?,?,'draft',?,?,?,?)""",
                (order_id, current_business_id(), payload.supplierId, normalize_date(payload.expectedDate),
                 payload.notes.strip(), user_id, user_name),
            )
            for item in payload.items:
                product = products[item.productId]
                conn.execute(
                    """INSERT INTO purchase_order_items (purchase_order_id,product_id,quantity_ordered,unit_cost,unit)
                       VALUES (?,?,?,?,?)""",
                    (order_id, item.productId, item.quantity, item.unitCost, item.unit or product["unit"]),
                )
            audit(conn, "create", "purchase_order", order_id, {"supplierId": payload.supplierId, "items": len(payload.items)})
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        row = conn.execute("SELECT * FROM purchase_orders WHERE id=?", (order_id,)).fetchone()
        return purchase_order_out(conn, row)


@router.post("/api/inventory/purchase-orders/{order_id}/approve")
def approve_purchase_order(order_id: str):
    with connection() as conn:
        row = conn.execute(
            "SELECT * FROM purchase_orders WHERE id=? AND business_id=?", (order_id, current_business_id())
        ).fetchone()
        if not row:
            raise HTTPException(404, "Orden de compra no encontrada.")
        if row["status"] in ("received", "cancelled"):
            raise HTTPException(409, "La orden ya está cerrada.")
        _, user_name = current_operator()
        conn.execute(
            "UPDATE purchase_orders SET approved_by=?, approved_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (user_name, order_id),
        )
        audit(conn, "approve", "purchase_order", order_id)
        row = conn.execute("SELECT * FROM purchase_orders WHERE id=?", (order_id,)).fetchone()
        return purchase_order_out(conn, row)


@router.post("/api/inventory/purchase-orders/{order_id}/send")
def send_purchase_order(order_id: str):
    with connection() as conn:
        row = conn.execute(
            "SELECT * FROM purchase_orders WHERE id=? AND business_id=?", (order_id, current_business_id())
        ).fetchone()
        if not row:
            raise HTTPException(404, "Orden de compra no encontrada.")
        if row["status"] in ("received", "cancelled"):
            raise HTTPException(409, "La orden ya está cerrada.")
        conn.execute(
            "UPDATE purchase_orders SET status='sent', updated_at=CURRENT_TIMESTAMP WHERE id=?", (order_id,)
        )
        audit(conn, "send", "purchase_order", order_id)
        row = conn.execute("SELECT * FROM purchase_orders WHERE id=?", (order_id,)).fetchone()
        return purchase_order_out(conn, row)


@router.post("/api/inventory/purchase-orders/{order_id}/receive")
def receive_purchase_order(order_id: str, payload: PurchaseOrderReceivePayload):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = conn.execute(
                "SELECT * FROM purchase_orders WHERE id=? AND business_id=?", (order_id, current_business_id())
            ).fetchone()
            if not row:
                raise HTTPException(404, "Orden de compra no encontrada.")
            if row["status"] not in ("sent", "partial"):
                raise HTTPException(409, "Solo puedes recibir una orden enviada o parcialmente recibida.")
            operation_id = new_inventory_operation(
                conn, "purchase", supplier_id=row["supplier_id"], reference=order_id,
                invoice_ref=payload.invoiceRef.strip(), notes=payload.notes.strip(), reason="Recepción de orden de compra",
            )
            for entry in payload.items:
                item = conn.execute(
                    "SELECT * FROM purchase_order_items WHERE id=? AND purchase_order_id=?",
                    (entry.itemId, order_id),
                ).fetchone()
                if not item:
                    raise HTTPException(404, f"No se encontró la línea {entry.itemId} en la orden.")
                product = fetch_inventory_product(conn, item["product_id"])
                quantity = convert_quantity(entry.quantity, entry.unit or item["unit"] or product["unit"], product["unit"])
                if quantity <= 0:
                    raise HTTPException(422, "La cantidad recibida debe ser mayor que cero.")
                remaining = round(float(item["quantity_ordered"] or 0) - float(item["quantity_received"] or 0), 6)
                if quantity > remaining + 1e-9:
                    raise HTTPException(422, f"La cantidad recibida de {product['name']} supera lo pendiente ({remaining:g}).")
                unit_cost = float(entry.unitCost if entry.unitCost is not None else item["unit_cost"] or product["cost"] or 0)
                location_id = entry.locationId or product["default_location_id"] or inventory_settings(conn).get("defaultLocationId")
                if location_id:
                    require_inventory_location(conn, location_id)
                add_product_stock(
                    conn, product, quantity, movement_type="purchase", note=f"Recepción {order_id}",
                    reason="Recepción de orden de compra", unit_cost=unit_cost,
                    lot_code=entry.lotCode.strip(), expiry_date=normalize_date(entry.expiryDate),
                    location_id=location_id, operation_id=operation_id, reference_type="purchase_order",
                    reference_id=order_id,
                )
                conn.execute(
                    "UPDATE purchase_order_items SET quantity_received=quantity_received+?, unit_cost=? WHERE id=?",
                    (quantity, unit_cost, item["id"]),
                )
                if unit_cost > 0:
                    conn.execute(
                        "UPDATE products SET cost=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                        (unit_cost, product["id"]),
                    )
                    conn.execute(
                        """INSERT INTO supplier_price_history
                           (business_id,supplier_id,product_id,unit_cost,source,reference_type,reference_id,created_by)
                           VALUES (?,?,?,?,?,?,?,?)""",
                        (current_business_id(), row["supplier_id"], product["id"], unit_cost,
                         "purchase_order", "purchase_order", order_id, current_identity()["id"]),
                    )
            totals = conn.execute(
                """SELECT COALESCE(SUM(quantity_ordered),0) AS ordered, COALESCE(SUM(quantity_received),0) AS received
                   FROM purchase_order_items WHERE purchase_order_id=?""",
                (order_id,),
            ).fetchone()
            status = "received" if float(totals["received"] or 0) + 1e-9 >= float(totals["ordered"] or 0) else "partial"
            conn.execute(
                "UPDATE purchase_orders SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (status, order_id)
            )
            audit(conn, "receive", "purchase_order", order_id, {"status": status, "items": len(payload.items), "operationId": operation_id})
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        row = conn.execute("SELECT * FROM purchase_orders WHERE id=?", (order_id,)).fetchone()
        result = purchase_order_out(conn, row)
        result["operationId"] = operation_id
        return result


@router.post("/api/inventory/purchase-orders/{order_id}/cancel")
def cancel_purchase_order(order_id: str):
    with connection() as conn:
        row = conn.execute(
            "SELECT * FROM purchase_orders WHERE id=? AND business_id=?", (order_id, current_business_id())
        ).fetchone()
        if not row:
            raise HTTPException(404, "Orden de compra no encontrada.")
        if row["status"] in ("received", "partial"):
            raise HTTPException(409, "No puedes cancelar una orden con mercancía recibida.")
        conn.execute(
            "UPDATE purchase_orders SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE id=?", (order_id,)
        )
        audit(conn, "cancel", "purchase_order", order_id)
        row = conn.execute("SELECT * FROM purchase_orders WHERE id=?", (order_id,)).fetchone()
        return purchase_order_out(conn, row)
