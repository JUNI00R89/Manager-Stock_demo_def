from __future__ import annotations

import json
import re
import sqlite3
import unicodedata

from fastapi import HTTPException

from backend.core.config import DEFAULT_CATEGORY_PRESETS
from backend.core.db import timestamp_iso


def normalize_category_name(value: str) -> str:
    collapsed = " ".join((value or "").split()).strip()
    return unicodedata.normalize("NFKD", collapsed).encode("ascii", "ignore").decode("ascii").casefold()


def canonical_business_type(value: str | None) -> str:
    raw = (value or "retail").casefold()
    return {"restaurant": "food", "comidas": "food", "food": "food"}.get(raw, raw if raw in DEFAULT_CATEGORY_PRESETS else "retail")


def product_category_options(conn: sqlite3.Connection, business_id: str) -> tuple[str, list[dict]]:
    business = conn.execute("SELECT business_type,settings_json FROM businesses WHERE id=?", (business_id,)).fetchone()
    if not business:
        raise HTTPException(404, "Negocio no encontrado.")
    try:
        settings = json.loads(business["settings_json"] or "{}")
    except json.JSONDecodeError:
        settings = {}
    type_value = settings.get("type") if isinstance(settings, dict) else None
    business_type = canonical_business_type(type_value or business["business_type"])
    default_items = [{"id": f"default-{business_type}-{i}", "name": name, "description": "Categoría sugerida para este tipo de negocio.", "active": True, "custom": False, "createdAt": None} for i, name in enumerate(DEFAULT_CATEGORY_PRESETS.get(business_type, DEFAULT_CATEGORY_PRESETS["retail"]))]
    custom_rows = conn.execute("SELECT id,name,description,active,created_at FROM product_categories WHERE business_id=? AND active=1 ORDER BY name COLLATE NOCASE", (business_id,)).fetchall()
    by_key = {normalize_category_name(item["name"]): item for item in default_items}
    for row in custom_rows:
        by_key[normalize_category_name(row["name"])] = {"id": row["id"], "name": row["name"], "description": row["description"], "active": bool(row["active"]), "custom": True, "createdAt": timestamp_iso(row["created_at"])}
    return business_type, sorted(by_key.values(), key=lambda item: item["name"].casefold())


def ensure_product_category(conn: sqlite3.Connection, business_id: str, category: str, allow_existing: bool = False) -> None:
    _, options = product_category_options(conn, business_id)
    key = normalize_category_name(category)
    if any(normalize_category_name(option["name"]) == key for option in options):
        return
    if allow_existing:
        row = conn.execute("SELECT id FROM products WHERE business_id=? AND category=? LIMIT 1", (business_id, category)).fetchone()
        if row:
            return
    raise HTTPException(422, "Selecciona una categoría disponible o crea una nueva para este negocio.")


def product_out(row: sqlite3.Row) -> dict:
    keys = set(row.keys())
    return {
        "id": row["id"], "name": row["name"], "sku": row["sku"], "category": row["category"],
        "price": row["price"], "cost": row["cost"], "stock": row["stock"], "minStock": row["min_stock"],
        "description": row["description"], "image": row["image"], "productType": row["product_type"], "unit": row["unit"],
        "supplierId": row["supplier_id"] if "supplier_id" in keys else None,
        "supplierName": row["supplier_name"] if "supplier_name" in keys else None,
        "barcode": row["barcode"] if "barcode" in keys else "",
        "trackLots": bool(row["track_lots"]) if "track_lots" in keys else False,
        "defaultLocationId": row["default_location_id"] if "default_location_id" in keys else None,
    }


def insert_product(conn: sqlite3.Connection, payload, product_id: str, image: str = "") -> None:
    """Inserts a validated product plus its opening stock movement; the caller owns the transaction."""
    from backend.core.context import current_business_id
    from backend.core.db import audit
    from backend.services.inventory import get_or_create_lot, insert_movement

    conn.execute(
        """INSERT INTO products (id,business_id,name,sku,category,price,cost,stock,min_stock,description,image,product_type,unit,
           supplier_id,barcode,track_lots,default_location_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (product_id, current_business_id(), payload.name.strip(), payload.sku, payload.category.strip(), payload.price,
         payload.cost, payload.stock, payload.minStock, payload.description.strip(), image,
         payload.productType, payload.unit, payload.supplierId, payload.barcode.strip(), 1 if payload.trackLots else 0,
         payload.defaultLocationId),
    )
    if payload.stock > 0:
        lot_id = None
        if payload.trackLots:
            lot_id = get_or_create_lot(conn, conn.execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone(), f"INICIAL-{product_id[-6:]}", None, payload.cost, payload.defaultLocationId)
            conn.execute("UPDATE product_lots SET quantity=? WHERE id=?", (payload.stock, lot_id))
        insert_movement(
            conn, product_id=product_id, movement_type="opening", quantity_delta=payload.stock,
            stock_before=0, stock_after=payload.stock, note="Existencias iniciales del producto",
            unit_cost=payload.cost, lot_id=lot_id, location_id=payload.defaultLocationId,
        )
    audit(conn, "create", "product", product_id, {"sku": payload.sku})


def sku_prefix(category: str) -> str:
    """First 3 letters of the category, without accents: "Lácteos" -> "LAC"; no letters -> "PRD"."""
    letters = "".join(ch for ch in unicodedata.normalize("NFD", category) if ch.isascii() and ch.isalpha())
    return letters[:3].upper() or "PRD"


def next_sku(conn: sqlite3.Connection, business_id: str, category: str, reserved: frozenset[str] | set[str] = frozenset()) -> str:
    """Next free code for the category, after the highest existing number (typed or generated)."""
    prefix = sku_prefix(category)
    pattern = re.compile(rf"^{prefix}-(\d+)$")
    existing = [row["sku"] for row in conn.execute("SELECT sku FROM products WHERE business_id=? AND sku LIKE ?", (business_id, f"{prefix}-%"))]
    numbers = [int(match.group(1)) for sku in [*existing, *reserved] if (match := pattern.match(sku))]
    return f"{prefix}-{max(numbers, default=0) + 1:04d}"
