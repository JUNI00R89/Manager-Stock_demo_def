from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.core.context import current_business_id
from backend.core.db import audit, connection, timestamp_iso
from backend.services.inventory import add_product_stock, consume_product_stock, current_operator, fetch_inventory_product, new_inventory_operation


router = APIRouter()


def physical_count_out(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    items = conn.execute(
        """SELECT pci.*, p.name AS product_name, p.sku, p.unit AS product_unit
           FROM physical_count_items pci JOIN products p ON p.id=pci.product_id
           WHERE pci.count_id=? ORDER BY pci.id""",
        (row["id"],),
    ).fetchall()
    return {
        "id": row["id"], "status": row["status"], "notes": row["notes"],
        "createdBy": row["created_by"], "createdByName": row["created_by_name"],
        "createdAt": timestamp_iso(row["created_at"]), "closedAt": timestamp_iso(row["closed_at"]),
        "items": [{
            "id": item["id"], "productId": item["product_id"], "productName": item["product_name"],
            "sku": item["sku"], "productUnit": item["product_unit"],
            "systemQuantity": float(item["system_quantity"] or 0),
            "countedQuantity": float(item["counted_quantity"] or 0),
            "difference": float(item["difference"] or 0),
            "adjustmentMovementId": item["adjustment_movement_id"],
        } for item in items],
        "differenceCount": len([item for item in items if abs(float(item["difference"] or 0)) > 1e-9]),
        "totalDifference": round(sum(float(item["difference"] or 0) for item in items), 6),
    }


class PhysicalCountItemPayload(BaseModel):
    productId: str
    countedQuantity: float = Field(ge=0, le=100000000)


class PhysicalCountPayload(BaseModel):
    notes: str = Field(default="", max_length=1000)
    items: list[PhysicalCountItemPayload] = Field(min_length=1, max_length=1000)


@router.get("/api/inventory/counts")
def list_physical_counts(limit: int = Query(default=50, ge=1, le=500)):
    with connection() as conn:
        rows = conn.execute(
            "SELECT * FROM physical_counts WHERE business_id=? ORDER BY created_at DESC, id DESC LIMIT ?",
            (current_business_id(), limit),
        ).fetchall()
        return [physical_count_out(conn, row) for row in rows]


@router.post("/api/inventory/counts", status_code=201)
def create_physical_count(payload: PhysicalCountPayload):
    count_id = f"CON-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            operation_id = new_inventory_operation(
                conn, "count", reason="Conteo físico", notes=payload.notes.strip(), reference=count_id
            )
            user_id, user_name = current_operator()
            conn.execute(
                """INSERT INTO physical_counts (id,business_id,status,notes,created_by,created_by_name,closed_at)
                   VALUES (?,?,'closed',?,?,?,CURRENT_TIMESTAMP)""",
                (count_id, current_business_id(), payload.notes.strip(), user_id, user_name),
            )
            seen: set[str] = set()
            for item in payload.items:
                if item.productId in seen:
                    raise HTTPException(422, "No repitas el mismo producto en un conteo.")
                seen.add(item.productId)
                product = fetch_inventory_product(conn, item.productId)
                system_quantity = float(product["stock"] or 0)
                counted_quantity = float(item.countedQuantity)
                difference = round(counted_quantity - system_quantity, 6)
                adjustment_movement_id = None
                if difference > 0:
                    result = add_product_stock(
                        conn, product, difference, movement_type="count_adjustment",
                        note=f"Conteo físico {count_id}", reason="Conteo físico", operation_id=operation_id,
                        reference_type="physical_count", reference_id=count_id,
                    )
                    adjustment_movement_id = result["movementId"]
                elif difference < 0:
                    results = consume_product_stock(
                        conn, product, abs(difference), movement_type="count_adjustment",
                        note=f"Conteo físico {count_id}", reason="Conteo físico", operation_id=operation_id,
                        reference_type="physical_count", reference_id=count_id, allow_negative=True,
                    )
                    adjustment_movement_id = results[0]["movementId"] if results else None
                conn.execute(
                    """INSERT INTO physical_count_items
                       (count_id,product_id,system_quantity,counted_quantity,difference,adjustment_movement_id)
                       VALUES (?,?,?,?,?,?)""",
                    (count_id, item.productId, system_quantity, counted_quantity, difference, adjustment_movement_id),
                )
            audit(conn, "create", "physical_count", count_id, {"items": len(payload.items)})
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        row = conn.execute("SELECT * FROM physical_counts WHERE id=?", (count_id,)).fetchone()
        result = physical_count_out(conn, row)
        result["operationId"] = operation_id
        return result
