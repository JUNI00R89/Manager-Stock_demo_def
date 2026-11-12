from __future__ import annotations

import base64
import binascii
import json
import re
import sqlite3
import uuid

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from backend.core.config import UPLOADS_DIR
from backend.core.context import current_business_id, current_identity
from backend.core.db import audit, connection, timestamp_iso
from backend.schemas import ProductCategoryPayload, ProductImagePayload, ProductImportPayload, ProductPayload
from backend.services.catalog import ensure_product_category, insert_product, normalize_category_name, product_category_options, product_out
from backend.services.product_import import ImportFileError, build_template, decode_data_url, read_rows, row_to_payload
from backend.services.inventory import add_product_stock, allows_negative_stock, consume_product_stock, get_or_create_lot, insert_movement
from backend.services.subscriptions import subscription_for_business


router = APIRouter()


@router.get("/api/product-categories")
def list_product_categories():
    with connection() as conn:
        _, categories = product_category_options(conn, current_business_id())
        return categories


@router.post("/api/product-categories", status_code=201)
def create_product_category(payload: ProductCategoryPayload):
    identity = current_identity()
    if identity["role"] not in {"owner", "business_admin"} and "catalog.create" not in set(identity.get("permissions", [])):
        # Custom permissions are retrieved from the persisted role, not accepted from request JSON.
        if identity.get("custom_role_id"):
            with connection() as conn:
                role = conn.execute("SELECT permissions_json FROM custom_roles WHERE id=? AND business_id=?", (identity["custom_role_id"], current_business_id())).fetchone()
                permissions = set(json.loads(role["permissions_json"] or "[]")) if role else set()
            if "catalog.create" not in permissions:
                raise HTTPException(403, "Tu rol no puede crear categorías.")
        else:
            raise HTTPException(403, "Solo el propietario o un usuario autorizado puede crear categorías.")
    business_id = current_business_id()
    name = " ".join(payload.name.split())
    with connection() as conn:
        business_type, current_options = product_category_options(conn, business_id)
        key = normalize_category_name(name)
        if any(normalize_category_name(option["name"]) == key for option in current_options):
            raise HTTPException(409, "Ya existe una categoría con ese nombre en este negocio.")
        category_id = f"CAT-{uuid.uuid4().hex[:12].upper()}"
        try:
            conn.execute("INSERT INTO product_categories (id,business_id,name,description,active) VALUES (?,?,?,?,?)", (category_id, business_id, name, payload.description.strip(), 1 if payload.active else 0))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "Ya existe una categoría con ese nombre en este negocio.") from exc
        audit(conn, "create", "product_category", category_id, {"name": name, "businessType": business_type})
        row = conn.execute("SELECT id,name,description,active,created_at FROM product_categories WHERE id=?", (category_id,)).fetchone()
        return {"id": row["id"], "name": row["name"], "description": row["description"], "active": bool(row["active"]), "custom": True, "createdAt": timestamp_iso(row["created_at"])}


@router.get("/api/products")
def list_products(search: str = Query(default="", max_length=120), active: bool = True, productType: str | None = None):
    query = """SELECT p.*, s.company AS supplier_name FROM products p
               LEFT JOIN suppliers s ON s.id=p.supplier_id AND s.business_id=p.business_id
               WHERE p.business_id = ? AND p.active = ?"""
    params: list = [current_business_id(), 1 if active else 0]
    if search:
        query += " AND (lower(p.name) LIKE ? OR lower(p.sku) LIKE ? OR lower(p.category) LIKE ? OR lower(p.barcode) LIKE ?)"
        term = f"%{search.lower()}%"
        params.extend([term, term, term, term])
    if productType:
        query += " AND p.product_type = ?"
        params.append(productType)
    with connection() as conn:
        return [product_out(r) for r in conn.execute(query + " ORDER BY p.name COLLATE NOCASE", params).fetchall()]


@router.post("/api/products", status_code=201)
def create_product(payload: ProductPayload):
    product_id = f"PRD-{uuid.uuid4().hex[:10].upper()}"
    with connection() as conn:
        business = conn.execute("SELECT business_type FROM businesses WHERE id=?", (current_business_id(),)).fetchone()
        ensure_product_category(conn, current_business_id(), payload.category)
        subscription = subscription_for_business(conn, current_business_id())
        product_count = conn.execute("SELECT count(*) FROM products WHERE business_id=? AND active=1", (current_business_id(),)).fetchone()[0]
        if product_count >= subscription["plan"]["maxProducts"]:
            raise HTTPException(409, f"El plan {subscription['plan']['name']} permite hasta {subscription['plan']['maxProducts']} productos activos. Cambia de plan para añadir más.")
        if payload.supplierId:
            supplier = conn.execute("SELECT id FROM suppliers WHERE id=? AND business_id=? AND active=1", (payload.supplierId, current_business_id())).fetchone()
            if not supplier:
                raise HTTPException(422, "El proveedor principal seleccionado no está activo en este negocio.")
        if payload.defaultLocationId:
            location = conn.execute("SELECT id FROM warehouse_locations WHERE id=? AND business_id=? AND active=1", (payload.defaultLocationId, current_business_id())).fetchone()
            if not location:
                raise HTTPException(422, "La ubicación seleccionada no pertenece a este negocio.")
        try:
            conn.execute("BEGIN IMMEDIATE")
            insert_product(conn, payload, product_id, client_image_key(payload.image))
            conn.commit()
        except sqlite3.IntegrityError as exc:
            conn.rollback()
            raise HTTPException(409, "Ya existe un producto con ese SKU.") from exc
        return product_out(conn.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone())


