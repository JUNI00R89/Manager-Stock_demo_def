from __future__ import annotations

import json
import sqlite3
import unicodedata
import uuid
from datetime import date, datetime

from fastapi import HTTPException

from backend.core.config import DISCRETE_UNITS
from backend.core.context import current_business_id, current_identity
from backend.core.db import table_exists, timestamp_iso
from backend.core.security import has_permission


UNIT_ALIASES = {
    "unidad": ("unit", 1.0), "unidades": ("unit", 1.0), "un": ("unit", 1.0), "u": ("unit", 1.0),
    "pieza": ("unit", 1.0), "piezas": ("unit", 1.0), "pza": ("unit", 1.0), "paquete": ("unit", 1.0),
    "caja": ("unit", 1.0), "docena": ("unit", 12.0), "botella": ("unit", 1.0), "lata": ("unit", 1.0),
    "porcion": ("unit", 1.0), "porción": ("unit", 1.0), "servicio": ("unit", 1.0),
    "g": ("mass", 1.0), "gr": ("mass", 1.0), "gramo": ("mass", 1.0), "gramos": ("mass", 1.0),
    "kg": ("mass", 1000.0), "kilo": ("mass", 1000.0), "kilos": ("mass", 1000.0), "kilogramo": ("mass", 1000.0), "kilogramos": ("mass", 1000.0),
    "mg": ("mass", 0.001), "lb": ("mass", 453.59237), "libra": ("mass", 453.59237), "libras": ("mass", 453.59237),
    "oz": ("mass", 28.349523), "onza": ("mass", 28.349523), "onzas": ("mass", 28.349523),
    "ml": ("volume", 1.0), "mililitro": ("volume", 1.0), "mililitros": ("volume", 1.0),
    "l": ("volume", 1000.0), "lt": ("volume", 1000.0), "litro": ("volume", 1000.0), "litros": ("volume", 1000.0),
    "gal": ("volume", 3785.411784), "galon": ("volume", 3785.411784), "galón": ("volume", 3785.411784),
}


def normalize_unit(value: str | None) -> str:
    return unicodedata.normalize("NFKD", (value or "unidad").strip().lower()).encode("ascii", "ignore").decode("ascii")


def unit_factor(from_unit: str | None, to_unit: str | None) -> float:
    source = UNIT_ALIASES.get(normalize_unit(from_unit))
    target = UNIT_ALIASES.get(normalize_unit(to_unit))
    if not source or not target:
        return 1.0
    if source[0] != target[0]:
        return 1.0
    return source[1] / target[1]


def convert_quantity(quantity: float, from_unit: str | None, to_unit: str | None) -> float:
    return round(float(quantity) * unit_factor(from_unit, to_unit), 6)


def normalize_date(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10]).isoformat()
    except ValueError as exc:
        raise HTTPException(422, "La fecha debe tener el formato AAAA-MM-DD.") from exc


def days_until(value: str | None) -> int | None:
    if not value:
        return None
    try:
        return (date.fromisoformat(str(value)[:10]) - date.today()).days
    except ValueError:
        return None


def inventory_settings(conn: sqlite3.Connection) -> dict:
    row = conn.execute("SELECT settings_json FROM businesses WHERE id=?", (current_business_id(),)).fetchone()
    try:
        settings = json.loads(row["settings_json"] or "{}") if row else {}
    except (json.JSONDecodeError, TypeError):
        settings = {}
    raw = settings.get("inventoryConfig") if isinstance(settings, dict) and isinstance(settings.get("inventoryConfig"), dict) else {}
    return {
        "allowNegativeStock": bool(raw.get("allowNegativeStock", False)),
        "expiryAlertDays": int(raw.get("expiryAlertDays", 30) or 30),
        "lowStockAlerts": bool(raw.get("lowStockAlerts", True)),
        "defaultLocationId": raw.get("defaultLocationId") or None,
    }


def allows_negative_stock(conn: sqlite3.Connection) -> bool:
    if inventory_settings(conn).get("allowNegativeStock"):
        return True
    return has_permission("inventory.negative")


