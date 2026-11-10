from __future__ import annotations

import json
import sqlite3
import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.core.context import current_business_id, current_identity
from backend.core.db import audit, connection, timestamp_iso
from backend.core.security import has_permission
from backend.services.inventory import WASTE_REASON_LABELS, add_product_stock, allows_negative_stock, consume_product_stock, convert_quantity, days_until, fetch_inventory_product, inventory_location_out, inventory_operation_out, inventory_product_out, inventory_settings, new_inventory_operation, normalize_date, normalize_waste_reason, require_inventory_location


router = APIRouter()


@router.get("/api/inventory/movements")
def inventory_movements(
    limit: int = Query(default=100, ge=1, le=500), productId: str | None = None,
    movementType: str | None = None, locationId: str | None = None, lotId: str | None = None,
    search: str = "", dateFrom: str | None = None, dateTo: str | None = None,
    offset: int = Query(default=0, ge=0),
):
    with connection() as conn:
        query = """SELECT m.*, p.name AS product_name, p.sku, p.unit AS product_unit,
                   l.code AS location_code, l.name AS location_name,
                   pl.lot_code AS lot_code, COALESCE(NULLIF(u.full_name,''), m.created_by_name) AS created_by_name
                   FROM inventory_movements m JOIN products p ON p.id=m.product_id
                   LEFT JOIN warehouse_locations l ON l.id=m.location_id
                   LEFT JOIN product_lots pl ON pl.id=m.lot_id
                   LEFT JOIN auth_users u ON u.id=m.created_by
                   WHERE m.business_id=?"""
        params: list = [current_business_id()]
        if productId:
            query += " AND m.product_id=?"
            params.append(productId)
        if movementType:
            types = [value.strip() for value in movementType.split(",") if value.strip()]
            if types:
                query += f" AND m.movement_type IN ({','.join('?' for _ in types)})"
                params.extend(types)
        if locationId:
            query += " AND m.location_id=?"
            params.append(locationId)
        if lotId:
            query += " AND m.lot_id=?"
            params.append(lotId)
        if search:
            term = f"%{search.lower()}%"
            query += " AND (lower(p.name) LIKE ? OR lower(p.sku) LIKE ? OR lower(p.barcode) LIKE ? OR lower(m.note) LIKE ? OR lower(m.reason) LIKE ? OR lower(m.reference_id) LIKE ?)"
            params.extend([term, term, term, term, term, term])
        if dateFrom:
            query += " AND date(m.created_at) >= date(?)"
            params.append(normalize_date(dateFrom))
        if dateTo:
            query += " AND date(m.created_at) <= date(?)"
            params.append(normalize_date(dateTo))
        query += " ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        result = [dict(row) for row in conn.execute(query, params).fetchall()]
        for row in result:
            row["created_at"] = timestamp_iso(row.get("created_at"))
        return result