@router.get("/api/products/import/template")
def product_import_template():
    data = base64.b64encode(build_template()).decode()
    return {"fileName": "plantilla-productos.xlsx", "dataUrl": f"data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,{data}"}


def build_import_report(conn: sqlite3.Connection, payload: ProductImportPayload) -> tuple[dict, list[ProductPayload], list[str]]:
    """Reads the file and decides, row by row, what would be created; saves nothing."""
    try:
        rows = read_rows(payload.fileName, decode_data_url(payload.dataUrl))
    except ImportFileError as exc:
        raise HTTPException(422, str(exc)) from exc
    business_id = current_business_id()
    taken = {row["sku"] for row in conn.execute("SELECT sku FROM products WHERE business_id=?", (business_id,))}
    _, options = product_category_options(conn, business_id)
    known = {normalize_category_name(option["name"]): option["name"] for option in options}
    plan = subscription_for_business(conn, business_id)["plan"]
    active = conn.execute("SELECT count(*) FROM products WHERE business_id=? AND active=1", (business_id,)).fetchone()[0]
    slots = max(0, plan["maxProducts"] - active)
    report: dict = {"toCreate": [], "skipped": [], "errors": [], "newCategories": [], "created": 0}
    payloads: list[ProductPayload] = []
    for number, fields in rows:
        try:
            product = row_to_payload(fields)
        except ValueError as exc:
            report["errors"].append({"row": number, "message": str(exc)})
            continue
        if product.sku in taken:
            report["skipped"].append({"row": number, "sku": product.sku})
            continue
        if len(payloads) >= slots:
            report["errors"].append({"row": number, "message": f"El plan {plan['name']} permite hasta {plan['maxProducts']} productos activos. Cambia de plan para añadir más."})
            continue
        taken.add(product.sku)
        key = normalize_category_name(product.category)
        if key not in known:
            known[key] = " ".join(product.category.split())
            report["newCategories"].append(known[key])
        # Products from the file use the spelling the business already has for the category.
        product = product.model_copy(update={"category": known[key]})
        payloads.append(product)
        report["toCreate"].append({"row": number, "sku": product.sku, "name": product.name, "category": product.category})
    return report, payloads, report["newCategories"]


@router.post("/api/products/import/preview")
def preview_product_import(payload: ProductImportPayload):
    with connection() as conn:
        return build_import_report(conn, payload)[0]


@router.post("/api/products/import")
def import_products(payload: ProductImportPayload):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            # Re-read inside the write lock: anything created since the preview is skipped, not duplicated.
            report, payloads, new_categories = build_import_report(conn, payload)
            for name in new_categories:
                category_id = f"CAT-{uuid.uuid4().hex[:12].upper()}"
                conn.execute("INSERT INTO product_categories (id,business_id,name,description,active) VALUES (?,?,?,?,1)", (category_id, current_business_id(), name, ""))
                audit(conn, "create", "product_category", category_id, {"name": name, "source": "import"})
            for product in payloads:
                insert_product(conn, product, f"PRD-{uuid.uuid4().hex[:10].upper()}")
            audit(conn, "import", "product", "-", {"created": len(payloads), "file": payload.fileName})
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        report["created"] = len(payloads)
        return report