def current_operator() -> tuple[str | None, str]:
    identity = current_identity()
    return identity.get("id"), identity.get("name") or "Usuario"


def new_inventory_operation(
    conn: sqlite3.Connection, operation_type: str, *, supplier_id: str | None = None,
    reference: str = "", reason: str = "", reason_code: str = "", invoice_ref: str = "",
    attachment_url: str = "", notes: str = "",
) -> str:
    operation_id = f"OP-{uuid.uuid4().hex[:12].upper()}"
    user_id, user_name = current_operator()
    conn.execute(
        """INSERT INTO inventory_operations
           (id,business_id,operation_type,supplier_id,reference,reason,reason_code,invoice_ref,attachment_url,notes,created_by,created_by_name)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (operation_id, current_business_id(), operation_type, supplier_id, reference, reason, reason_code,
         invoice_ref, attachment_url, notes, user_id, user_name),
    )
    return operation_id


def get_or_create_lot(
    conn: sqlite3.Connection, product: sqlite3.Row, lot_code: str, expiry_date: str | None,
    unit_cost: float, location_id: str | None,
) -> str:
    code = (lot_code or "").strip() or f"LOTE-{datetime.now().strftime('%Y%m%d')}"
    existing = conn.execute(
        "SELECT id,quantity FROM product_lots WHERE business_id=? AND product_id=? AND lot_code=?",
        (current_business_id(), product["id"], code),
    ).fetchone()
    if existing:
        conn.execute(
            "UPDATE product_lots SET quantity=?, expiry_date=COALESCE(?,expiry_date), unit_cost=?, location_id=COALESCE(?,location_id), updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (round(existing["quantity"] + 0, 6), expiry_date, unit_cost, location_id, existing["id"]),
        )
        return existing["id"]
    lot_id = f"LOT-{uuid.uuid4().hex[:12].upper()}"
    conn.execute(
        """INSERT INTO product_lots (id,business_id,product_id,lot_code,quantity,expiry_date,unit_cost,location_id)
           VALUES (?,?,?,?,?,?,?,?)""",
        (lot_id, current_business_id(), product["id"], code, 0, expiry_date or None, unit_cost, location_id),
    )
    return lot_id


def insert_movement(
    conn: sqlite3.Connection, *, product_id: str, movement_type: str, quantity_delta: float,
    stock_before: float, stock_after: float, note: str = "", reason: str = "",
    unit_cost: float = 0, sale_id: str | None = None, order_id: str | None = None,
    operation_id: str | None = None, lot_id: str | None = None, location_id: str | None = None,
    reference_type: str = "", reference_id: str = "",
) -> int:
    user_id, user_name = current_operator()
    cursor = conn.execute(
        """INSERT INTO inventory_movements
           (business_id,product_id,sale_id,order_id,operation_id,lot_id,location_id,movement_type,
            quantity_delta,stock_before,stock_after,unit_cost,note,reason,created_by,created_by_name,reference_type,reference_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (current_business_id(), product_id, sale_id, order_id, operation_id, lot_id, location_id,
         movement_type, round(quantity_delta, 6), round(stock_before, 6), round(stock_after, 6),
         round(unit_cost or 0, 4), note, reason, user_id, user_name, reference_type, reference_id),
    )
    return int(cursor.lastrowid)


def add_product_stock(
    conn: sqlite3.Connection, product: sqlite3.Row, quantity: float, *, movement_type: str,
    note: str = "", reason: str = "", unit_cost: float = 0, lot_code: str = "",
    expiry_date: str | None = None, location_id: str | None = None, operation_id: str | None = None,
    sale_id: str | None = None, order_id: str | None = None, reference_type: str = "",
    reference_id: str = "",
) -> dict:
    before = float(product["stock"] or 0)
    after = round(before + quantity, 6)
    conn.execute("UPDATE products SET stock=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (after, product["id"]))
    lot_id = None
    should_track_lot = bool(product["track_lots"]) if "track_lots" in set(product.keys()) else False
    if should_track_lot or lot_code or expiry_date:
        lot_id = get_or_create_lot(conn, product, lot_code, expiry_date, unit_cost or float(product["cost"] or 0), location_id or inventory_settings(conn).get("defaultLocationId"))
        if lot_id:
            conn.execute("UPDATE product_lots SET quantity=quantity+?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (quantity, lot_id))
    movement_id = insert_movement(
        conn, product_id=product["id"], movement_type=movement_type, quantity_delta=quantity,
        stock_before=before, stock_after=after, note=note, reason=reason, unit_cost=unit_cost,
        sale_id=sale_id, order_id=order_id, operation_id=operation_id, lot_id=lot_id,
        location_id=location_id, reference_type=reference_type, reference_id=reference_id,
    )
    return {"movementId": movement_id, "lotId": lot_id, "stockBefore": before, "stockAfter": after}


def validate_product_quantity(product, quantity: float):
    unit = unicodedata.normalize("NFKD", product["unit"]).encode("ascii", "ignore").decode().casefold()
    if unit in DISCRETE_UNITS and not float(quantity).is_integer():
        raise HTTPException(422, "La cantidad debe ser entera para esta unidad de medida.")


def consume_product_stock(
    conn: sqlite3.Connection, product: sqlite3.Row, quantity: float, *, movement_type: str,
    note: str = "", reason: str = "", operation_id: str | None = None, sale_id: str | None = None,
    order_id: str | None = None, reference_type: str = "", reference_id: str = "",
    lot_id: str | None = None, allow_negative: bool = False, location_id: str | None = None,
) -> list[dict]:
    """Deducts stock using FEFO lots when available. Returns one movement per lot/portion."""
    before = float(product["stock"] or 0)
    if quantity <= 0:
        raise HTTPException(422, "La cantidad debe ser mayor que cero.")
    if before < quantity and not allow_negative:
        raise HTTPException(409, f"Stock insuficiente para {product['name']}. Disponible: {before:g}; solicitado: {quantity:g}.")
    remaining = round(quantity, 6)
    movements: list[dict] = []
    running = before
    lots = []
    if lot_id:
        lots = conn.execute(
            "SELECT * FROM product_lots WHERE id=? AND business_id=? AND product_id=? AND quantity>0",
            (lot_id, current_business_id(), product["id"]),
        ).fetchall()
        if not lots:
            raise HTTPException(422, "El lote seleccionado no tiene existencias disponibles.")
        if location_id and lots[0]["location_id"] and lots[0]["location_id"] != location_id:
            raise HTTPException(422, "El lote seleccionado no pertenece a la ubicación de origen.")
    elif table_exists(conn, "product_lots"):
        query = """SELECT * FROM product_lots WHERE business_id=? AND product_id=? AND quantity>0"""
        params: list = [current_business_id(), product["id"]]
        if location_id:
            query += " AND (location_id=? OR location_id IS NULL)"
            params.append(location_id)
        query += " ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date, received_at, id"
        lots = conn.execute(query, params).fetchall()
    for lot in lots:
        if remaining <= 0:
            break
        take = min(float(lot["quantity"] or 0), remaining)
        if take <= 0:
            continue
        conn.execute("UPDATE product_lots SET quantity=quantity-?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (take, lot["id"]))
        after = round(running - take, 6)
        movement_id = insert_movement(
            conn, product_id=product["id"], movement_type=movement_type, quantity_delta=-take,
            stock_before=running, stock_after=after, note=note, reason=reason,
            unit_cost=float(lot["unit_cost"] or product["cost"] or 0), sale_id=sale_id, order_id=order_id,
            operation_id=operation_id, lot_id=lot["id"], location_id=lot["location_id"] or location_id,
            reference_type=reference_type, reference_id=reference_id,
        )
        movements.append({"movementId": movement_id, "lotId": lot["id"], "lotCode": lot["lot_code"], "expiryDate": lot["expiry_date"], "quantity": -take, "stockBefore": running, "stockAfter": after})
        running = after
        remaining = round(remaining - take, 6)
    if remaining > 0:
        after = round(running - remaining, 6)
        movement_id = insert_movement(
            conn, product_id=product["id"], movement_type=movement_type, quantity_delta=-remaining,
            stock_before=running, stock_after=after, note=note, reason=reason,
            unit_cost=float(product["cost"] or 0), sale_id=sale_id, order_id=order_id,
            operation_id=operation_id, location_id=location_id, reference_type=reference_type,
            reference_id=reference_id,
        )
        movements.append({"movementId": movement_id, "lotId": None, "lotCode": "", "expiryDate": None, "quantity": -remaining, "stockBefore": running, "stockAfter": after})
        running = after
    conn.execute("UPDATE products SET stock=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (round(running, 6), product["id"]))
    return movements


def reverse_movements(conn: sqlite3.Connection, movements: list[sqlite3.Row], note: str, movement_type: str = "sale_cancelled") -> None:
    for movement in movements:
        product = conn.execute("SELECT * FROM products WHERE id=? AND business_id=?", (movement["product_id"], current_business_id())).fetchone()
        if not product:
            continue
        quantity = -float(movement["quantity_delta"])
        if quantity <= 0:
            continue
        before = float(product["stock"] or 0)
        after = round(before + quantity, 6)
        conn.execute("UPDATE products SET stock=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (after, product["id"]))
        lot_id = movement["lot_id"] if "lot_id" in set(movement.keys()) else None
        if lot_id:
            lot = conn.execute("SELECT id FROM product_lots WHERE id=? AND business_id=?", (lot_id, current_business_id())).fetchone()
            if lot:
                conn.execute("UPDATE product_lots SET quantity=quantity+?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (quantity, lot_id))
        insert_movement(
            conn, product_id=movement["product_id"], movement_type=movement_type, quantity_delta=quantity,
            stock_before=before, stock_after=after, note=note,
            reason=movement["reason"] if "reason" in set(movement.keys()) else "",
            unit_cost=movement["unit_cost"] if "unit_cost" in set(movement.keys()) else 0,
            sale_id=movement["sale_id"] if "sale_id" in set(movement.keys()) else None,
            order_id=movement["order_id"] if "order_id" in set(movement.keys()) else None,
            operation_id=movement["operation_id"] if "operation_id" in set(movement.keys()) else None,
            lot_id=lot_id,
            reference_type=movement["reference_type"] if "reference_type" in set(movement.keys()) else "",
            reference_id=movement["reference_id"] if "reference_id" in set(movement.keys()) else "",
        )


def recipe_ingredient_usage(conn: sqlite3.Connection, product_id: str, quantity: float) -> dict[str, float]:
    """Returns ingredient base-quantity usage for a sold/prepared product, converting recipe units."""
    recipe = conn.execute("SELECT * FROM recipes WHERE business_id=? AND product_id=?", (current_business_id(), product_id)).fetchone()
    if not recipe:
        return {}
    yield_quantity = float(recipe["yield_quantity"] or 1)
    usage: dict[str, float] = {}
    rows = conn.execute(
        """SELECT ri.ingredient_id,ri.quantity,ri.unit,p.unit AS product_unit
           FROM recipe_items ri JOIN products p ON p.id=ri.ingredient_id WHERE ri.recipe_id=?""",
        (recipe["id"],),
    ).fetchall()
    for item in rows:
        recipe_quantity = convert_quantity(float(item["quantity"] or 0), item["unit"], item["product_unit"]) if item["unit"] else float(item["quantity"] or 0)
        usage[item["ingredient_id"]] = usage.get(item["ingredient_id"], 0.0) + recipe_quantity * quantity / yield_quantity
    return {key: round(value, 6) for key, value in usage.items()}


def recipe_unit_cost(conn: sqlite3.Connection, product_id: str) -> float | None:
    recipe = conn.execute("SELECT * FROM recipes WHERE business_id=? AND product_id=?", (current_business_id(), product_id)).fetchone()
    if not recipe:
        return None
    yield_quantity = float(recipe["yield_quantity"] or 1)
    total = 0.0
    rows = conn.execute(
        """SELECT ri.quantity,ri.unit,p.cost,p.unit AS product_unit
           FROM recipe_items ri JOIN products p ON p.id=ri.ingredient_id WHERE ri.recipe_id=?""",
        (recipe["id"],),
    ).fetchall()
    for item in rows:
        recipe_quantity = convert_quantity(float(item["quantity"] or 0), item["unit"], item["product_unit"]) if item["unit"] else float(item["quantity"] or 0)
        total += recipe_quantity * float(item["cost"] or 0)
    return round(total / yield_quantity, 4) if yield_quantity else 0.0


def resolve_kitchen_requirements(conn: sqlite3.Connection, quantities: dict[str, float]) -> tuple[dict[str, float], dict[str, float]]:
    """Splits ordered quantities into direct product stock and recipe ingredient stock."""
    direct: dict[str, float] = {}
    ingredients: dict[str, float] = {}
    for product_id, quantity in quantities.items():
        recipe = conn.execute("SELECT id FROM recipes WHERE business_id=? AND product_id=?", (current_business_id(), product_id)).fetchone()
        if recipe:
            for ingredient_id, usage_quantity in recipe_ingredient_usage(conn, product_id, quantity).items():
                ingredients[ingredient_id] = round(ingredients.get(ingredient_id, 0.0) + usage_quantity, 6)
        else:
            direct[product_id] = round(direct.get(product_id, 0.0) + quantity, 6)
    return direct, ingredients


def validate_stock_requirements(conn: sqlite3.Connection, requirements: dict[str, float]) -> None:
    if not requirements or allows_negative_stock(conn):
        return
    for product_id, required_quantity in requirements.items():
        product = conn.execute("SELECT * FROM products WHERE id=? AND business_id=?", (product_id, current_business_id())).fetchone()
        if not product:
            raise HTTPException(404, f"No se encontró el producto {product_id}.")
        available = float(product["stock"] or 0)
        if available + 1e-9 < required_quantity:
            raise HTTPException(409, f"Stock insuficiente para {product['name']}. Disponible: {available:g}; solicitado: {required_quantity:g}.")


# ---------------------------------------------------------------------------
# Warehouse and inventory module
# ---------------------------------------------------------------------------

def inventory_product_out(row: sqlite3.Row, alert_days: int = 30) -> dict:
    stock = float(row["stock"] or 0)
    min_stock = float(row["min_stock"] or 0)
    status = "ok"
    if stock < 0:
        status = "negative"
    elif stock <= 0:
        status = "out"
    elif stock <= min_stock:
        status = "low"
    return {
        "id": row["id"], "name": row["name"], "sku": row["sku"], "category": row["category"],
        "price": row["price"], "cost": row["cost"], "stock": stock, "minStock": min_stock,
        "productType": row["product_type"], "unit": row["unit"], "barcode": row["barcode"] if "barcode" in set(row.keys()) else "",
        "trackLots": bool(row["track_lots"]) if "track_lots" in set(row.keys()) else False,
        "supplierId": row["supplier_id"] if "supplier_id" in set(row.keys()) else None,
        "supplierName": row["supplier_name"] if "supplier_name" in set(row.keys()) else None,
        "defaultLocationId": row["default_location_id"] if "default_location_id" in set(row.keys()) else None,
        "stockValue": round(stock * float(row["cost"] or 0), 2),
        "retailValue": round(stock * float(row["price"] or 0), 2),
        "stockStatus": status,
    }


def inventory_location_out(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    product_count = conn.execute(
        "SELECT COUNT(*) FROM products WHERE business_id=? AND default_location_id=? AND active=1",
        (current_business_id(), row["id"]),
    ).fetchone()[0]
    lot_units = conn.execute(
        "SELECT COALESCE(SUM(quantity),0) FROM product_lots WHERE business_id=? AND location_id=?",
        (current_business_id(), row["id"]),
    ).fetchone()[0]
    return {
        "id": row["id"], "code": row["code"], "name": row["name"], "zone": row["zone"],
        "aisle": row["aisle"], "rack": row["rack"], "level": int(row["level"] or 0),
        "capacity": float(row["capacity"] or 0), "active": bool(row["active"]),
        "productCount": int(product_count or 0), "lotUnits": float(lot_units or 0),
        "label": " · ".join(part for part in [row["zone"], row["aisle"], row["rack"], f"Nivel {row['level']}"] if part),
        "createdAt": timestamp_iso(row["created_at"]),
    }


def inventory_operation_out(conn: sqlite3.Connection, operation_id: str) -> dict:
    row = conn.execute(
        "SELECT * FROM inventory_operations WHERE id=? AND business_id=?", (operation_id, current_business_id())
    ).fetchone()
    if not row:
        raise HTTPException(404, "Operación de inventario no encontrada.")
    movements = conn.execute(
        """SELECT m.*, p.name AS product_name, p.unit AS product_unit, l.code AS location_code
           FROM inventory_movements m JOIN products p ON p.id=m.product_id
           LEFT JOIN warehouse_locations l ON l.id=m.location_id
           WHERE m.business_id=? AND m.operation_id=? ORDER BY m.id""",
        (current_business_id(), operation_id),
    ).fetchall()
    return {
        "id": row["id"], "operationType": row["operation_type"], "supplierId": row["supplier_id"],
        "reference": row["reference"], "reason": row["reason"], "reasonCode": row["reason_code"],
        "invoiceRef": row["invoice_ref"], "attachmentUrl": row["attachment_url"], "notes": row["notes"],
        "createdBy": row["created_by"], "createdByName": row["created_by_name"],
        "createdAt": timestamp_iso(row["created_at"]),
        "items": [{
            "movementId": item["id"], "productId": item["product_id"], "productName": item["product_name"],
            "productUnit": item["product_unit"], "movementType": item["movement_type"],
            "quantity": item["quantity_delta"], "stockBefore": item["stock_before"], "stockAfter": item["stock_after"],
            "unitCost": item["unit_cost"], "lotId": item["lot_id"], "locationId": item["location_id"],
            "locationCode": item["location_code"], "reason": item["reason"],
        } for item in movements],
    }


def fetch_inventory_product(conn: sqlite3.Connection, product_id: str) -> sqlite3.Row:
    product = conn.execute(
        "SELECT * FROM products WHERE id=? AND business_id=? AND active=1", (product_id, current_business_id())
    ).fetchone()
    if not product:
        raise HTTPException(404, f"No se encontró el producto {product_id}.")
    return product


def require_inventory_location(conn: sqlite3.Connection, location_id: str | None, *, allow_empty: bool = True) -> sqlite3.Row | None:
    if not location_id:
        if allow_empty:
            return None
        raise HTTPException(422, "Selecciona una ubicación.")
    row = conn.execute(
        "SELECT * FROM warehouse_locations WHERE id=? AND business_id=? AND active=1",
        (location_id, current_business_id()),
    ).fetchone()
    if not row:
        raise HTTPException(422, "La ubicación seleccionada no está activa en este negocio.")
    return row


def normalize_waste_reason(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", (value or "").strip().lower()).encode("ascii", "ignore").decode("ascii")
    normalized = normalized.replace(" ", "_")
    mapping = {
        "vencido": "vencido", "vencida": "vencido", "caducado": "vencido", "caducada": "vencido",
        "danado": "danado", "danada": "danado", "dano": "danado", "averiado": "danado",
        "error_preparacion": "error_preparacion", "error_de_preparacion": "error_preparacion",
        "error": "error_preparacion", "otro": "otro", "otra": "otro",
    }
    return mapping.get(normalized, "otro")


WASTE_REASON_LABELS = {
    "vencido": "Vencido", "danado": "Dañado",
    "error_preparacion": "Error de preparación", "otro": "Otro",
}