class InventoryLocationPayload(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(default="", max_length=120)
    zone: str = Field(default="", max_length=80)
    aisle: str = Field(default="", max_length=40)
    rack: str = Field(default="", max_length=40)
    level: int = Field(default=1, ge=0, le=999)
    capacity: float = Field(default=0, ge=0, le=100000000)
    active: bool = True


class InventorySettingsPayload(BaseModel):
    allowNegativeStock: bool = False
    expiryAlertDays: int = Field(default=30, ge=0, le=3650)
    lowStockAlerts: bool = True
    defaultLocationId: str | None = None


@router.get("/api/inventory/settings")
def get_inventory_settings():
    with connection() as conn:
        settings = inventory_settings(conn)
        location = None
        if settings.get("defaultLocationId"):
            location = conn.execute(
                "SELECT * FROM warehouse_locations WHERE id=? AND business_id=?",
                (settings["defaultLocationId"], current_business_id()),
            ).fetchone()
        settings["defaultLocationName"] = location["name"] if location else None
        settings["negativeStockPermission"] = has_permission("inventory.negative")
        return settings


@router.put("/api/inventory/settings")
def update_inventory_settings(payload: InventorySettingsPayload):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if payload.defaultLocationId:
            require_inventory_location(conn, payload.defaultLocationId, allow_empty=False)
        row = conn.execute("SELECT settings_json FROM businesses WHERE id=?", (current_business_id(),)).fetchone()
        try:
            settings = json.loads(row["settings_json"] or "{}") if row else {}
        except (json.JSONDecodeError, TypeError):
            settings = {}
        if not isinstance(settings, dict):
            settings = {}
        settings["inventoryConfig"] = {
            "allowNegativeStock": payload.allowNegativeStock,
            "expiryAlertDays": payload.expiryAlertDays,
            "lowStockAlerts": payload.lowStockAlerts,
            "defaultLocationId": payload.defaultLocationId,
        }
        conn.execute(
            "UPDATE businesses SET settings_json=? WHERE id=?",
            (json.dumps(settings, ensure_ascii=False), current_business_id()),
        )
        audit(conn, "update", "inventory_settings", current_business_id(), settings["inventoryConfig"])
        conn.commit()
        return get_inventory_settings()


@router.get("/api/inventory/locations")
def list_inventory_locations(includeInactive: bool = False):
    with connection() as conn:
        query = "SELECT * FROM warehouse_locations WHERE business_id=?"
        params: list = [current_business_id()]
        if not includeInactive:
            query += " AND active=1"
        rows = conn.execute(query + " ORDER BY zone, aisle, rack, level, code", params).fetchall()
        return [inventory_location_out(conn, row) for row in rows]


@router.post("/api/inventory/locations", status_code=201)
def create_inventory_location(payload: InventoryLocationPayload):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        location_id = f"UBI-{uuid.uuid4().hex[:10].upper()}"
        try:
            conn.execute(
                """INSERT INTO warehouse_locations (id,business_id,code,name,zone,aisle,rack,level,capacity,active)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (location_id, current_business_id(), payload.code.strip().upper(), payload.name.strip(),
                 payload.zone.strip(), payload.aisle.strip(), payload.rack.strip(), payload.level,
                 payload.capacity, 1 if payload.active else 0),
            )
        except sqlite3.IntegrityError as exc:
            conn.rollback()
            raise HTTPException(409, "Ya existe una ubicación con ese código.") from exc
        audit(conn, "create", "warehouse_location", location_id, {"code": payload.code})
        conn.commit()
        row = conn.execute("SELECT * FROM warehouse_locations WHERE id=?", (location_id,)).fetchone()
        return inventory_location_out(conn, row)


@router.patch("/api/inventory/locations/{location_id}")
def update_inventory_location(location_id: str, payload: InventoryLocationPayload):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT * FROM warehouse_locations WHERE id=? AND business_id=?", (location_id, current_business_id())
        ).fetchone()
        if not row:
            conn.rollback()
            raise HTTPException(404, "Ubicación no encontrada.")
        try:
            conn.execute(
                """UPDATE warehouse_locations SET code=?,name=?,zone=?,aisle=?,rack=?,level=?,capacity=?,active=?,updated_at=CURRENT_TIMESTAMP
                   WHERE id=? AND business_id=?""",
                (payload.code.strip().upper(), payload.name.strip(), payload.zone.strip(), payload.aisle.strip(),
                 payload.rack.strip(), payload.level, payload.capacity, 1 if payload.active else 0,
                 location_id, current_business_id()),
            )
        except sqlite3.IntegrityError as exc:
            conn.rollback()
            raise HTTPException(409, "Ya existe una ubicación con ese código.") from exc
        audit(conn, "update", "warehouse_location", location_id, {"code": payload.code})
        conn.commit()
        row = conn.execute("SELECT * FROM warehouse_locations WHERE id=?", (location_id,)).fetchone()
        return inventory_location_out(conn, row)


@router.delete("/api/inventory/locations/{location_id}")
def delete_inventory_location(location_id: str):
    with connection() as conn:
        row = conn.execute(
            "SELECT * FROM warehouse_locations WHERE id=? AND business_id=?", (location_id, current_business_id())
        ).fetchone()
        if not row:
            raise HTTPException(404, "Ubicación no encontrada.")
        stocked = conn.execute(
            "SELECT COUNT(*) FROM product_lots WHERE business_id=? AND location_id=? AND quantity>0",
            (current_business_id(), location_id),
        ).fetchone()[0]
        if stocked:
            raise HTTPException(409, "No puedes desactivar una ubicación con existencias. Transfiere o ajusta primero.")
        conn.execute("UPDATE warehouse_locations SET active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?", (location_id,))
        audit(conn, "archive", "warehouse_location", location_id)
        return {"ok": True, "id": location_id}


@router.get("/api/inventory/lots")
def list_inventory_lots(
    productId: str | None = None, locationId: str | None = None, status: str | None = None,
    search: str = "", includeEmpty: bool = False,
):
    with connection() as conn:
        alert_days = int(inventory_settings(conn)["expiryAlertDays"])
        query = """SELECT l.*, p.name AS product_name, p.sku, p.unit AS product_unit,
                   w.code AS location_code, w.name AS location_name
                   FROM product_lots l JOIN products p ON p.id=l.product_id
                   LEFT JOIN warehouse_locations w ON w.id=l.location_id
                   WHERE l.business_id=?"""
        params: list = [current_business_id()]
        if not includeEmpty:
            query += " AND l.quantity>0"
        if productId:
            query += " AND l.product_id=?"
            params.append(productId)
        if locationId:
            query += " AND l.location_id=?"
            params.append(locationId)
        if search:
            term = f"%{search.lower()}%"
            query += " AND (lower(p.name) LIKE ? OR lower(p.sku) LIKE ? OR lower(l.lot_code) LIKE ?)"
            params.extend([term, term, term])
        query += " ORDER BY CASE WHEN l.expiry_date IS NULL THEN 1 ELSE 0 END, l.expiry_date, l.received_at"
        result = []
        for row in conn.execute(query, params).fetchall():
            days = days_until(row["expiry_date"])
            lot_status = "sin_vencimiento" if days is None else ("vencido" if days < 0 else ("por_vencer" if days <= alert_days else "vigente"))
            if status and lot_status != status:
                continue
            result.append({
                "id": row["id"], "productId": row["product_id"], "productName": row["product_name"],
                "sku": row["sku"], "productUnit": row["product_unit"], "lotCode": row["lot_code"],
                "quantity": float(row["quantity"] or 0), "expiryDate": row["expiry_date"],
                "daysLeft": days, "status": lot_status, "unitCost": float(row["unit_cost"] or 0),
                "locationId": row["location_id"], "locationCode": row["location_code"],
                "locationName": row["location_name"], "receivedAt": timestamp_iso(row["received_at"]),
                "value": round(float(row["quantity"] or 0) * float(row["unit_cost"] or 0), 2),
            })
        return result


@router.get("/api/inventory/barcode/{barcode}")
def lookup_inventory_barcode(barcode: str):
    with connection() as conn:
        code = barcode.strip()
        rows = conn.execute(
            """SELECT p.*, s.company AS supplier_name FROM products p
               LEFT JOIN suppliers s ON s.id=p.supplier_id
               WHERE p.business_id=? AND p.active=1 AND (p.barcode=? OR p.sku=?)""",
            (current_business_id(), code, code),
        ).fetchall()
        if not rows:
            raise HTTPException(404, "No se encontró un producto con ese código de barras o SKU.")
        return {
            "products": [inventory_product_out(row) for row in rows],
            "lots": list_inventory_lots(productId=rows[0]["id"]) if len(rows) == 1 else [],
        }


class InventoryEntryItemPayload(BaseModel):
    productId: str
    quantity: float = Field(gt=0, le=100000000)
    unit: str = Field(default="", max_length=32)
    unitCost: float = Field(default=0, ge=0, le=100000000)
    lotCode: str = Field(default="", max_length=80)
    expiryDate: str | None = None
    locationId: str | None = None


class InventoryEntryPayload(BaseModel):
    entryType: Literal["purchase", "customer_return", "donation", "opening"] = "purchase"
    supplierId: str | None = None
    reference: str = Field(default="", max_length=120)
    invoiceRef: str = Field(default="", max_length=120)
    notes: str = Field(default="", max_length=1000)
    attachmentUrl: str = Field(default="", max_length=500)
    items: list[InventoryEntryItemPayload] = Field(min_length=1, max_length=200)


ENTRY_MOVEMENT_TYPES = {
    "purchase": "purchase", "customer_return": "customer_return",
    "donation": "donation", "opening": "opening",
}


@router.post("/api/inventory/entries", status_code=201)
def create_inventory_entry(payload: InventoryEntryPayload):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            if payload.supplierId:
                supplier = conn.execute(
                    "SELECT id FROM suppliers WHERE id=? AND business_id=? AND active=1",
                    (payload.supplierId, current_business_id()),
                ).fetchone()
                if not supplier:
                    raise HTTPException(422, "El proveedor seleccionado no está activo en este negocio.")
            operation_id = new_inventory_operation(
                conn, payload.entryType, supplier_id=payload.supplierId, reference=payload.reference.strip(),
                invoice_ref=payload.invoiceRef.strip(), attachment_url=payload.attachmentUrl.strip(),
                notes=payload.notes.strip(), reason="Entrada de inventario",
            )
            for item in payload.items:
                product = fetch_inventory_product(conn, item.productId)
                location_id = item.locationId or product["default_location_id"] or inventory_settings(conn).get("defaultLocationId")
                if location_id:
                    require_inventory_location(conn, location_id)
                quantity = convert_quantity(item.quantity, item.unit or product["unit"], product["unit"])
                if quantity <= 0:
                    raise HTTPException(422, "La cantidad convertida debe ser mayor que cero.")
                effective_cost = float(item.unitCost or product["cost"] or 0)
                add_product_stock(
                    conn, product, quantity, movement_type=ENTRY_MOVEMENT_TYPES[payload.entryType],
                    note=f"Entrada {operation_id}", reason="Entrada de inventario", unit_cost=effective_cost,
                    lot_code=item.lotCode.strip(), expiry_date=normalize_date(item.expiryDate),
                    location_id=location_id, operation_id=operation_id, reference_type="inventory_operation",
                    reference_id=operation_id,
                )
                if item.unitCost > 0:
                    conn.execute(
                        "UPDATE products SET cost=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                        (item.unitCost, product["id"]),
                    )
                    conn.execute(
                        """INSERT INTO supplier_price_history
                           (business_id,supplier_id,product_id,unit_cost,source,reference_type,reference_id,created_by)
                           VALUES (?,?,?,?,?,?,?,?)""",
                        (current_business_id(), payload.supplierId, product["id"], item.unitCost,
                         "entry", "inventory_operation", operation_id, current_identity()["id"]),
                    )
            audit(conn, "create", "inventory_entry", operation_id, {"entryType": payload.entryType, "items": len(payload.items)})
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        return inventory_operation_out(conn, operation_id)


class InventoryExitItemPayload(BaseModel):
    productId: str
    quantity: float = Field(gt=0, le=100000000)
    unit: str = Field(default="", max_length=32)
    lotId: str | None = None


class InventoryExitPayload(BaseModel):
    exitType: Literal["consumption", "direct_sale", "other"] = "consumption"
    reason: str = Field(default="", max_length=300)
    notes: str = Field(default="", max_length=1000)
    items: list[InventoryExitItemPayload] = Field(min_length=1, max_length=200)


DEFAULT_EXIT_REASONS = {
    "consumption": "Consumo interno", "direct_sale": "Venta directa", "other": "Salida de inventario",
}


@router.post("/api/inventory/exits", status_code=201)
def create_inventory_exit(payload: InventoryExitPayload):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            reason = payload.reason.strip() or DEFAULT_EXIT_REASONS[payload.exitType]
            operation_id = new_inventory_operation(
                conn, "consumption", reason=reason, notes=payload.notes.strip(), reference=payload.exitType,
            )
            allow_negative = allows_negative_stock(conn)
            for item in payload.items:
                product = fetch_inventory_product(conn, item.productId)
                quantity = convert_quantity(item.quantity, item.unit or product["unit"], product["unit"])
                if quantity <= 0:
                    raise HTTPException(422, "La cantidad convertida debe ser mayor que cero.")
                consume_product_stock(
                    conn, product, quantity, movement_type="consumption", note=f"Salida {operation_id}",
                    reason=reason, operation_id=operation_id, reference_type="inventory_operation",
                    reference_id=operation_id, lot_id=item.lotId, allow_negative=allow_negative,
                )
            audit(conn, "create", "inventory_exit", operation_id, {"exitType": payload.exitType, "items": len(payload.items)})
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        return inventory_operation_out(conn, operation_id)


class InventoryWasteItemPayload(BaseModel):
    productId: str
    quantity: float = Field(gt=0, le=100000000)
    unit: str = Field(default="", max_length=32)
    lotId: str | None = None


class InventoryWastePayload(BaseModel):
    reasonCode: str = Field(default="otro", max_length=60)
    reason: str = Field(min_length=3, max_length=300)
    notes: str = Field(default="", max_length=1000)
    items: list[InventoryWasteItemPayload] = Field(min_length=1, max_length=200)


@router.post("/api/inventory/waste", status_code=201)
def create_inventory_waste(payload: InventoryWastePayload):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            reason_code = normalize_waste_reason(payload.reasonCode)
            reason = payload.reason.strip()
            if len(reason) < 3:
                raise HTTPException(422, "El motivo de la merma es obligatorio.")
            operation_id = new_inventory_operation(
                conn, "waste", reason=reason, reason_code=reason_code, notes=payload.notes.strip(),
                reference=WASTE_REASON_LABELS[reason_code],
            )
            allow_negative = allows_negative_stock(conn)
            for item in payload.items:
                product = fetch_inventory_product(conn, item.productId)
                quantity = convert_quantity(item.quantity, item.unit or product["unit"], product["unit"])
                if quantity <= 0:
                    raise HTTPException(422, "La cantidad convertida debe ser mayor que cero.")
                consume_product_stock(
                    conn, product, quantity, movement_type="waste", note=f"Merma {operation_id}",
                    reason=reason, operation_id=operation_id, reference_type="inventory_operation",
                    reference_id=operation_id, lot_id=item.lotId, allow_negative=allow_negative,
                )
            audit(conn, "create", "inventory_waste", operation_id, {"reasonCode": reason_code, "items": len(payload.items)})
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        result = inventory_operation_out(conn, operation_id)
        result["reasonCode"] = reason_code
        result["reasonLabel"] = WASTE_REASON_LABELS[reason_code]
        return result


class InventoryAdjustmentItemPayload(BaseModel):
    productId: str
    quantityDelta: float = Field(le=100000000)
    unit: str = Field(default="", max_length=32)
    lotId: str | None = None


class InventoryAdjustmentPayload(BaseModel):
    reason: str = Field(min_length=3, max_length=300)
    notes: str = Field(default="", max_length=1000)
    items: list[InventoryAdjustmentItemPayload] = Field(min_length=1, max_length=200)


@router.post("/api/inventory/adjustments", status_code=201)
def create_inventory_adjustment(payload: InventoryAdjustmentPayload):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            reason = payload.reason.strip()
            if len(reason) < 3:
                raise HTTPException(422, "El motivo del ajuste es obligatorio.")
            operation_id = new_inventory_operation(conn, "adjustment", reason=reason, notes=payload.notes.strip())
            allow_negative = allows_negative_stock(conn)
            for item in payload.items:
                product = fetch_inventory_product(conn, item.productId)
                delta = convert_quantity(item.quantityDelta, item.unit or product["unit"], product["unit"])
                if abs(delta) < 1e-9:
                    continue
                if delta > 0:
                    add_product_stock(
                        conn, product, delta, movement_type="adjustment", note=f"Ajuste {operation_id}",
                        reason=reason, operation_id=operation_id, reference_type="inventory_operation",
                        reference_id=operation_id,
                    )
                else:
                    consume_product_stock(
                        conn, product, abs(delta), movement_type="adjustment", note=f"Ajuste {operation_id}",
                        reason=reason, operation_id=operation_id, reference_type="inventory_operation",
                        reference_id=operation_id, lot_id=item.lotId, allow_negative=allow_negative,
                    )
            audit(conn, "create", "inventory_adjustment", operation_id, {"items": len(payload.items)})
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        return inventory_operation_out(conn, operation_id)
