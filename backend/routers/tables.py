from __future__ import annotations

import sqlite3
import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.core.context import current_business_id
from backend.core.db import audit, connection, timestamp_iso


router = APIRouter()


def table_to_dict(conn: sqlite3.Connection, row) -> dict:
    open_orders = conn.execute(
        "SELECT status,total,waiter,created_at FROM orders WHERE business_id=? AND channel='table' AND table_number=? AND status IN ('received','preparing','ready') ORDER BY created_at",
        (row["business_id"], row["number"]),
    ).fetchall()
    return {
        "id": row["id"], "number": row["number"], "zone": row["zone"] or "", "capacity": row["capacity"],
        "status": row["status"], "openOrders": len(open_orders),
        "openTotal": round(sum(float(o["total"] or 0) for o in open_orders), 2),
        "waiter": next((o["waiter"] for o in reversed(open_orders) if o["waiter"]), ""),
        "since": timestamp_iso(open_orders[0]["created_at"]) if open_orders else None,
    }


class TablePayload(BaseModel):
    number: int = Field(ge=1, le=999)
    zone: str = Field(default="", max_length=80)
    capacity: int = Field(default=4, ge=1, le=50)


class TableUpdatePayload(BaseModel):
    number: int | None = Field(default=None, ge=1, le=999)
    zone: str | None = Field(default=None, max_length=80)
    capacity: int | None = Field(default=None, ge=1, le=50)
    status: Literal["active", "inactive"] | None = None


@router.get("/api/tables")
def list_restaurant_tables():
    with connection() as conn:
        rows = conn.execute("SELECT * FROM restaurant_tables WHERE business_id=? ORDER BY number", (current_business_id(),)).fetchall()
        return [table_to_dict(conn, row) for row in rows]


@router.post("/api/tables", status_code=201)
def create_restaurant_table(payload: TablePayload):
    with connection() as conn:
        existing = conn.execute("SELECT id FROM restaurant_tables WHERE business_id=? AND number=?", (current_business_id(), payload.number)).fetchone()
        if existing:
            raise HTTPException(409, f"Ya existe una mesa con el número {payload.number}.")
        table_id = f"MESA-{uuid.uuid4().hex[:8].upper()}"
        conn.execute("INSERT INTO restaurant_tables (id,business_id,number,zone,capacity,status) VALUES (?,?,?,?,?,'active')",
                     (table_id, current_business_id(), payload.number, payload.zone.strip(), payload.capacity))
        audit(conn, "create", "restaurant_table", table_id, {"number": payload.number})
        row = conn.execute("SELECT * FROM restaurant_tables WHERE id=?", (table_id,)).fetchone()
        return table_to_dict(conn, row)


@router.patch("/api/tables/{table_id}")
def update_restaurant_table(table_id: str, payload: TableUpdatePayload):
    with connection() as conn:
        row = conn.execute("SELECT * FROM restaurant_tables WHERE id=? AND business_id=?", (table_id, current_business_id())).fetchone()
        if not row:
            raise HTTPException(404, "Mesa no encontrada.")
        number = payload.number if payload.number is not None else row["number"]
        if number != row["number"]:
            clash = conn.execute("SELECT id FROM restaurant_tables WHERE business_id=? AND number=? AND id<>?", (current_business_id(), number, table_id)).fetchone()
            if clash:
                raise HTTPException(409, f"Ya existe una mesa con el número {number}.")
            open_count = conn.execute("SELECT COUNT(*) AS c FROM orders WHERE business_id=? AND channel='table' AND table_number=? AND status IN ('received','preparing','ready')",
                                      (current_business_id(), row["number"])).fetchone()["c"]
            if open_count:
                raise HTTPException(409, "La mesa tiene comandas abiertas; no puedes cambiar su número todavía.")
        zone = payload.zone.strip() if payload.zone is not None else row["zone"]
        capacity = payload.capacity if payload.capacity is not None else row["capacity"]
        status = payload.status if payload.status is not None else row["status"]
        conn.execute("UPDATE restaurant_tables SET number=?, zone=?, capacity=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND business_id=?",
                     (number, zone, capacity, status, table_id, current_business_id()))
        audit(conn, "update", "restaurant_table", table_id, {"number": number, "status": status})
        row = conn.execute("SELECT * FROM restaurant_tables WHERE id=?", (table_id,)).fetchone()
        return table_to_dict(conn, row)


@router.delete("/api/tables/{table_id}")
def delete_restaurant_table(table_id: str):
    with connection() as conn:
        row = conn.execute("SELECT * FROM restaurant_tables WHERE id=? AND business_id=?", (table_id, current_business_id())).fetchone()
        if not row:
            raise HTTPException(404, "Mesa no encontrada.")
        open_count = conn.execute("SELECT COUNT(*) AS c FROM orders WHERE business_id=? AND channel='table' AND table_number=? AND status IN ('received','preparing','ready')",
                                  (current_business_id(), row["number"])).fetchone()["c"]
        if open_count:
            raise HTTPException(409, "La mesa tiene comandas abiertas. Entrega o cancela esos pedidos antes de eliminarla.")
        conn.execute("DELETE FROM restaurant_tables WHERE id=? AND business_id=?", (table_id, current_business_id()))
        audit(conn, "delete", "restaurant_table", table_id, {"number": row["number"]})
    return None
