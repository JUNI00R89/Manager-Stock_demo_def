from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException

from backend.core.context import current_business_id
from backend.core.db import audit, connection
from backend.schemas import SupplierPayload


router = APIRouter()


@router.get("/api/suppliers")
def list_suppliers(search: str = ""):
    with connection() as conn:
        query = "SELECT * FROM suppliers WHERE business_id=? AND active=1"
        params: list = [current_business_id()]
        if search:
            term = f"%{search.lower()}%"
            query += " AND (lower(name) LIKE ? OR lower(company) LIKE ? OR lower(email) LIKE ?)"
            params.extend([term, term, term])
        rows = conn.execute(query + " ORDER BY company COLLATE NOCASE", params).fetchall()
        output = []
        for row in rows:
            products = [r["product_id"] for r in conn.execute("SELECT product_id FROM supplier_products WHERE supplier_id=?", (row["id"],)).fetchall()]
            output.append({"id": row["id"], "name": row["name"], "company": row["company"], "phone": row["phone"], "email": row["email"], "address": row["address"], "products": products, "notes": row["notes"]})
        return output


@router.post("/api/suppliers", status_code=201)
def create_supplier(payload: SupplierPayload):
    supplier_id = f"PROV-{uuid.uuid4().hex[:8].upper()}"
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("INSERT INTO suppliers (id,business_id,name,company,phone,email,address,notes) VALUES (?,?,?,?,?,?,?,?)",
                     (supplier_id, current_business_id(), payload.name.strip(), payload.company.strip(), payload.phone.strip(), payload.email.strip(), payload.address.strip(), payload.notes.strip()))
        for product_id in set(payload.products):
            exists = conn.execute("SELECT id FROM products WHERE id=? AND business_id=? AND active=1", (product_id, current_business_id())).fetchone()
            if exists:
                conn.execute("INSERT OR IGNORE INTO supplier_products (supplier_id,product_id) VALUES (?,?)", (supplier_id, product_id))
        audit(conn, "create", "supplier", supplier_id)
        conn.commit()
        return next(x for x in list_suppliers() if x["id"] == supplier_id)


@router.put("/api/suppliers/{supplier_id}")
def update_supplier(supplier_id: str, payload: SupplierPayload):
    business_id = current_business_id()
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        cursor = conn.execute("UPDATE suppliers SET name=?,company=?,phone=?,email=?,address=?,notes=? WHERE id=? AND business_id=? AND active=1",
                              (payload.name.strip(), payload.company.strip(), payload.phone.strip(), payload.email.strip(), payload.address.strip(), payload.notes.strip(), supplier_id, business_id))
        if cursor.rowcount == 0:
            conn.rollback()
            raise HTTPException(404, "Proveedor no encontrado.")
        conn.execute("DELETE FROM supplier_products WHERE supplier_id=?", (supplier_id,))
        for product_id in set(payload.products):
            if conn.execute("SELECT id FROM products WHERE id=? AND business_id=? AND active=1", (product_id, business_id)).fetchone():
                conn.execute("INSERT OR IGNORE INTO supplier_products (supplier_id,product_id) VALUES (?,?)", (supplier_id, product_id))
        audit(conn, "update", "supplier", supplier_id)
        conn.commit()
        return next(x for x in list_suppliers() if x["id"] == supplier_id)


@router.delete("/api/suppliers/{supplier_id}")
def delete_supplier(supplier_id: str):
    with connection() as conn:
        cur = conn.execute("UPDATE suppliers SET active=0 WHERE id=? AND business_id=? AND active=1", (supplier_id, current_business_id()))
        if cur.rowcount == 0:
            raise HTTPException(404, "Proveedor no encontrado.")
        audit(conn, "archive", "supplier", supplier_id)
        return {"ok": True, "id": supplier_id}