@router.put("/api/products/{product_id}")
def update_product(product_id: str, payload: ProductPayload):
    with connection() as conn:
        business = conn.execute("SELECT business_type FROM businesses WHERE id=?", (current_business_id(),)).fetchone()
        if payload.supplierId:
            supplier = conn.execute("SELECT id FROM suppliers WHERE id=? AND business_id=? AND active=1", (payload.supplierId, current_business_id())).fetchone()
            if not supplier:
                raise HTTPException(422, "El proveedor principal seleccionado no está activo en este negocio.")
        if payload.defaultLocationId:
            location = conn.execute("SELECT id FROM warehouse_locations WHERE id=? AND business_id=? AND active=1", (payload.defaultLocationId, current_business_id())).fetchone()
            if not location:
                raise HTTPException(422, "La ubicación seleccionada no pertenece a este negocio.")
        try:
            conn.execute("BEGIN IMMEDIATE")
            old = conn.execute("SELECT * FROM products WHERE id=? AND business_id=? AND active=1", (product_id, current_business_id())).fetchone()
            if not old:
                raise HTTPException(404, "Producto no encontrado.")
            ensure_product_category(conn, current_business_id(), payload.category, allow_existing=(payload.category == old["category"]))
            delta = round(payload.stock - float(old["stock"] or 0), 6)
            conn.execute(
                """UPDATE products SET name=?,sku=?,category=?,price=?,cost=?,min_stock=?,description=?,image=?,product_type=?,unit=?,
                   supplier_id=?,barcode=?,track_lots=?,default_location_id=?,updated_at=CURRENT_TIMESTAMP
                   WHERE id=? AND business_id=?""",
                (payload.name.strip(), payload.sku, payload.category.strip(), payload.price, payload.cost,
                 payload.minStock, payload.description.strip(),
                 # An uploaded photo is only changed through /image; an edit sending an icon key keeps it.
                 old["image"] if (old["image"] or "").startswith(PRODUCT_IMAGE_PREFIX) else client_image_key(payload.image),
                 payload.productType, payload.unit,
                 payload.supplierId, payload.barcode.strip(), 1 if payload.trackLots else 0, payload.defaultLocationId,
                 product_id, current_business_id()),
            )
            if delta > 0:
                add_product_stock(conn, old, delta, movement_type="adjustment", note="Ajuste desde edición de producto", reason="Edición de producto", unit_cost=payload.cost)
            elif delta < 0:
                consume_product_stock(conn, old, abs(delta), movement_type="adjustment", note="Ajuste desde edición de producto", reason="Edición de producto", allow_negative=allows_negative_stock(conn))
            audit(conn, "update", "product", product_id, {"stockDelta": delta})
            conn.commit()
        except sqlite3.IntegrityError as exc:
            conn.rollback()
            raise HTTPException(409, "El SKU ya está asignado a otro producto.") from exc
        except Exception:
            conn.rollback()
            raise
        return product_out(conn.execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone())


@router.delete("/api/products/{product_id}")
def delete_product(product_id: str):
    with connection() as conn:
        row = conn.execute("SELECT id FROM products WHERE id=? AND business_id=? AND active=1", (product_id, current_business_id())).fetchone()
        if not row:
            raise HTTPException(404, "Producto no encontrado.")
        conn.execute("UPDATE products SET active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?", (product_id,))
        audit(conn, "archive", "product", product_id)
        return {"ok": True, "id": product_id}


# --- Product photos ----------------------------------------------------------
PRODUCT_IMAGES_DIR = UPLOADS_DIR / "products"
PRODUCT_IMAGE_PREFIX = "/uploads/products/"
MAX_PRODUCT_IMAGE_BYTES = 500 * 1024
SAFE_IMAGE_NAME = re.compile(r"^[0-9a-f]{32}\.(jpg|png|webp)$")


def client_image_key(value: str) -> str:
    """Icon keys from the client are fine; upload paths are only ever set by set_product_image,
    otherwise a product could point at (and later delete) another business's photo."""
    return "" if (value or "").startswith(PRODUCT_IMAGE_PREFIX) else value


def image_extension(raw: bytes) -> str | None:
    """Detect the real format from the file's magic bytes (never trust the data-URL label)."""
    if raw.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "webp"
    return None


def remove_stored_image(image: str | None) -> None:
    if image and image.startswith(PRODUCT_IMAGE_PREFIX):
        name = image[len(PRODUCT_IMAGE_PREFIX):]
        if SAFE_IMAGE_NAME.match(name):
            (PRODUCT_IMAGES_DIR / name).unlink(missing_ok=True)


def set_product_image(product_id: str, new_image: str) -> dict:
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM products WHERE id=? AND business_id=? AND active=1", (product_id, current_business_id())).fetchone()
        if not row:
            conn.rollback()
            remove_stored_image(new_image)  # nothing references the file just written
            raise HTTPException(404, "Producto no encontrado.")
        conn.execute("UPDATE products SET image=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (new_image, product_id))
        audit(conn, "update_image" if new_image else "remove_image", "product", product_id, {"image": new_image})
        conn.commit()
        remove_stored_image(row["image"])  # only after the new value is committed
        return product_out(conn.execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone())


@router.put("/api/products/{product_id}/image")
def upload_product_image(product_id: str, payload: ProductImagePayload):
    header, _, encoded = payload.dataUrl.partition(",")
    if not header.startswith("data:") or ";base64" not in header:
        raise HTTPException(422, "Envía la foto como data URL en base64.")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(422, "La foto no tiene un formato válido.") from exc
    if len(raw) > MAX_PRODUCT_IMAGE_BYTES:
        raise HTTPException(422, "La foto supera 500 KB.")
    extension = image_extension(raw)
    if not extension:
        raise HTTPException(422, "Solo se aceptan fotos JPG, PNG o WebP.")
    PRODUCT_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}.{extension}"
    (PRODUCT_IMAGES_DIR / name).write_bytes(raw)
    return set_product_image(product_id, PRODUCT_IMAGE_PREFIX + name)


@router.delete("/api/products/{product_id}/image")
def delete_product_image(product_id: str):
    return set_product_image(product_id, "")


@router.get("/uploads/products/{filename}", include_in_schema=False)
def serve_product_image(filename: str):
    # Outside /api on purpose: <img> tags cannot send the session token. Random names are not guessable.
    path = PRODUCT_IMAGES_DIR / filename
    if not SAFE_IMAGE_NAME.match(filename) or not path.is_file():
        raise HTTPException(404, "Foto no encontrada.")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=604800, immutable"})
