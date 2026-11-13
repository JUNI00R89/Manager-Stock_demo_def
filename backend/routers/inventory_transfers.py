from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.core.context import current_business_id
from backend.core.db import audit, connection, timestamp_iso
from backend.services.inventory import add_product_stock, allows_negative_stock, consume_product_stock, convert_quantity, current_operator, fetch_inventory_product, new_inventory_operation, require_inventory_location, reverse_movements


router = APIRouter()


def transfer_record_out(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    origin = conn.execute("SELECT * FROM warehouse_locations WHERE id=?", (row["origin_location_id"],)).fetchone()
    destination = conn.execute("SELECT * FROM warehouse_locations WHERE id=?", (row["destination_location_id"],)).fetchone()
    items = []
    for item in conn.execute(
        """SELECT ti.*, p.name AS product_name, p.sku, p.unit AS product_unit
           FROM inventory_transfer_items ti JOIN products p ON p.id=ti.product_id
           WHERE ti.transfer_id=? ORDER BY ti.id""",
        (row["id"],),
    ).fetchall():
        allocations = conn.execute(
            "SELECT * FROM inventory_transfer_allocations WHERE transfer_item_id=? ORDER BY id",
            (item["id"],),
        ).fetchall()
        items.append({
            "id": item["id"], "productId": item["product_id"], "productName": item["product_name"],
            "sku": item["sku"], "productUnit": item["product_unit"], "quantity": float(item["quantity"] or 0),
            "lotId": item["lot_id"], "lotCode": item["lot_code"], "expiryDate": item["expiry_date"],
            "unitCost": float(item["unit_cost"] or 0),
            "allocations": [{
                "id": allocation["id"], "lotCode": allocation["lot_code"],
                "expiryDate": allocation["expiry_date"], "quantity": float(allocation["quantity"] or 0),
                "unitCost": float(allocation["unit_cost"] or 0),
            } for allocation in allocations],
        })
    return {
        "id": row["id"], "status": row["status"], "notes": row["notes"],
        "originLocationId": row["origin_location_id"], "originCode": origin["code"] if origin else None,
        "originName": origin["name"] if origin else None,
        "destinationLocationId": row["destination_location_id"],
        "destinationCode": destination["code"] if destination else None,
        "destinationName": destination["name"] if destination else None,
        "createdBy": row["created_by"], "createdByName": row["created_by_name"],
        "createdAt": timestamp_iso(row["created_at"]), "sentAt": timestamp_iso(row["sent_at"]),
        "receivedAt": timestamp_iso(row["received_at"]), "items": items,
        "totalUnits": round(sum(float(item["quantity"] or 0) for item in items), 6),
        "totalCost": round(sum(float(item["quantity"] or 0) * float(item["unit_cost"] or 0) for item in items), 2),
    }


class TransferItemPayload(BaseModel):
    productId: str
    quantity: float = Field(gt=0, le=100000000)
    unit: str = Field(default="", max_length=32)
    lotId: str | None = None


class TransferPayload(BaseModel):
    originLocationId: str
    destinationLocationId: str
    notes: str = Field(default="", max_length=1000)
    items: list[TransferItemPayload] = Field(min_length=1, max_length=500)


@router.get("/api/inventory/transfers")
def list_inventory_transfers(status: str | None = None):
    with connection() as conn:
        query = "SELECT * FROM inventory_transfers WHERE business_id=?"
        params: list = [current_business_id()]
        if status:
            query += " AND status=?"
            params.append(status)
        rows = conn.execute(query + " ORDER BY created_at DESC, id DESC", params).fetchall()
        return [transfer_record_out(conn, row) for row in rows]


@router.post("/api/inventory/transfers", status_code=201)
def create_inventory_transfer(payload: TransferPayload):
    transfer_id = f"TRF-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            origin = require_inventory_location(conn, payload.originLocationId, allow_empty=False)
            destination = require_inventory_location(conn, payload.destinationLocationId, allow_empty=False)
            if origin["id"] == destination["id"]:
                raise HTTPException(422, "La ubicación de origen y destino deben ser diferentes.")
            user_id, user_name = current_operator()
            conn.execute(
                """INSERT INTO inventory_transfers (id,business_id,origin_location_id,destination_location_id,status,notes,created_by,created_by_name)
                   VALUES (?,?,?,?,'draft',?,?,?)""",
                (transfer_id, current_business_id(), origin["id"], destination["id"], payload.notes.strip(), user_id, user_name),
            )
            for item in payload.items:
                product = fetch_inventory_product(conn, item.productId)
                quantity = convert_quantity(item.quantity, item.unit or product["unit"], product["unit"])
                if quantity <= 0:
                    raise HTTPException(422, "La cantidad a transferir debe ser mayor que cero.")
                lot_code = ""
                expiry_date = None
                unit_cost = float(product["cost"] or 0)
                if item.lotId:
                    lot = conn.execute(
                        "SELECT * FROM product_lots WHERE id=? AND business_id=? AND product_id=?",
                        (item.lotId, current_business_id(), product["id"]),
                    ).fetchone()
                    if not lot:
                        raise HTTPException(422, "El lote seleccionado no es válido para el producto.")
                    lot_code = lot["lot_code"]
                    expiry_date = lot["expiry_date"]
                    unit_cost = float(lot["unit_cost"] or unit_cost)
                conn.execute(
                    """INSERT INTO inventory_transfer_items (transfer_id,product_id,quantity,lot_id,lot_code,expiry_date,unit_cost)
                       VALUES (?,?,?,?,?,?,?)""",
                    (transfer_id, product["id"], quantity, item.lotId, lot_code, expiry_date, unit_cost),
                )
            audit(conn, "create", "inventory_transfer", transfer_id, {"items": len(payload.items)})
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        row = conn.execute("SELECT * FROM inventory_transfers WHERE id=?", (transfer_id,)).fetchone()
        return transfer_record_out(conn, row)


@router.post("/api/inventory/transfers/{transfer_id}/send")
def send_inventory_transfer(transfer_id: str):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = conn.execute(
                "SELECT * FROM inventory_transfers WHERE id=? AND business_id=?", (transfer_id, current_business_id())
            ).fetchone()
            if not row:
                raise HTTPException(404, "Transferencia no encontrada.")
            if row["status"] != "draft":
                raise HTTPException(409, "Solo puedes enviar una transferencia en borrador.")
            operation_id = new_inventory_operation(
                conn, "transfer", reason="Transferencia entre ubicaciones", reference=transfer_id,
                notes=row["notes"],
            )
            allow_negative = allows_negative_stock(conn)
            for item in conn.execute("SELECT * FROM inventory_transfer_items WHERE transfer_id=? ORDER BY id", (transfer_id,)).fetchall():
                product = fetch_inventory_product(conn, item["product_id"])
                lot_total = float(conn.execute(
                    "SELECT COALESCE(SUM(quantity),0) FROM product_lots WHERE business_id=? AND product_id=?",
                    (current_business_id(), product["id"]),
                ).fetchone()[0] or 0)
                if lot_total > 0:
                    origin_available = float(conn.execute(
                        """SELECT COALESCE(SUM(quantity),0) FROM product_lots
                           WHERE business_id=? AND product_id=? AND (location_id=? OR location_id IS NULL)""",
                        (current_business_id(), product["id"], row["origin_location_id"]),
                    ).fetchone()[0] or 0)
                    if origin_available + 1e-9 < float(item["quantity"]):
                        raise HTTPException(409, f"No hay existencias suficientes de {product['name']} en la ubicación de origen.")
                movements = consume_product_stock(
                    conn, product, float(item["quantity"]), movement_type="transfer_out",
                    note=f"Transferencia {transfer_id}", reason="Transferencia entre ubicaciones",
                    operation_id=operation_id, reference_type="inventory_transfer", reference_id=transfer_id,
                    lot_id=item["lot_id"], allow_negative=allow_negative, location_id=row["origin_location_id"],
                )
                for movement in movements:
                    conn.execute(
                        """INSERT INTO inventory_transfer_allocations (transfer_item_id,lot_code,expiry_date,quantity,unit_cost)
                           VALUES (?,?,?,?,?)""",
                        (item["id"], movement.get("lotCode") or item["lot_code"] or "",
                         movement.get("expiryDate") or item["expiry_date"], abs(float(movement["quantity"])),
                         float(movement.get("unitCost") or item["unit_cost"] or 0)),
                    )
            conn.execute(
                "UPDATE inventory_transfers SET status='in_transit', sent_at=CURRENT_TIMESTAMP WHERE id=?",
                (transfer_id,),
            )
            audit(conn, "send", "inventory_transfer", transfer_id, {"operationId": operation_id})
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        row = conn.execute("SELECT * FROM inventory_transfers WHERE id=?", (transfer_id,)).fetchone()
        return transfer_record_out(conn, row)


@router.post("/api/inventory/transfers/{transfer_id}/receive")
def receive_inventory_transfer(transfer_id: str):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = conn.execute(
                "SELECT * FROM inventory_transfers WHERE id=? AND business_id=?", (transfer_id, current_business_id())
            ).fetchone()
            if not row:
                raise HTTPException(404, "Transferencia no encontrada.")
            if row["status"] != "in_transit":
                raise HTTPException(409, "Solo puedes recibir una transferencia en tránsito.")
            operation_id = new_inventory_operation(
                conn, "transfer", reason="Recepción de transferencia", reference=transfer_id,
                notes=row["notes"],
            )
            for item in conn.execute("SELECT * FROM inventory_transfer_items WHERE transfer_id=? ORDER BY id", (transfer_id,)).fetchall():
                product = fetch_inventory_product(conn, item["product_id"])
                allocations = conn.execute(
                    "SELECT * FROM inventory_transfer_allocations WHERE transfer_item_id=? ORDER BY id",
                    (item["id"],),
                ).fetchall()
                if not allocations:
                    allocations = [{"lot_code": item["lot_code"], "expiry_date": item["expiry_date"], "quantity": item["quantity"], "unit_cost": item["unit_cost"]}]
                for allocation in allocations:
                    add_product_stock(
                        conn, product, float(allocation["quantity"]), movement_type="transfer_in",
                        note=f"Recepción transferencia {transfer_id}", reason="Recepción de transferencia",
                        unit_cost=float(allocation["unit_cost"] or 0), lot_code=allocation["lot_code"] or "",
                        expiry_date=allocation["expiry_date"], location_id=row["destination_location_id"],
                        operation_id=operation_id, reference_type="inventory_transfer", reference_id=transfer_id,
                    )
            conn.execute(
                "UPDATE inventory_transfers SET status='received', received_at=CURRENT_TIMESTAMP WHERE id=?",
                (transfer_id,),
            )
            audit(conn, "receive", "inventory_transfer", transfer_id, {"operationId": operation_id})
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        row = conn.execute("SELECT * FROM inventory_transfers WHERE id=?", (transfer_id,)).fetchone()
        result = transfer_record_out(conn, row)
        result["operationId"] = operation_id
        return result


@router.post("/api/inventory/transfers/{transfer_id}/cancel")
def cancel_inventory_transfer(transfer_id: str):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = conn.execute(
                "SELECT * FROM inventory_transfers WHERE id=? AND business_id=?", (transfer_id, current_business_id())
            ).fetchone()
            if not row:
                raise HTTPException(404, "Transferencia no encontrada.")
            if row["status"] == "received":
                raise HTTPException(409, "No puedes cancelar una transferencia ya recibida.")
            if row["status"] == "cancelled":
                conn.commit()
                return transfer_record_out(conn, row)
            if row["status"] == "in_transit":
                movements = conn.execute(
                    """SELECT * FROM inventory_movements
                       WHERE business_id=? AND reference_type='inventory_transfer' AND reference_id=? AND movement_type='transfer_out'""",
                    (current_business_id(), transfer_id),
                ).fetchall()
                reverse_movements(conn, movements, f"Cancelación transferencia {transfer_id}", "adjustment")
            conn.execute("UPDATE inventory_transfers SET status='cancelled' WHERE id=?", (transfer_id,))
            audit(conn, "cancel", "inventory_transfer", transfer_id)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        row = conn.execute("SELECT * FROM inventory_transfers WHERE id=?", (transfer_id,)).fetchone()
        return transfer_record_out(conn, row)
