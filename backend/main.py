from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import uuid
import hashlib
import hmac
import secrets
import re
import unicodedata
from contextvars import ContextVar
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator, model_validator

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.getenv("MANAGER_STOCK_DB", str(ROOT / "backend" / "data" / "manager_stock.db")))
SCHEMA_PATH = ROOT / "database" / "schema.sql"
BUSINESS_ID = os.getenv("MANAGER_STOCK_BUSINESS_ID", "negocio-demo")
BUSINESS_NAME = os.getenv("MANAGER_STOCK_BUSINESS_NAME", "Mi negocio de comidas")
CURRENCY = "COP"
DEFAULT_TAX_RATE = 0.19
SUBSCRIPTION_PLANS = {
    "free": {"id": "free", "name": "Gratis", "priceCOP": 0, "maxUsers": 1, "maxProducts": 100},
    "entrepreneur": {"id": "entrepreneur", "name": "Emprendedor", "priceCOP": 39900, "maxUsers": 3, "maxProducts": 1000},
    "business": {"id": "business", "name": "Negocio", "priceCOP": 79900, "maxUsers": 10, "maxProducts": 5000},
    "enterprise": {"id": "enterprise", "name": "Empresarial", "priceCOP": 149900, "maxUsers": 25, "maxProducts": 20000},
}

DEFAULT_CATEGORY_PRESETS: dict[str, list[str]] = {
    "retail": ["Bebidas", "Alimentos", "Aseo", "Accesorios", "Tecnología", "Ropa", "Otros"],
    "food": ["Comidas rápidas", "Hamburguesas", "Salchipapas", "Empanadas", "Almuerzos", "Bebidas", "Postres", "Adicionales", "Otros"],
    "hotel": ["Minibar", "Bebidas", "Artículos de aseo", "Productos complementarios", "Otros"],
    "warehouse": ["Materias primas", "Mercancía", "Empaques", "Herramientas", "Repuestos", "Otros"],
    "services": ["Servicios principales", "Servicios complementarios", "Productos relacionados", "Otros"],
}
DISCRETE_UNITS = {"unidad", "porcion", "porción", "paquete", "tajada", "caja", "pieza", "par", "botella", "lata", "servicio"}

app = FastAPI(title="Manager Stock API", version="1.0.0", description="API local para inventario, ventas, proveedores y pedidos.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173"],
    # Permite el acceso desde el celular/PC en la misma red al levantar el
    # backend en 0.0.0.0 y la app frontend con Vite en 0.0.0.0.
    allow_origin_regex=r"^https?://([0-9]{1,3}\.){3}[0-9]{1,3}(:[0-9]+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request-scoped identity: never keep a tenant or user in a mutable global variable.
_current_identity: ContextVar[dict | None] = ContextVar("manager_stock_identity", default=None)


def current_identity() -> dict:
    identity = _current_identity.get()
    if not identity:
        raise HTTPException(status_code=401, detail="Inicia sesión para continuar.")
    return identity


def current_business_id() -> str:
    identity = current_identity()
    business_id = identity.get("business_id")
    if not business_id:
        raise HTTPException(status_code=403, detail="Esta operación requiere un negocio asignado.")
    return str(business_id)


def hash_password(password: str, salt: str | None = None) -> str:
    if len(password) < 8:
        raise ValueError("La contraseña debe tener al menos 8 caracteres.")
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 310_000).hex()
    return f"pbkdf2_sha256$310000${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, rounds, salt, expected = stored.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), int(rounds)).hex()
        return hmac.compare_digest(digest, expected)
    except (ValueError, TypeError):
        return False


def public_user(row: sqlite3.Row, conn: sqlite3.Connection | None = None) -> dict:
    keys = set(row.keys())
    result = {
        "id": row["id"], "email": row["email"], "name": row["full_name"],
        "role": row["role"], "businessId": row["business_id"],
        "active": bool(row["active"]), "subscription": "basic",
    }
    custom_role_id = row["custom_role_id"] if "custom_role_id" in keys else None
    result["customRoleId"] = custom_role_id
    result["customRoleName"] = None
    result["permissions"] = []
    result["businessActive"] = True
    result["suspensionReason"] = ""
    result["suspensionDescription"] = ""
    result["suspendedAt"] = None
    if conn is not None and custom_role_id:
        custom_role = conn.execute(
            "SELECT name,permissions_json FROM custom_roles WHERE id=? AND business_id=?",
            (custom_role_id, row["business_id"]),
        ).fetchone()
        if custom_role:
            result["customRoleName"] = custom_role["name"]
            try:
                result["permissions"] = json.loads(custom_role["permissions_json"] or "[]")
            except json.JSONDecodeError:
                result["permissions"] = []
    if conn is not None and row["business_id"]:
        business = conn.execute(
            "SELECT active,suspension_reason,suspension_description,suspended_at FROM businesses WHERE id=?",
            (row["business_id"],),
        ).fetchone()
        if business:
            result["businessActive"] = bool(business["active"])
            result["suspensionReason"] = business["suspension_reason"] or ""
            result["suspensionDescription"] = business["suspension_description"] or ""
            result["suspendedAt"] = timestamp_iso(business["suspended_at"])
    return result


DELEGABLE_PERMISSIONS = {
    "dashboard.view", "catalog.view", "catalog.create", "catalog.edit",
    "inventory.view", "inventory.edit", "inventory.entry", "inventory.adjust",
    "inventory.delete", "inventory.negative", "purchases.approve",
    "suppliers.view", "suppliers.manage",
    "sales.view", "sales.create", "sales.cancel", "cash.view", "cash.manage",
    "orders.view", "orders.manage", "reports.view", "activity.view",
    "hotel.view", "hotel.manage", "services.view", "services.manage",
}


def custom_permissions(identity: dict | None = None) -> set[str]:
    """Effective delegated permissions for the signed-in custom role."""
    identity = identity or current_identity()
    if not identity.get("custom_role_id"):
        return set()
    with connection() as conn:
        row = conn.execute(
            "SELECT permissions_json FROM custom_roles WHERE id=? AND business_id=?",
            (identity["custom_role_id"], identity.get("business_id")),
        ).fetchone()
    try:
        return set(json.loads(row["permissions_json"] or "[]")) if row else set()
    except json.JSONDecodeError:
        return set()


def has_permission(permission: str) -> bool:
    identity = current_identity()
    if identity["role"] in {"owner", "business_admin"}:
        return True
    return permission in custom_permissions(identity)


def required_permission_for_request(path: str, method: str) -> str | None:
    if path == "/api/dashboard": return "dashboard.view"
    if path == "/api/product-categories": return "catalog.view" if method == "GET" else "catalog.create"
    if path.startswith("/api/hotel/rooms") or path.startswith("/api/hotel/reservations"):
        return "hotel.view" if method == "GET" else "hotel.manage"
    if path.startswith("/api/services/catalog") or path.startswith("/api/services/professionals") or path.startswith("/api/services/appointments"):
        return "services.view" if method == "GET" else "services.manage"
    if path == "/api/products":
        return "catalog.view" if method == "GET" else "catalog.create"
    if path.startswith("/api/products/"):
        return "catalog.view" if method == "GET" else "catalog.edit"
    if path == "/api/suppliers":
        return "suppliers.view" if method == "GET" else "suppliers.manage"
    if path.startswith("/api/suppliers/"):
        return "suppliers.view" if method == "GET" else "suppliers.manage"
    if path == "/api/recipes":
        return "catalog.view" if method == "GET" else "catalog.edit"
    if path.startswith("/api/recipes/"):
        return "catalog.view" if method == "GET" else "catalog.edit"
    if path.startswith("/api/inventory/"):
        if path.startswith("/api/inventory/purchase-orders"):
            if method == "GET":
                return "inventory.view"
            if "/receive" in path:
                return "inventory.entry"
            if "/approve" in path or "/send" in path or "/cancel" in path:
                return "purchases.approve"
            return "inventory.entry"
        if method == "GET":
            return "inventory.view"
        if method == "DELETE":
            return "inventory.delete"
        if path.startswith("/api/inventory/adjustments") or path.startswith("/api/inventory/counts"):
            return "inventory.adjust"
        if path == "/api/inventory/settings":
            return "inventory.edit"
        if path.startswith("/api/inventory/locations"):
            return "inventory.edit"
        return "inventory.entry"
    if path == "/api/sales":
        return "sales.view" if method == "GET" else "sales.create"
    if path.startswith("/api/sales/") and path.endswith("/cancel"):
        return "sales.cancel"
    if path.startswith("/api/sales/"):
        return "sales.view"
    if path.startswith("/api/cash/"):
        return "cash.view" if method == "GET" else "cash.manage"
    if path == "/api/orders":
        return "orders.view" if method == "GET" else "orders.manage"
    if path.startswith("/api/orders/"):
        return "orders.manage"
    if path.startswith("/api/reports"):
        return "reports.view"
    if path == "/api/audit":
        return "activity.view"
    return None


def issue_session(conn: sqlite3.Connection, user_id: str) -> str:
    token = secrets.token_urlsafe(36)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    expires = (datetime.now(timezone.utc) + timedelta(hours=12)).isoformat(timespec="seconds")
    conn.execute("INSERT INTO auth_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)", (token_hash, user_id, expires))
    return token


@app.middleware("http")
async def authenticate_and_authorize(request: Request, call_next):
    path = request.url.path
    if not path.startswith("/api/") or request.method == "OPTIONS" or path in {
        "/api/health", "/api/auth/login", "/api/auth/register", "/api/subscription/plans"
    }:
        return await call_next(request)

    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        return JSONResponse(status_code=401, content={"detail": "Sesión no válida. Inicia sesión nuevamente."})
    token = auth_header[7:].strip()
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    try:
        with connection() as conn:
            row = conn.execute("""SELECT u.id,u.business_id,u.email,u.full_name,u.role,u.custom_role_id,u.active,
                u.created_at,b.active AS business_active,b.suspension_reason,b.suspension_description,b.suspended_at,s.token_hash
                FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id
                LEFT JOIN businesses b ON b.id=u.business_id
                WHERE s.token_hash=? AND s.expires_at>?""", (token_hash, datetime.now(timezone.utc).isoformat(timespec="seconds"))).fetchone()
    except sqlite3.OperationalError:
        return JSONResponse(status_code=503, content={"detail": "La base de datos aún no está inicializada. Reinicia el backend."})
    if not row or not row["active"]:
        return JSONResponse(status_code=401, content={"detail": "La sesión expiró o la cuenta está inactiva."})
    identity = {
        "id": row["id"], "business_id": row["business_id"], "email": row["email"],
        "name": row["full_name"], "role": row["role"], "custom_role_id": row["custom_role_id"],
        "business_active": bool(row["business_active"]) if row["business_active"] is not None else True,
        "token_hash": row["token_hash"],
    }
    role = identity["role"]
    is_suspended = bool(row["business_id"] and row["business_active"] == 0)
    suspension_allowed_paths = {
        "/api/auth/me", "/api/auth/logout", "/api/suspension/status",
        "/api/support/messages", "/api/support/case",
    }
    if is_suspended:
        if role != "owner" or path not in suspension_allowed_paths:
            return JSONResponse(status_code=403, content={
                "detail": "El negocio está suspendido. Puedes consultar el motivo y comunicarte con soporte desde la pantalla de suspensión.",
                "code": "BUSINESS_SUSPENDED",
            })

    # A custom role is restricted to an explicit allow-list evaluated on the server.
    if identity["custom_role_id"] and not is_suspended and path not in {"/api/auth/me", "/api/auth/logout"}:
        try:
            with connection() as conn:
                role_row = conn.execute("SELECT permissions_json FROM custom_roles WHERE id=? AND business_id=?", (identity["custom_role_id"], identity["business_id"])).fetchone()
            custom_permissions = set(json.loads(role_row["permissions_json"] or "[]")) if role_row else set()
        except (sqlite3.OperationalError, json.JSONDecodeError, TypeError):
            custom_permissions = set()
        required_permission = required_permission_for_request(path, request.method)
        if not required_permission or required_permission not in custom_permissions:
            return JSONResponse(status_code=403, content={"detail": "Tu rol personalizado no tiene permiso para esta operación."})
    # Enforce enabled business modules on the API as well as the navigation.
    # A hidden frontend route alone is not authorization.
    if role != "superadmin":
        module = None
        if path.startswith("/api/products") or path.startswith("/api/product-categories") or path.startswith("/api/recipes"):
            module = "catalog_read" if request.method == "GET" else "catalog_write"
        elif path.startswith("/api/hotel/"):
            module = "hotel"
        elif path.startswith("/api/services/"):
            module = "services"
        elif path.startswith("/api/suppliers") or path.startswith("/api/inventory/"):
            module = "inventory"
        elif path.startswith("/api/sales") or path.startswith("/api/cash/"):
            module = "pos"
        elif path.startswith("/api/orders"):
            module = "orders"
        if module:
            try:
                with connection() as conn:
                    business_row = conn.execute("SELECT business_type,settings_json FROM businesses WHERE id=?", (identity["business_id"],)).fetchone()
                settings = json.loads(business_row["settings_json"] or "{}") if business_row else {}
                features = settings.get("features", {}) if isinstance(settings, dict) else {}
                if module == "catalog_read":
                    food_modules = settings.get("foodConfig", {}).get("activeModules", []) if isinstance(settings, dict) and isinstance(settings.get("foodConfig"), dict) else []
                    has_food_menu = bool(business_row and business_row["business_type"] == "food" and "menu" in food_modules)
                    enabled = bool(features.get("inventory") or features.get("pos") or has_food_menu)
                elif module == "catalog_write":
                    food_modules = settings.get("foodConfig", {}).get("activeModules", []) if isinstance(settings, dict) and isinstance(settings.get("foodConfig"), dict) else []
                    has_food_menu = bool(business_row and business_row["business_type"] == "food" and "menu" in food_modules)
                    enabled = bool(features.get("inventory") or has_food_menu)
                elif module == "hotel":
                    enabled = bool(business_row and business_row["business_type"] == "hotel" and (features.get("rooms") or features.get("reservations")))
                elif module == "services":
                    enabled = bool(business_row and business_row["business_type"] == "services" and (features.get("services") or features.get("reservations")))
                elif module == "inventory":
                    enabled = bool(features.get("inventory"))
                elif module == "pos":
                    enabled = bool(features.get("pos"))
                else:
                    food = business_row and business_row["business_type"] == "food"
                    active_modules = settings.get("foodConfig", {}).get("activeModules", []) if isinstance(settings, dict) and isinstance(settings.get("foodConfig"), dict) else []
                    enabled = bool(food and "pedidos" in active_modules)
            except (sqlite3.OperationalError, json.JSONDecodeError, TypeError):
                enabled = False
            if not enabled:
                return JSONResponse(status_code=403, content={"detail": "Este módulo no está habilitado en la configuración de tu negocio."})

    if role == "superadmin":
        if not (path.startswith("/api/platform/") or path in {"/api/auth/me", "/api/auth/logout"}):
            return JSONResponse(status_code=403, content={"detail": "El SUPERADMIN debe utilizar los módulos de administración global."})
    elif path.startswith("/api/platform/"):
        return JSONResponse(status_code=403, content={"detail": "Solo el SUPERADMIN puede administrar la plataforma."})
    elif role == "cashier" and not identity["custom_role_id"]:
        allowed = False
        if path in {"/api/auth/me", "/api/auth/logout"}:
            allowed = True
        elif path == "/api/products":
            allowed = request.method == "GET"
        elif path == "/api/dashboard":
            allowed = request.method == "GET"
        elif path == "/api/sales":
            allowed = request.method in {"GET", "POST"}
        elif path.startswith("/api/sales/by-key/") or (path.startswith("/api/sales/") and not path.endswith("/cancel")):
            allowed = request.method == "GET"
        elif path in {"/api/orders", "/api/cash/sessions", "/api/cash/sessions/current"}:
            allowed = request.method in {"GET", "POST"}
        elif path.startswith("/api/cash/sessions/"):
            allowed = request.method in {"GET", "POST"}
        elif path.startswith("/api/orders/") and request.method == "PATCH":
            allowed = True
        if not allowed:
            return JSONResponse(status_code=403, content={"detail": "Tu rol de cajero no permite esta operación."})
    elif role == "business_admin":
        if path == "/api/business/config" and request.method in {"PUT", "PATCH"}:
            return JSONResponse(status_code=403, content={"detail": "Solo el propietario puede cambiar la configuración del negocio."})
        if path == "/api/subscription" or path.startswith("/api/platform/"):
            return JSONResponse(status_code=403, content={"detail": "Esta acción está reservada al propietario o al SUPERADMIN."})

    marker = _current_identity.set(identity)
    try:
        return await call_next(request)
    finally:
        _current_identity.reset(marker)


@contextmanager
def connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    try:
        yield conn
    finally:
        conn.close()


def timestamp_iso(value: str | None) -> str | None:
    """Normalize SQLite timestamps (often naive UTC) to explicit UTC ISO strings."""
    if not value:
        return None
    raw = str(value).strip().replace(" ", "T", 1)
    parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds")


def audit(conn: sqlite3.Connection, action: str, entity_type: str, entity_id: str, details: dict | None = None):
    conn.execute(
        "INSERT INTO audit_log (business_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)",
        (current_business_id(), action, entity_type, entity_id, json.dumps(details or {}, ensure_ascii=False)),
    )


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


def table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return bool(conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone())


def table_has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    if not table_exists(conn, table):
        return False
    return column in {row["name"] for row in conn.execute(f'PRAGMA table_info("{table}")').fetchall()}


INVENTORY_MOVEMENTS_V2 = """
CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  sale_id TEXT REFERENCES sales(id),
  order_id TEXT REFERENCES orders(id),
  operation_id TEXT REFERENCES inventory_operations(id),
  lot_id TEXT REFERENCES product_lots(id),
  location_id TEXT REFERENCES warehouse_locations(id),
  movement_type TEXT NOT NULL CHECK(movement_type IN ('opening','purchase','customer_return','donation','sale','sale_cancelled','recipe_consumption','consumption','adjustment','transfer_in','transfer_out','waste','count_adjustment','production')),
  quantity_delta REAL NOT NULL,
  stock_before REAL NOT NULL,
  stock_after REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_by_name TEXT NOT NULL DEFAULT '',
  reference_type TEXT NOT NULL DEFAULT '',
  reference_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_date ON inventory_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_business_date ON inventory_movements(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_type ON inventory_movements(business_id, movement_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_sale ON inventory_movements(sale_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_reference ON inventory_movements(business_id, reference_type, reference_id);
"""


def migrate_inventory_schema(conn: sqlite3.Connection) -> None:
    """Non-destructive migration for local databases created by earlier versions."""
    for column, definition in {
        "supplier_id": "TEXT REFERENCES suppliers(id)",
        "barcode": "TEXT NOT NULL DEFAULT ''",
        "track_lots": "INTEGER NOT NULL DEFAULT 0 CHECK(track_lots IN (0,1))",
        "default_location_id": "TEXT REFERENCES warehouse_locations(id)",
    }.items():
        if not table_has_column(conn, "products", column):
            conn.execute(f"ALTER TABLE products ADD COLUMN {column} {definition}")
    if not table_has_column(conn, "orders", "stock_consumed"):
        conn.execute("ALTER TABLE orders ADD COLUMN stock_consumed INTEGER NOT NULL DEFAULT 0")
    if not table_has_column(conn, "recipe_items", "unit"):
        conn.execute("ALTER TABLE recipe_items ADD COLUMN unit TEXT NOT NULL DEFAULT ''")
    products_sql_row = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='products'").fetchone()
    if products_sql_row and "CHECK(stock >= 0)" in (products_sql_row["sql"] or ""):
        # Negative stock is a tenant-configurable policy; remove the old hard check.
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute("""CREATE TABLE products_new (
            id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), name TEXT NOT NULL,
            sku TEXT NOT NULL, category TEXT NOT NULL, price REAL NOT NULL CHECK(price >= 0),
            cost REAL NOT NULL DEFAULT 0 CHECK(cost >= 0), stock REAL NOT NULL DEFAULT 0,
            min_stock REAL NOT NULL DEFAULT 0 CHECK(min_stock >= 0), description TEXT NOT NULL DEFAULT '',
            image TEXT NOT NULL DEFAULT '', product_type TEXT NOT NULL DEFAULT 'sale_item' CHECK(product_type IN ('sale_item','ingredient','supplies')),
            unit TEXT NOT NULL DEFAULT 'unidad', supplier_id TEXT REFERENCES suppliers(id), barcode TEXT NOT NULL DEFAULT '',
            track_lots INTEGER NOT NULL DEFAULT 0 CHECK(track_lots IN (0,1)), default_location_id TEXT REFERENCES warehouse_locations(id),
            active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(business_id, sku))""")
        conn.execute("""INSERT INTO products_new
            (id,business_id,name,sku,category,price,cost,stock,min_stock,description,image,product_type,unit,
             supplier_id,barcode,track_lots,default_location_id,active,created_at,updated_at)
            SELECT id,business_id,name,sku,category,price,cost,stock,min_stock,description,image,product_type,unit,
             supplier_id,barcode,track_lots,default_location_id,active,created_at,updated_at FROM products""")
        conn.execute("DROP TABLE products")
        conn.execute("ALTER TABLE products_new RENAME TO products")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_products_business_active ON products(business_id, active)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(business_id,barcode)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(business_id,supplier_id)")
        conn.execute("PRAGMA foreign_keys = ON")
    movement_sql = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='inventory_movements'").fetchone()
    needs_rebuild = bool(movement_sql) and ("operation_id" not in (movement_sql["sql"] or "") or "customer_return" not in (movement_sql["sql"] or ""))
    if needs_rebuild:
        # SQLite cannot alter a CHECK constraint, so rebuild the movement journal while
        # preserving every historical row. No table references inventory_movements.
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute("DROP INDEX IF EXISTS idx_inventory_movements_product_date")
        conn.execute("ALTER TABLE inventory_movements RENAME TO inventory_movements_legacy")
        conn.executescript(INVENTORY_MOVEMENTS_V2)
        conn.execute("""INSERT INTO inventory_movements
            (id,business_id,product_id,sale_id,movement_type,quantity_delta,stock_before,stock_after,note,created_at)
            SELECT id,business_id,product_id,sale_id,movement_type,quantity_delta,stock_before,stock_after,note,created_at
            FROM inventory_movements_legacy""")
        conn.execute("DROP TABLE inventory_movements_legacy")
        conn.execute("PRAGMA foreign_keys = ON")


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


def delete_business_type_data(conn: sqlite3.Connection, business_id: str, old_type: str) -> list[str]:
    """Delete only records belonging to the former type-specific module. Common products, sales, users and audit are never deleted."""
    deleted: list[str] = []
    old_type = canonical_business_type(old_type)
    if old_type == "food":
        if table_exists(conn, "order_items") and table_exists(conn, "orders"):
            conn.execute("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE business_id=?)", (business_id,))
            deleted.append("order_items")
        if table_exists(conn, "orders") and table_has_column(conn, "orders", "business_id"):
            conn.execute("DELETE FROM orders WHERE business_id=?", (business_id,))
            deleted.append("orders")
        if table_exists(conn, "restaurant_tables") and table_has_column(conn, "restaurant_tables", "business_id"):
            conn.execute("DELETE FROM restaurant_tables WHERE business_id=?", (business_id,))
            deleted.append("restaurant_tables")
        if table_exists(conn, "recipe_items") and table_exists(conn, "recipes"):
            conn.execute("DELETE FROM recipe_items WHERE recipe_id IN (SELECT id FROM recipes WHERE business_id=?)", (business_id,))
            deleted.append("recipe_items")
        if table_exists(conn, "recipes") and table_has_column(conn, "recipes", "business_id"):
            conn.execute("DELETE FROM recipes WHERE business_id=?", (business_id,))
            deleted.append("recipes")
    # Optional future module tables are deleted only if a migration has created the table
    # and it contains an explicit business_id column. No broad table scans or cascades are used.
    optional_by_type = {
        # Child rows must be deleted before parent rows to preserve foreign-key integrity.
        "hotel": ["reservation_items", "hotel_reservations", "reservations", "housekeeping_tasks", "hotel_rooms"],
        "services": ["service_appointments", "appointment_items", "appointments", "service_slots", "service_catalog", "service_professionals", "business_services"],
        "warehouse": ["warehouse_transfer_items", "warehouse_transfers", "warehouse_locations"],
    }
    for table in optional_by_type.get(old_type, []):
        if table_has_column(conn, table, "business_id"):
            conn.execute(f'DELETE FROM "{table}" WHERE business_id=?', (business_id,))
            deleted.append(table)
    return deleted


def process_due_type_transitions() -> int:
    """Expire transitions based on persisted UTC deadlines; safe to run repeatedly."""
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    processed = 0
    with connection() as conn:
        if not table_exists(conn, "business_type_transitions"):
            return 0
        rows = conn.execute("SELECT * FROM business_type_transitions WHERE status='pending' AND expires_at<=? ORDER BY expires_at", (now,)).fetchall()
        for transition in rows:
            conn.execute("BEGIN IMMEDIATE")
            business = conn.execute("SELECT business_type,settings_json FROM businesses WHERE id=?", (transition["business_id"],)).fetchone()
            active_type = canonical_business_type(business["business_type"] if business else "retail")
            # If the business has switched back to the old type, keep those module records.
            deleted_tables: list[str] = []
            final_status = "preserved" if active_type == canonical_business_type(transition["old_type"]) else "expired"
            if business and final_status == "expired":
                deleted_tables = delete_business_type_data(conn, transition["business_id"], transition["old_type"])
            try:
                details = json.loads(transition["cleanup_json"] or "{}")
            except json.JSONDecodeError:
                details = {}
            details["deletedTables"] = deleted_tables
            details["processedAt"] = now
            conn.execute("UPDATE business_type_transitions SET status=?,cleaned_at=?,cleanup_json=? WHERE id=? AND status='pending'", (final_status, now, json.dumps(details, ensure_ascii=False), transition["id"]))
            if table_exists(conn, "audit_log"):
                conn.execute("INSERT INTO audit_log (business_id,user_id,action,entity_type,entity_id,details) VALUES (?,NULL,?,?,?,?)", (transition["business_id"], "type_transition_expired" if final_status == "expired" else "type_transition_preserved", "business_type_transition", transition["id"], json.dumps(details, ensure_ascii=False)))
            conn.commit()
            processed += 1
    return processed


async def transition_cleanup_worker():
    while True:
        try:
            process_due_type_transitions()
        except asyncio.CancelledError:
            raise
        except Exception:
            # The next cycle retries. The persisted queue remains intact.
            pass
        await asyncio.sleep(60)


def get_sale(conn: sqlite3.Connection, sale_id: str) -> dict | None:
    sale = conn.execute("SELECT * FROM sales WHERE id = ? AND business_id = ?", (sale_id, current_business_id())).fetchone()
    if not sale:
        return None
    items = conn.execute("SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id", (sale_id,)).fetchall()
    mapped_items = [{
        "productId": i["product_id"], "productName": i["product_name"], "sku": i["sku_snapshot"],
        "quantity": i["quantity"], "price": i["unit_price"],
        "unitCost": i["unit_cost_snapshot"] if "unit_cost_snapshot" in i.keys() else 0,
        "discountPercent": i["discount_percent"], "subtotal": i["line_total"],
    } for i in items]
    count_products = len(mapped_items)
    product_names = ", ".join(i["productName"] for i in mapped_items[:2])
    if count_products > 2:
        product_names += f" y {count_products - 2} más"
    payment_rows = conn.execute("SELECT method, amount FROM sale_payments WHERE sale_id = ? ORDER BY id", (sale_id,)).fetchall()
    return {
        "id": sale["id"], "date": timestamp_iso(sale["created_at"]), "status": sale["status"], "customer": sale["customer"],
        "paymentMethod": sale["payment_method"], "currency": sale["currency"], "subtotal": sale["subtotal"],
        "lineDiscount": sale["line_discount"], "globalDiscount": sale["global_discount"],
        "taxRate": sale["tax_rate"], "tax": sale["tax"], "totalPrice": sale["total"],
        "cashSessionId": sale["cash_session_id"], "createdBy": sale["created_by"],
        "payments": [{"method": row["method"], "amount": row["amount"]} for row in payment_rows],
        "productId": mapped_items[0]["productId"] if mapped_items else "", "productName": product_names or "Venta sin productos",
        "quantity": sum(i["quantity"] for i in mapped_items), "items": mapped_items,
    }


@app.on_event("startup")
async def startup():
    with connection() as conn:
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        migrate_inventory_schema(conn)
        business_columns = {row["name"] for row in conn.execute("PRAGMA table_info(businesses)").fetchall()}
        if "settings_json" not in business_columns:
            conn.execute("ALTER TABLE businesses ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}' ")
        if "active" not in business_columns:
            conn.execute("ALTER TABLE businesses ADD COLUMN active INTEGER NOT NULL DEFAULT 1")
        if "suspension_reason" not in business_columns:
            conn.execute("ALTER TABLE businesses ADD COLUMN suspension_reason TEXT NOT NULL DEFAULT ''")
        if "suspension_description" not in business_columns:
            conn.execute("ALTER TABLE businesses ADD COLUMN suspension_description TEXT NOT NULL DEFAULT ''")
        if "suspended_at" not in business_columns:
            conn.execute("ALTER TABLE businesses ADD COLUMN suspended_at TEXT")
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS auth_users (
                id TEXT PRIMARY KEY,
                business_id TEXT REFERENCES businesses(id),
                full_name TEXT NOT NULL,
                email TEXT NOT NULL COLLATE NOCASE UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('superadmin','owner','business_admin','cashier')),
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS auth_sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_auth_users_business ON auth_users(business_id,role,active);
            CREATE TABLE IF NOT EXISTS platform_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                actor_id TEXT NOT NULL REFERENCES auth_users(id),
                action TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                details TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS custom_roles (
                id TEXT PRIMARY KEY,
                business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                permissions_json TEXT NOT NULL DEFAULT '[]',
                created_by TEXT NOT NULL REFERENCES auth_users(id),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(business_id,name)
            );
            CREATE TABLE IF NOT EXISTS support_cases (
                id TEXT PRIMARY KEY,
                business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
                reason TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_review','awaiting_business','resolved','closed')),
                created_by TEXT REFERENCES auth_users(id),
                updated_by TEXT REFERENCES auth_users(id),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS support_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                case_id TEXT NOT NULL REFERENCES support_cases(id) ON DELETE CASCADE,
                business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
                sender_id TEXT NOT NULL REFERENCES auth_users(id),
                sender_role TEXT NOT NULL,
                message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 4000),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                read_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_support_cases_business_status ON support_cases(business_id,status,updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_support_messages_case ON support_messages(case_id,id);
            CREATE TABLE IF NOT EXISTS business_subscriptions (
                business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
                plan_id TEXT NOT NULL DEFAULT 'free',
                status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','pending_payment','expired','cancelled')),
                pending_plan_id TEXT,
                started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                expires_at TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        """)
        user_columns = {row["name"] for row in conn.execute("PRAGMA table_info(auth_users)").fetchall()}
        if "custom_role_id" not in user_columns:
            conn.execute("ALTER TABLE auth_users ADD COLUMN custom_role_id TEXT")
        # Lightweight migration for databases created by earlier local versions.
        sale_columns = {row["name"] for row in conn.execute("PRAGMA table_info(sales)").fetchall()}
        if "cash_session_id" not in sale_columns:
            conn.execute("ALTER TABLE sales ADD COLUMN cash_session_id TEXT REFERENCES cash_sessions(id)")
        cash_columns = {row["name"] for row in conn.execute("PRAGMA table_info(cash_sessions)").fetchall()}
        if "opened_by_user_id" not in cash_columns:
            conn.execute("ALTER TABLE cash_sessions ADD COLUMN opened_by_user_id TEXT REFERENCES auth_users(id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_cash_sessions_user_status ON cash_sessions(business_id,opened_by_user_id,status,opened_at DESC)")
        item_columns = {row["name"] for row in conn.execute("PRAGMA table_info(sale_items)").fetchall()}
        if "unit_cost_snapshot" not in item_columns:
            conn.execute("ALTER TABLE sale_items ADD COLUMN unit_cost_snapshot REAL NOT NULL DEFAULT 0")
        # Mesas del salón: columnas añadidas por versiones anteriores de Manager Stock.
        order_columns = {row["name"] for row in conn.execute("PRAGMA table_info(orders)").fetchall()}
        if "table_number" not in order_columns:
            conn.execute("ALTER TABLE orders ADD COLUMN table_number INTEGER")
        if "waiter" not in order_columns:
            conn.execute("ALTER TABLE orders ADD COLUMN waiter TEXT NOT NULL DEFAULT ''")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(business_id, table_number)")
        # Si un negocio de comidas ya tiene mesas guardadas, el módulo de mesas
        # debe quedar habilitado aunque su configuración sea anterior a la fusión.
        try:
            food_businesses = conn.execute("SELECT id, settings_json FROM businesses WHERE business_type='food'").fetchall()
            for business in food_businesses:
                has_table = conn.execute("SELECT 1 FROM restaurant_tables WHERE business_id=? LIMIT 1", (business["id"],)).fetchone()
                if not has_table:
                    continue
                try:
                    settings = json.loads(business["settings_json"] or "{}")
                except json.JSONDecodeError:
                    settings = {}
                if not isinstance(settings, dict):
                    settings = {}
                features = settings.get("features") if isinstance(settings.get("features"), dict) else {}
                food_config = settings.get("foodConfig") if isinstance(settings.get("foodConfig"), dict) else {}
                active_modules = food_config.get("activeModules") if isinstance(food_config.get("activeModules"), list) else []
                changed = False
                if features.get("tables") is not True:
                    features["tables"] = True
                    changed = True
                if "mesas" not in active_modules:
                    active_modules.append("mesas")
                    changed = True
                if changed:
                    settings["features"] = features
                    food_config["activeModules"] = active_modules
                    settings["foodConfig"] = food_config
                    conn.execute("UPDATE businesses SET settings_json=? WHERE id=?", (json.dumps(settings, ensure_ascii=False), business["id"]))
        except sqlite3.OperationalError:
            pass
        # New installations no longer receive a fake demo business or pretend sales stock.
        # Historical databases are left intact; no user data is removed during startup.
        process_due_type_transitions()
        app.state.transition_cleanup_task = asyncio.create_task(transition_cleanup_worker())


@app.on_event("shutdown")
async def shutdown():
    task = getattr(app.state, "transition_cleanup_task", None)
    if task is not None:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


class PlatformCreateUserPayload(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=160)
    password: str = Field(min_length=8, max_length=128)
    role: Literal["superadmin", "owner", "business_admin", "cashier"]
    businessId: str | None = Field(default=None, max_length=80)

    @field_validator("email")
    @classmethod
    def normalize_platform_email(cls, value: str):
        normalized = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", normalized):
            raise ValueError("Introduce un correo electrónico válido.")
        return normalized


class ProductPayload(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    sku: str = Field(min_length=2, max_length=60)
    category: str = Field(min_length=2, max_length=80)
    price: float = Field(ge=0)
    stock: float = Field(ge=0)
    minStock: float = Field(ge=0)
    description: str = Field(default="", max_length=1000)
    image: str = Field(default="", max_length=120)
    cost: float = Field(default=0, ge=0)
    productType: Literal["sale_item", "ingredient", "supplies"] = "sale_item"
    unit: str = Field(default="unidad", max_length=32)
    supplierId: str | None = Field(default=None, max_length=80)
    barcode: str = Field(default="", max_length=120)
    trackLots: bool = False
    defaultLocationId: str | None = Field(default=None, max_length=80)

    @field_validator("sku")
    @classmethod
    def normalize_sku(cls, value: str):
        return value.strip().upper()

    @field_validator("name", "category", "unit")
    @classmethod
    def normalize_text_fields(cls, value: str):
        return " ".join(value.split())

    @model_validator(mode="after")
    def validate_stock_precision(self):
        unit = unicodedata.normalize("NFKD", self.unit).encode("ascii", "ignore").decode().casefold()
        if unit in DISCRETE_UNITS and (not float(self.stock).is_integer() or not float(self.minStock).is_integer()):
            raise ValueError("Las existencias y el stock mínimo deben ser números enteros para esta unidad de medida.")
        return self


class ProductCategoryPayload(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str = Field(default="", max_length=400)
    active: bool = True

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str):
        value = " ".join(value.split())
        if len(value) < 2:
            raise ValueError("El nombre de categoría debe tener al menos dos caracteres.")
        return value


class HotelRoomPayload(BaseModel):
    roomNumber: str = Field(min_length=1, max_length=20)
    roomType: Literal["simple", "single", "double", "suite", "deluxe", "familiar"] = "double"
    floor: int = Field(default=1, ge=0, le=200)
    capacity: int = Field(default=2, ge=1, le=50)
    pricePerNight: float = Field(default=0, ge=0)
    status: Literal["available", "occupied", "reserved", "maintenance", "cleaning"] = "available"
    amenities: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("roomNumber")
    @classmethod
    def normalize_room_number(cls, value: str):
        value = " ".join(value.split()).upper()
        if not value:
            raise ValueError("El número de habitación es obligatorio.")
        return value


class HotelReservationPayload(BaseModel):
    roomId: str = Field(min_length=1, max_length=80)
    guestName: str = Field(min_length=2, max_length=120)
    guestEmail: str = Field(default="", max_length=160)
    guestPhone: str = Field(default="", max_length=40)
    checkIn: str
    checkOut: str
    advance: float = Field(default=0, ge=0)

    @field_validator("guestName")
    @classmethod
    def normalize_guest_name(cls, value: str):
        return " ".join(value.split())

    @model_validator(mode="after")
    def validate_dates(self):
        try:
            start = datetime.strptime(self.checkIn, "%Y-%m-%d").date()
            end = datetime.strptime(self.checkOut, "%Y-%m-%d").date()
        except ValueError as exc:
            raise ValueError("Las fechas de check-in y check-out deben usar AAAA-MM-DD.") from exc
        if end <= start:
            raise ValueError("El check-out debe ser posterior al check-in.")
        return self


class HotelReservationStatusPayload(BaseModel):
    status: Literal["confirmed", "checkin", "checkout", "cancelled"]


class ServicePayload(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    durationMinutes: int = Field(default=30, gt=0, le=1440)
    price: float = Field(default=0, ge=0)
    category: str = Field(default="Servicios principales", max_length=80)
    color: str = Field(default="#315F68", pattern=r"^#[0-9a-fA-F]{6}$")


class ProfessionalPayload(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    specialty: str = Field(default="", max_length=120)
    color: str = Field(default="#315F68", pattern=r"^#[0-9a-fA-F]{6}$")
    availability: list[dict] = Field(default_factory=list, max_length=100)


class AppointmentPayload(BaseModel):
    serviceId: str = Field(min_length=1, max_length=80)
    professionalId: str = Field(min_length=1, max_length=80)
    clientName: str = Field(min_length=2, max_length=120)
    clientEmail: str = Field(default="", max_length=160)
    clientPhone: str = Field(default="", max_length=40)
    appointmentDate: str
    startTime: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    notes: str = Field(default="", max_length=1000)

    @field_validator("clientName")
    @classmethod
    def normalize_client_name(cls, value: str):
        return " ".join(value.split())

    @field_validator("appointmentDate")
    @classmethod
    def validate_appointment_date(cls, value: str):
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError as exc:
            raise ValueError("La fecha debe usar AAAA-MM-DD.") from exc
        return value


class AppointmentStatusPayload(BaseModel):
    status: Literal["reserved", "confirmed", "attended", "cancelled", "no_show"]


class SaleItemPayload(BaseModel):
    productId: str
    quantity: float = Field(gt=0, le=100000)
    discountPercent: float = Field(default=0, ge=0, le=100)


class PaymentPartPayload(BaseModel):
    method: Literal["cash", "card", "digital", "transfer"]
    amount: float = Field(ge=0)


class SalePayload(BaseModel):
    idempotencyKey: str = Field(min_length=8, max_length=100)
    items: list[SaleItemPayload] = Field(min_length=1, max_length=200)
    customer: str = Field(default="Cliente general", max_length=120)
    paymentMethod: Literal["cash", "card", "digital", "split", "transfer"] = "cash"
    payments: list[PaymentPartPayload] = Field(default_factory=list, max_length=10)
    cashSessionId: str | None = None
    globalDiscountPercent: float = Field(default=0, ge=0, le=100)
    taxRate: float = Field(default=DEFAULT_TAX_RATE, ge=0, le=0.3)
    status: Literal["completed", "pending"] = "completed"


class SupplierPayload(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    company: str = Field(min_length=2, max_length=160)
    phone: str = Field(default="", max_length=60)
    email: str = Field(default="", max_length=160)
    address: str = Field(default="", max_length=240)
    products: list[str] = []
    notes: str = Field(default="", max_length=1000)


class RegisterPayload(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=160)
    password: str = Field(min_length=8, max_length=128)
    businessName: str | None = Field(default=None, max_length=160)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str):
        value = value.strip().lower()
        if "@" not in value or value.startswith("@") or value.endswith("@"):
            raise ValueError("Ingresa un correo válido.")
        return value


class LoginPayload(BaseModel):
    email: str = Field(min_length=5, max_length=160)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str):
        return value.strip().lower()


class BusinessConfigPayload(BaseModel):
    type: Literal["retail", "restaurant", "hotel", "warehouse", "services"]
    name: str = Field(min_length=2, max_length=160)
    currency: str = Field(default="COP", min_length=3, max_length=3)
    taxRate: float = Field(default=0.19, ge=0, le=1)
    features: dict[str, bool]
    foodConfig: dict | None = None
    theme: dict | None = None
    inventoryConfig: dict | None = None

    @field_validator("theme")
    @classmethod
    def validate_theme(cls, value: dict | None):
        if value is None:
            return None
        color_keys = ("primary", "secondary", "accent", "background", "surface", "lightBackground", "lightSurface", "darkBackground", "darkSurface")
        for key in color_keys:
            color = value.get(key)
            if color is None and key in {"lightBackground", "lightSurface", "darkBackground", "darkSurface"}:
                continue
            if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
                raise ValueError(f"El color {key} debe estar en formato hexadecimal #RRGGBB.")
        if value.get("mode", "light") not in {"light", "dark"}:
            raise ValueError("El modo de apariencia debe ser light o dark.")
        if "customized" in value and not isinstance(value["customized"], bool):
            raise ValueError("El indicador de personalización debe ser booleano.")
        allowed = set(color_keys) | {"mode", "customized"}
        if set(value) - allowed:
            raise ValueError("La configuración visual contiene propiedades desconocidas.")
        return value


class CreateStaffPayload(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=160)
    password: str = Field(min_length=8, max_length=128)
    role: Literal["business_admin", "cashier"] = "cashier"
    customRoleId: str | None = Field(default=None, max_length=80)


class UpdateStaffPayload(BaseModel):
    role: Literal["business_admin", "cashier"] | None = None
    customRoleId: str | None = Field(default=None, max_length=80)
    active: bool | None = None


class CustomRolePayload(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    permissions: list[str] = Field(default_factory=list, max_length=40)

    @field_validator("name")
    @classmethod
    def normalize_role_name(cls, value: str):
        return " ".join(value.split())

    @field_validator("permissions")
    @classmethod
    def validate_permissions(cls, value: list[str]):
        clean = list(dict.fromkeys(value))
        invalid = set(clean) - DELEGABLE_PERMISSIONS
        if invalid:
            raise ValueError("El rol contiene permisos no delegables.")
        return clean


class SupportMessagePayload(BaseModel):
    message: str = Field(min_length=1, max_length=4000)

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str):
        value = value.strip()
        if not value:
            raise ValueError("El mensaje no puede estar vacío.")
        return value


class SupportStatusPayload(BaseModel):
    status: Literal["open", "in_review", "awaiting_business", "resolved", "closed"]


def make_auth_response(conn: sqlite3.Connection, user_row: sqlite3.Row) -> dict:
    token = issue_session(conn, user_row["id"])
    return {"access_token": token, "token_type": "bearer", "user": public_user(user_row, conn)}


@app.post("/api/auth/register", status_code=201)
def register(payload: RegisterPayload):
    try:
        password_hash = hash_password(payload.password)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    business_id = f"NEG-{uuid.uuid4().hex[:12].upper()}"
    user_id = f"USR-{uuid.uuid4().hex[:12].upper()}"
    business_name = (payload.businessName or f"Negocio de {payload.name.strip()}").strip()
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        exists = conn.execute("SELECT id FROM auth_users WHERE email=?", (payload.email,)).fetchone()
        if exists:
            conn.rollback()
            raise HTTPException(409, "Ya existe una cuenta con ese correo.")
        conn.execute("INSERT INTO businesses (id,name,business_type,currency,tax_rate,settings_json,active) VALUES (?,?,?,?,?,'{}',1)",
                     (business_id, business_name, "retail", "COP", DEFAULT_TAX_RATE))
        conn.execute("INSERT INTO auth_users (id,business_id,full_name,email,password_hash,role) VALUES (?,?,?,?,?,'owner')",
                     (user_id, business_id, payload.name.strip(), payload.email, password_hash))
        user_row = conn.execute("SELECT * FROM auth_users WHERE id=?", (user_id,)).fetchone()
        response = make_auth_response(conn, user_row)
        conn.commit()
        return response


@app.post("/api/auth/login")
def login(payload: LoginPayload):
    with connection() as conn:
        row = conn.execute("SELECT * FROM auth_users WHERE email=?", (payload.email,)).fetchone()
        if not row or not row["active"] or not verify_password(payload.password, row["password_hash"]):
            raise HTTPException(401, "Correo o contraseña incorrectos.")
        if row["business_id"]:
            business = conn.execute("SELECT active FROM businesses WHERE id=?", (row["business_id"],)).fetchone()
            if not business:
                raise HTTPException(403, "El negocio asignado a esta cuenta no existe.")
            if not business["active"] and row["role"] != "owner":
                raise HTTPException(403, "El negocio está suspendido. Solo el propietario puede acceder al centro de revisión.")
        return make_auth_response(conn, row)


@app.get("/api/auth/me")
def auth_me():
    identity = current_identity()
    with connection() as conn:
        row = conn.execute("SELECT * FROM auth_users WHERE id=?", (identity["id"],)).fetchone()
        if not row:
            raise HTTPException(401, "La cuenta ya no existe.")
        return public_user(row, conn)


@app.post("/api/auth/logout")
def auth_logout():
    identity = current_identity()
    with connection() as conn:
        conn.execute("DELETE FROM auth_sessions WHERE token_hash=?", (identity["token_hash"],))
    return {"ok": True}


@app.get("/api/business/config")
def get_business_config():
    business_id = current_business_id()
    with connection() as conn:
        row = conn.execute("SELECT settings_json FROM businesses WHERE id=?", (business_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Negocio no encontrado.")
        try:
            settings = json.loads(row["settings_json"] or "{}")
        except json.JSONDecodeError:
            settings = {}
        return settings if settings else None


@app.put("/api/business/config")
def save_business_config(payload: BusinessConfigPayload):
    business_id = current_business_id()
    if current_identity()["role"] != "owner":
        raise HTTPException(403, "Solo el propietario puede modificar la configuración del negocio.")
    config = payload.model_dump()
    config["currency"] = config["currency"].upper()
    if config["currency"] != "COP":
        raise HTTPException(422, "Esta versión opera en COP. La multimoneda requiere adaptar y probar todos los cálculos y reportes.")
    business_type = "food" if config["type"] == "restaurant" else config["type"]
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT id,business_type,settings_json FROM businesses WHERE id=?", (business_id,)).fetchone()
        if not row:
            conn.rollback()
            raise HTTPException(404, "Negocio no encontrado.")
        try:
            old_settings = json.loads(row["settings_json"] or "{}")
        except json.JSONDecodeError:
            old_settings = {}
        old_config_type = old_settings.get("type") if isinstance(old_settings, dict) else None
        new_type = config["type"]
        # Do not treat first-time setup (empty settings) as a destructive type change.
        if old_settings and old_config_type and canonical_business_type(old_config_type) != canonical_business_type(new_type):
            transition_id = f"TRN-{uuid.uuid4().hex[:12].upper()}"
            created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
            expires_at = (datetime.now(timezone.utc) + timedelta(days=15)).isoformat(timespec="seconds")
            cleanup_summary = {"pendingModules": {"food": ["pedidos", "recetas"], "hotel": ["habitaciones", "reservas", "ocupación"], "services": ["servicios", "citas"], "warehouse": ["ubicaciones", "traslados"]}.get(canonical_business_type(old_config_type), []), "deletedTables": []}
            conn.execute("INSERT INTO business_type_transitions (id,business_id,old_type,new_type,old_settings_json,cleanup_json,status,created_at,expires_at) VALUES (?,?,?,?,?,?,'pending',?,?)", (transition_id, business_id, old_config_type, new_type, json.dumps(old_settings, ensure_ascii=False), json.dumps(cleanup_summary, ensure_ascii=False), created_at, expires_at))
        conn.execute("UPDATE businesses SET name=?,business_type=?,currency=?,tax_rate=?,settings_json=? WHERE id=?",
                     (config["name"].strip(), business_type, config["currency"], config["taxRate"], json.dumps(config, ensure_ascii=False), business_id))
        audit(conn, "update", "business_config", business_id, {"type": config["type"], "currency": config["currency"], "previousType": old_config_type})
        conn.commit()
    return config


@app.get("/api/business/type-transitions")
def list_business_type_transitions():
    process_due_type_transitions()
    business_id = current_business_id()
    with connection() as conn:
        rows = conn.execute("SELECT * FROM business_type_transitions WHERE business_id=? AND status='pending' ORDER BY created_at DESC", (business_id,)).fetchall()
        result = []
        for row in rows:
            try:
                cleanup = json.loads(row["cleanup_json"] or "{}")
            except json.JSONDecodeError:
                cleanup = {}
            try:
                old_settings = json.loads(row["old_settings_json"] or "{}")
            except json.JSONDecodeError:
                old_settings = {}
            result.append({"id": row["id"], "businessId": business_id, "oldType": row["old_type"], "newType": row["new_type"],
                "oldBusinessName": old_settings.get("name", "Negocio anterior"), "createdAt": timestamp_iso(row["created_at"]),
                "expiresAt": timestamp_iso(row["expires_at"]), "status": row["status"], "pendingModules": cleanup.get("pendingModules", []),
                "message": "Los datos específicos del tipo anterior se conservarán durante 15 días completos. Los productos, ventas, usuarios y registros comunes se conservan."})
        return result


@app.post("/api/business/type-transitions/{transition_id}/restore")
def restore_business_type_transition(transition_id: str):
    identity = current_identity()
    if identity["role"] != "owner":
        raise HTTPException(403, "Solo el propietario puede revertir un cambio de tipo de negocio.")
    business_id = current_business_id()
    process_due_type_transitions()
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM business_type_transitions WHERE id=? AND business_id=?", (transition_id, business_id)).fetchone()
        if not row:
            conn.rollback()
            raise HTTPException(404, "No se encontró la transición de tipo de negocio.")
        if row["status"] != "pending" or row["expires_at"] <= now:
            conn.rollback()
            raise HTTPException(409, "El periodo de recuperación terminó o la transición ya fue procesada.")
        try:
            old_config = json.loads(row["old_settings_json"] or "{}")
        except json.JSONDecodeError:
            old_config = {}
        if not isinstance(old_config, dict) or old_config.get("type") not in {"retail", "restaurant", "hotel", "warehouse", "services"}:
            conn.rollback()
            raise HTTPException(409, "No se puede recuperar la configuración anterior.")
        restored_type = "food" if old_config["type"] == "restaurant" else old_config["type"]
        conn.execute("UPDATE businesses SET name=?,business_type=?,currency=?,tax_rate=?,settings_json=? WHERE id=?", (old_config.get("name", "Negocio"), restored_type, old_config.get("currency", "COP"), old_config.get("taxRate", DEFAULT_TAX_RATE), json.dumps(old_config, ensure_ascii=False), business_id))
        conn.execute("UPDATE business_type_transitions SET status='restored',cleaned_at=? WHERE id=?", (now, transition_id))
        audit(conn, "restore", "business_type_transition", transition_id, {"restoredType": old_config["type"]})
        conn.commit()
        return {"ok": True, "config": old_config}


@app.get("/api/users")
def list_business_users():
    business_id = current_business_id()
    with connection() as conn:
        rows = conn.execute("""SELECT u.id,u.business_id,u.full_name,u.email,u.role,u.custom_role_id,u.active,u.created_at,
            cr.name AS custom_role_name FROM auth_users u LEFT JOIN custom_roles cr ON cr.id=u.custom_role_id
            WHERE u.business_id=? ORDER BY u.created_at""", (business_id,)).fetchall()
        return [{"id": r["id"], "businessId": r["business_id"], "name": r["full_name"], "email": r["email"], "role": r["role"],
            "customRoleId": r["custom_role_id"], "customRoleName": r["custom_role_name"],
            "active": bool(r["active"]), "createdAt": r["created_at"]} for r in rows]


@app.get("/api/custom-roles")
def list_custom_roles():
    identity = current_identity()
    if identity["role"] not in {"owner", "business_admin"}:
        raise HTTPException(403, "No tienes permiso para consultar los roles personalizados.")
    with connection() as conn:
        rows = conn.execute("SELECT id,name,permissions_json,created_at FROM custom_roles WHERE business_id=? ORDER BY name", (current_business_id(),)).fetchall()
        return [{"id": r["id"], "name": r["name"], "permissions": json.loads(r["permissions_json"] or "[]"), "createdAt": r["created_at"]} for r in rows]


@app.post("/api/custom-roles", status_code=201)
def create_custom_role(payload: CustomRolePayload):
    identity = current_identity()
    if identity["role"] != "owner" or identity.get("custom_role_id"):
        raise HTTPException(403, "Solo el propietario puede crear roles personalizados.")
    role_id = f"ROLE-{uuid.uuid4().hex[:12].upper()}"
    # Every custom role must be able to land on a safe dashboard after login.
    # Add only the read/operational prerequisites required for granted actions to work.
    permission_set = set(payload.permissions)
    permission_set.add("dashboard.view")
    dependencies = {
        "catalog.create": {"catalog.view"},
        "catalog.edit": {"catalog.view"},
        "inventory.edit": {"inventory.view"},
        "inventory.entry": {"inventory.view", "catalog.view"},
        "inventory.adjust": {"inventory.view", "catalog.view"},
        "inventory.delete": {"inventory.view"},
        "inventory.negative": {"inventory.view"},
        "purchases.approve": {"inventory.view", "suppliers.view", "catalog.view"},
        "suppliers.manage": {"suppliers.view"},
        "cash.manage": {"cash.view"},
        # Staff assigned custom roles use the least-privilege cashier base identity.
        # The POS needs catalog reads and the authorized cash-session workflow.
        "sales.create": {"sales.view", "catalog.view", "cash.view", "cash.manage"},
        "sales.cancel": {"sales.view"},
        "orders.manage": {"orders.view"},
        "services.manage": {"services.view"},
        "hotel.manage": {"hotel.view"},
        "reports.view": {"sales.view", "catalog.view"},
    }
    changed = True
    while changed:
        changed = False
        for permission in tuple(permission_set):
            required = dependencies.get(permission, set())
            if not required.issubset(permission_set):
                permission_set.update(required)
                changed = True
    permissions = ["dashboard.view", *sorted(permission_set - {"dashboard.view"})]
    with connection() as conn:
        try:
            conn.execute("INSERT INTO custom_roles (id,business_id,name,permissions_json,created_by) VALUES (?,?,?,?,?)",
                (role_id, current_business_id(), payload.name, json.dumps(permissions), identity["id"]))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "Ya existe un rol con ese nombre en este negocio.") from exc
        audit(conn, "create", "custom_role", role_id, {"name": payload.name, "permissions": permissions})
        row = conn.execute("SELECT id,name,permissions_json,created_at FROM custom_roles WHERE id=?", (role_id,)).fetchone()
        return {"id": row["id"], "name": row["name"], "permissions": json.loads(row["permissions_json"]), "createdAt": row["created_at"]}


@app.post("/api/users", status_code=201)
def create_business_user(payload: CreateStaffPayload):
    identity = current_identity()
    business_id = current_business_id()
    if identity["role"] not in {"owner", "business_admin"}:
        raise HTTPException(403, "No tienes permiso para crear usuarios.")
    if identity["role"] == "business_admin" and payload.role != "cashier":
        raise HTTPException(403, "Un administrador de negocio solo puede crear cajeros.")
    if payload.customRoleId and identity["role"] != "owner":
        raise HTTPException(403, "Solo el propietario puede asignar roles personalizados.")
    if payload.customRoleId:
        with connection() as conn:
            custom_role = conn.execute("SELECT id FROM custom_roles WHERE id=? AND business_id=?", (payload.customRoleId, business_id)).fetchone()
        if not custom_role:
            raise HTTPException(422, "El rol personalizado no existe en este negocio.")
        # A custom role uses the lowest-privilege base role; its effective permissions are separate.
        payload.role = "cashier"
    email = payload.email.strip().lower()
    with connection() as conn:
        subscription = subscription_for_business(conn, business_id)
        plan_limits = subscription["plan"]
        user_count = conn.execute("SELECT count(*) FROM auth_users WHERE business_id=?", (business_id,)).fetchone()[0]
        if user_count >= plan_limits["maxUsers"]:
            raise HTTPException(409, f"El plan {plan_limits['name']} permite hasta {plan_limits['maxUsers']} usuarios en total. Cambia de plan para añadir más.")
    try:
        password_hash = hash_password(payload.password)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    user_id = f"USR-{uuid.uuid4().hex[:12].upper()}"
    with connection() as conn:
        try:
            conn.execute("INSERT INTO auth_users (id,business_id,full_name,email,password_hash,role,custom_role_id) VALUES (?,?,?,?,?,?,?)", (user_id, business_id, payload.name.strip(), email, password_hash, payload.role, payload.customRoleId))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "Ya existe una cuenta con ese correo.") from exc
        audit(conn, "create", "user", user_id, {"role": payload.role, "email": email})
        row = conn.execute("""SELECT u.id,u.business_id,u.full_name,u.email,u.role,u.custom_role_id,u.active,u.created_at,cr.name custom_role_name
            FROM auth_users u LEFT JOIN custom_roles cr ON cr.id=u.custom_role_id WHERE u.id=?""", (user_id,)).fetchone()
        return {"id": row["id"], "businessId": row["business_id"], "name": row["full_name"], "email": row["email"], "role": row["role"], "customRoleId": row["custom_role_id"], "customRoleName": row["custom_role_name"], "active": bool(row["active"]), "createdAt": row["created_at"]}


@app.patch("/api/users/{user_id}")
def update_business_user(user_id: str, payload: UpdateStaffPayload):
    identity = current_identity()
    business_id = current_business_id()
    with connection() as conn:
        target = conn.execute("SELECT * FROM auth_users WHERE id=? AND business_id=?", (user_id, business_id)).fetchone()
        if not target:
            raise HTTPException(404, "Usuario no encontrado en este negocio.")
        if target["role"] == "owner":
            raise HTTPException(403, "El propietario no puede modificarse desde la gestión de empleados.")
        if identity["role"] == "business_admin" and (target["role"] != "cashier" or payload.role not in {None, "cashier"}):
            raise HTTPException(403, "No puedes administrar usuarios con permisos superiores.")
        if payload.customRoleId and identity["role"] != "owner":
            raise HTTPException(403, "Solo el propietario puede asignar roles personalizados.")
        if payload.customRoleId:
            role_row = conn.execute("SELECT id FROM custom_roles WHERE id=? AND business_id=?", (payload.customRoleId, business_id)).fetchone()
            if not role_row:
                raise HTTPException(422, "El rol personalizado no existe en este negocio.")
        role_changed = (payload.role is not None and payload.role != target["role"]) or (payload.customRoleId is not None and payload.customRoleId != target["custom_role_id"])
        if payload.customRoleId is not None:
            conn.execute("UPDATE auth_users SET custom_role_id=?,role='cashier' WHERE id=?", (payload.customRoleId, user_id))
        elif payload.role is not None:
            conn.execute("UPDATE auth_users SET role=?,custom_role_id=NULL WHERE id=?", (payload.role, user_id))
        if role_changed or payload.active is False:
            conn.execute("DELETE FROM auth_sessions WHERE user_id=?", (user_id,))
        if payload.active is not None:
            conn.execute("UPDATE auth_users SET active=? WHERE id=?", (1 if payload.active else 0, user_id))
            if not payload.active:
                conn.execute("DELETE FROM auth_sessions WHERE user_id=?", (user_id,))
        audit(conn, "update", "user", user_id, payload.model_dump(exclude_none=True))
        row = conn.execute("""SELECT u.id,u.business_id,u.full_name,u.email,u.role,u.custom_role_id,u.active,u.created_at,cr.name custom_role_name
            FROM auth_users u LEFT JOIN custom_roles cr ON cr.id=u.custom_role_id WHERE u.id=?""", (user_id,)).fetchone()
        return {"id": row["id"], "businessId": row["business_id"], "name": row["full_name"], "email": row["email"], "role": row["role"], "customRoleId": row["custom_role_id"], "customRoleName": row["custom_role_name"], "active": bool(row["active"]), "createdAt": row["created_at"]}


def subscription_for_business(conn: sqlite3.Connection, business_id: str) -> dict:
    row = conn.execute("SELECT * FROM business_subscriptions WHERE business_id=?", (business_id,)).fetchone()
    if not row:
        conn.execute("INSERT OR IGNORE INTO business_subscriptions (business_id,plan_id,status) VALUES (?, 'free', 'active')", (business_id,))
        row = conn.execute("SELECT * FROM business_subscriptions WHERE business_id=?", (business_id,)).fetchone()
    if row["status"] == "active" and row["expires_at"]:
        try:
            expires = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
            if expires <= datetime.now(timezone.utc):
                conn.execute("UPDATE business_subscriptions SET plan_id='free',status='expired',pending_plan_id=NULL,updated_at=? WHERE business_id=?", (datetime.now(timezone.utc).isoformat(timespec="seconds"), business_id))
                row = conn.execute("SELECT * FROM business_subscriptions WHERE business_id=?", (business_id,)).fetchone()
        except (ValueError, TypeError):
            # Invalid legacy dates fail closed to the free plan and are visible for administration.
            conn.execute("UPDATE business_subscriptions SET plan_id='free',status='expired',pending_plan_id=NULL,updated_at=? WHERE business_id=?", (datetime.now(timezone.utc).isoformat(timespec="seconds"), business_id))
            row = conn.execute("SELECT * FROM business_subscriptions WHERE business_id=?", (business_id,)).fetchone()
    effective_plan_id = row["plan_id"] if row["status"] == "active" else "free"
    plan = SUBSCRIPTION_PLANS.get(effective_plan_id, SUBSCRIPTION_PLANS["free"])
    pending = SUBSCRIPTION_PLANS.get(row["pending_plan_id"]) if row["pending_plan_id"] else None
    return {"businessId": business_id, "plan": plan, "status": row["status"], "pendingPlan": pending, "startedAt": timestamp_iso(row["started_at"]), "expiresAt": timestamp_iso(row["expires_at"]) if row["expires_at"] else None, "updatedAt": timestamp_iso(row["updated_at"])}


@app.get("/api/subscription/plans")
def list_subscription_plans():
    return list(SUBSCRIPTION_PLANS.values())


@app.get("/api/subscription")
def get_business_subscription():
    identity = current_identity()
    if identity["role"] != "owner":
        raise HTTPException(403, "Solo el propietario puede consultar la suscripción del negocio.")
    with connection() as conn:
        return subscription_for_business(conn, current_business_id())


class SubscriptionSelectionPayload(BaseModel):
    planId: Literal["free", "entrepreneur", "business", "enterprise"]


@app.put("/api/subscription")
def request_subscription_plan(payload: SubscriptionSelectionPayload):
    identity = current_identity()
    if identity["role"] != "owner":
        raise HTTPException(403, "Solo el propietario puede gestionar la suscripción.")
    business_id = current_business_id()
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    plan = SUBSCRIPTION_PLANS[payload.planId]
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        current = subscription_for_business(conn, business_id)
        if payload.planId == "free":
            conn.execute("INSERT INTO business_subscriptions (business_id,plan_id,status,pending_plan_id,started_at,expires_at,updated_at) VALUES (?, 'free','active',NULL,?,NULL,?) ON CONFLICT(business_id) DO UPDATE SET plan_id='free',status='active',pending_plan_id=NULL,started_at=excluded.started_at,expires_at=NULL,updated_at=excluded.updated_at", (business_id, now, now))
            audit(conn, "subscription_plan_changed", "subscription", business_id, {"from": current["plan"]["id"], "to": "free"})
            conn.commit()
            return subscription_for_business(conn, business_id)
        # Paid plan selection records a request only. It never pretends a payment has succeeded.
        conn.execute("INSERT INTO business_subscriptions (business_id,plan_id,status,pending_plan_id,started_at,expires_at,updated_at) VALUES (?, 'free','pending_payment',?,?,NULL,?) ON CONFLICT(business_id) DO UPDATE SET status='pending_payment',pending_plan_id=excluded.pending_plan_id,updated_at=excluded.updated_at", (business_id, payload.planId, now, now))
        audit(conn, "subscription_payment_pending", "subscription", business_id, {"requestedPlan": payload.planId, "priceCOP": plan["priceCOP"]})
        conn.commit()
        return subscription_for_business(conn, business_id)


class PlatformSubscriptionActionPayload(BaseModel):
    action: Literal["confirm_payment", "cancel_request"]
    paymentReference: str | None = Field(default=None, min_length=4, max_length=120)


@app.get("/api/platform/subscriptions")
def platform_subscriptions():
    with connection() as conn:
        businesses = conn.execute("SELECT id,name FROM businesses ORDER BY name COLLATE NOCASE").fetchall()
        output = []
        for business in businesses:
            subscription = subscription_for_business(conn, business["id"])
            output.append({**subscription, "businessName": business["name"]})
        return output


@app.patch("/api/platform/subscriptions/{business_id}")
def platform_update_subscription(business_id: str, payload: PlatformSubscriptionActionPayload):
    identity = current_identity()
    if identity["role"] != "superadmin":
        raise HTTPException(403, "Solo SUPERADMIN puede gestionar solicitudes de suscripción.")
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM business_subscriptions WHERE business_id=?", (business_id,)).fetchone()
        if not row:
            raise HTTPException(404, "El negocio todavía no tiene un registro de suscripción.")
        if payload.action == "confirm_payment":
            if row["status"] != "pending_payment" or not row["pending_plan_id"]:
                raise HTTPException(409, "No existe una solicitud de pago pendiente para este negocio.")
            if not payload.paymentReference or len(payload.paymentReference.strip()) < 4:
                raise HTTPException(422, "Registra una referencia de pago verificada antes de activar el plan.")
            plan_id = row["pending_plan_id"]
            expires = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(timespec="seconds")
            conn.execute("UPDATE business_subscriptions SET plan_id=?,status='active',pending_plan_id=NULL,started_at=?,expires_at=?,updated_at=? WHERE business_id=?", (plan_id, now, expires, now, business_id))
            action = "subscription_payment_manually_verified"
            details = {"planId": plan_id, "paymentReference": payload.paymentReference.strip(), "verificationMode": "manual_by_superadmin"}
        else:
            conn.execute("UPDATE business_subscriptions SET status='active',pending_plan_id=NULL,updated_at=? WHERE business_id=?", (now, business_id))
            action = "subscription_request_cancelled"
            details = {"cancelledPlanId": row["pending_plan_id"]}
        conn.execute("INSERT INTO platform_audit (actor_id,action,entity_id,details) VALUES (?,?,?,?)", (identity["id"], action, business_id, json.dumps(details, ensure_ascii=False)))
        conn.commit()
        return subscription_for_business(conn, business_id)


@app.get("/api/platform/stats")
def platform_stats():
    with connection() as conn:
        businesses = conn.execute("SELECT COUNT(*) total, SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) active FROM businesses").fetchone()
        users = conn.execute("SELECT COUNT(*) total, SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) active FROM auth_users").fetchone()
        sales = conn.execute("SELECT COUNT(*) total, COALESCE(SUM(total),0) total_amount FROM sales WHERE status='completed'").fetchone()
        return {"businesses": int(businesses["total"] or 0), "activeBusinesses": int(businesses["active"] or 0), "users": int(users["total"] or 0), "activeUsers": int(users["active"] or 0), "completedSales": int(sales["total"] or 0), "salesVolumeCOP": float(sales["total_amount"] or 0)}


@app.get("/api/platform/businesses")
def platform_businesses():
    with connection() as conn:
        rows = conn.execute("""SELECT b.id,b.name,b.business_type,b.currency,b.active,b.created_at,b.suspension_reason,b.suspension_description,b.suspended_at,COUNT(DISTINCT u.id) users
            FROM businesses b LEFT JOIN auth_users u ON u.business_id=b.id GROUP BY b.id ORDER BY b.created_at DESC""").fetchall()
        return [{"id": r["id"], "name": r["name"], "type": r["business_type"], "currency": r["currency"], "active": bool(r["active"]), "createdAt": r["created_at"], "users": r["users"], "suspensionReason": r["suspension_reason"] or "", "suspensionDescription": r["suspension_description"] or "", "suspendedAt": timestamp_iso(r["suspended_at"])} for r in rows]


@app.patch("/api/platform/businesses/{business_id}/status")
def platform_business_status(business_id: str, active: bool = Query(...), reason: str = Query(default="", max_length=160), description: str = Query(default="", max_length=2000)):
    if not active and len(reason.strip()) < 4:
        raise HTTPException(422, "Es obligatorio indicar un motivo de suspensión (mínimo 4 caracteres).")
    case_id = None
    with connection() as conn:
        cur = conn.execute("UPDATE businesses SET active=?,suspension_reason=?,suspension_description=?,suspended_at=? WHERE id=?",
            (1 if active else 0, "" if active else reason.strip(), "" if active else description.strip(), None if active else datetime.now(timezone.utc).isoformat(timespec="seconds"), business_id))
        if not cur.rowcount:
            raise HTTPException(404, "Negocio no encontrado.")
        if not active:
            existing = conn.execute("SELECT id FROM support_cases WHERE business_id=? AND status NOT IN ('resolved','closed') ORDER BY created_at DESC LIMIT 1", (business_id,)).fetchone()
            if existing:
                case_id = existing["id"]
                conn.execute("UPDATE support_cases SET reason=?,description=?,status='open',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", (reason.strip(), description.strip(), current_identity()["id"], case_id))
            else:
                case_id = f"CASE-{uuid.uuid4().hex[:12].upper()}"
                conn.execute("INSERT INTO support_cases (id,business_id,reason,description,status,created_by,updated_by) VALUES (?,?,?,?, 'open',?,?)",
                    (case_id, business_id, reason.strip(), description.strip(), current_identity()["id"], current_identity()["id"]))
        else:
            conn.execute("UPDATE support_cases SET status='resolved',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE business_id=? AND status NOT IN ('resolved','closed')", (current_identity()["id"], business_id))
        audit_row = f"business:{business_id}"
        # Platform activity has no tenant id; keep it in a dedicated global event table.
        conn.execute("INSERT INTO platform_audit (actor_id,action,entity_id,details) VALUES (?,?,?,?)", (current_identity()["id"], "activate" if active else "suspend", audit_row, json.dumps({"active": active, "reason": reason.strip() if not active else "", "caseId": case_id})))
        return {"id": business_id, "active": active, "caseId": case_id}


def support_case_out(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    unread = conn.execute("SELECT COUNT(*) FROM support_messages WHERE case_id=? AND read_at IS NULL AND sender_role='owner'", (row["id"],)).fetchone()[0]
    return {"id": row["id"], "businessId": row["business_id"], "businessName": row["business_name"] if "business_name" in row.keys() else None,
        "reason": row["reason"], "description": row["description"], "status": row["status"], "createdAt": timestamp_iso(row["created_at"]),
        "updatedAt": timestamp_iso(row["updated_at"]), "unreadCount": int(unread or 0)}


def support_messages_out(conn: sqlite3.Connection, case_id: str, mark_read_for: str | None = None) -> list[dict]:
    if mark_read_for:
        conn.execute("UPDATE support_messages SET read_at=CURRENT_TIMESTAMP WHERE case_id=? AND sender_id<>? AND read_at IS NULL", (case_id, mark_read_for))
    rows = conn.execute("""SELECT m.id,m.sender_id,m.sender_role,m.message,m.created_at,m.read_at,u.full_name
        FROM support_messages m JOIN auth_users u ON u.id=m.sender_id WHERE m.case_id=? ORDER BY m.id""", (case_id,)).fetchall()
    return [{"id": r["id"], "senderId": r["sender_id"], "senderRole": r["sender_role"], "senderName": r["full_name"],
        "message": r["message"], "createdAt": timestamp_iso(r["created_at"]), "readAt": timestamp_iso(r["read_at"])} for r in rows]


@app.get("/api/suspension/status")
def suspension_status():
    identity = current_identity()
    if identity["role"] != "owner":
        raise HTTPException(403, "Solo el propietario puede consultar el caso de suspensión.")
    business_id = current_business_id()
    with connection() as conn:
        business = conn.execute("SELECT id,name,active,suspension_reason,suspension_description,suspended_at FROM businesses WHERE id=?", (business_id,)).fetchone()
        case = conn.execute("SELECT * FROM support_cases WHERE business_id=? ORDER BY created_at DESC LIMIT 1", (business_id,)).fetchone()
        output_case = None
        if case:
            case = conn.execute("SELECT c.*,b.name AS business_name FROM support_cases c JOIN businesses b ON b.id=c.business_id WHERE c.id=?", (case["id"],)).fetchone()
            output_case = support_case_out(conn, case)
            messages = support_messages_out(conn, case["id"], identity["id"])
        else:
            messages = []
        return {"businessId": business["id"], "businessName": business["name"], "active": bool(business["active"]),
            "reason": business["suspension_reason"] or "", "description": business["suspension_description"] or "",
            "suspendedAt": timestamp_iso(business["suspended_at"]), "case": output_case, "messages": messages}


@app.get("/api/support/case")
def owner_support_case():
    identity = current_identity()
    if identity["role"] != "owner":
        raise HTTPException(403, "Solo el propietario puede consultar este caso.")
    with connection() as conn:
        row = conn.execute("SELECT c.*,b.name business_name FROM support_cases c JOIN businesses b ON b.id=c.business_id WHERE c.business_id=? ORDER BY c.created_at DESC LIMIT 1", (current_business_id(),)).fetchone()
        if not row:
            return None
        return support_case_out(conn, row)


@app.get("/api/support/messages")
def owner_support_messages():
    identity = current_identity()
    if identity["role"] != "owner":
        raise HTTPException(403, "Solo el propietario puede consultar esta conversación.")
    with connection() as conn:
        case = conn.execute("SELECT id FROM support_cases WHERE business_id=? ORDER BY created_at DESC LIMIT 1", (current_business_id(),)).fetchone()
        if not case: return []
        return support_messages_out(conn, case["id"], identity["id"])


@app.post("/api/support/messages", status_code=201)
def owner_send_support_message(payload: SupportMessagePayload):
    identity = current_identity()
    if identity["role"] != "owner":
        raise HTTPException(403, "Solo el propietario puede enviar mensajes a soporte.")
    with connection() as conn:
        case = conn.execute("SELECT id,status FROM support_cases WHERE business_id=? ORDER BY created_at DESC LIMIT 1", (current_business_id(),)).fetchone()
        if not case:
            raise HTTPException(404, "No existe un caso de soporte para este negocio.")
        if case["status"] in {"resolved", "closed"}:
            conn.execute("UPDATE support_cases SET status='open',updated_at=CURRENT_TIMESTAMP WHERE id=?", (case["id"],))
        conn.execute("INSERT INTO support_messages (case_id,business_id,sender_id,sender_role,message) VALUES (?,?,?,?,?)", (case["id"], current_business_id(), identity["id"], "owner", payload.message))
        conn.execute("UPDATE support_cases SET updated_at=CURRENT_TIMESTAMP WHERE id=?", (case["id"],))
        return support_messages_out(conn, case["id"])[-1]


@app.get("/api/platform/support/cases")
def platform_support_cases():
    with connection() as conn:
        rows = conn.execute("""SELECT c.*,b.name business_name FROM support_cases c JOIN businesses b ON b.id=c.business_id
            ORDER BY CASE WHEN c.status IN ('open','in_review','awaiting_business') THEN 0 ELSE 1 END,c.updated_at DESC LIMIT 200""").fetchall()
        return [support_case_out(conn, row) for row in rows]


@app.get("/api/platform/support/cases/{case_id}/messages")
def platform_support_case_messages(case_id: str):
    with connection() as conn:
        case = conn.execute("SELECT id FROM support_cases WHERE id=?", (case_id,)).fetchone()
        if not case: raise HTTPException(404, "Caso de soporte no encontrado.")
        return support_messages_out(conn, case_id, current_identity()["id"])


@app.post("/api/platform/support/cases/{case_id}/messages", status_code=201)
def platform_send_support_message(case_id: str, payload: SupportMessagePayload):
    identity = current_identity()
    with connection() as conn:
        case = conn.execute("SELECT id,business_id,status FROM support_cases WHERE id=?", (case_id,)).fetchone()
        if not case: raise HTTPException(404, "Caso de soporte no encontrado.")
        conn.execute("INSERT INTO support_messages (case_id,business_id,sender_id,sender_role,message) VALUES (?,?,?,?,?)", (case_id, case["business_id"], identity["id"], "superadmin", payload.message))
        conn.execute("UPDATE support_cases SET status='awaiting_business',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", (identity["id"], case_id))
        conn.execute("INSERT INTO platform_audit (actor_id,action,entity_id,details) VALUES (?,?,?,?)", (identity["id"], "support_reply", case_id, json.dumps({"businessId": case["business_id"]})))
        return support_messages_out(conn, case_id)[-1]


@app.patch("/api/platform/support/cases/{case_id}")
def platform_update_support_case(case_id: str, payload: SupportStatusPayload):
    identity = current_identity()
    with connection() as conn:
        case = conn.execute("SELECT id,business_id FROM support_cases WHERE id=?", (case_id,)).fetchone()
        if not case: raise HTTPException(404, "Caso de soporte no encontrado.")
        conn.execute("UPDATE support_cases SET status=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", (payload.status, identity["id"], case_id))
        if payload.status == "resolved":
            conn.execute("UPDATE businesses SET active=1,suspension_reason='',suspension_description='',suspended_at=NULL WHERE id=?", (case["business_id"],))
        conn.execute("INSERT INTO platform_audit (actor_id,action,entity_id,details) VALUES (?,?,?,?)", (identity["id"], "support_case_status", case_id, json.dumps({"status": payload.status})))
        return {"id": case_id, "status": payload.status}


@app.get("/api/platform/audit")
def platform_audit(limit: int = Query(default=50, ge=1, le=200), offset: int = Query(default=0, ge=0)):
    with connection() as conn:
        rows = conn.execute("""SELECT a.id,a.actor_id,a.action,a.entity_id,a.details,a.created_at,u.full_name AS actor_name
            FROM platform_audit a JOIN auth_users u ON u.id=a.actor_id
            ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?""", (limit, offset)).fetchall()
        output = []
        for row in rows:
            try:
                details = json.loads(row["details"] or "{}")
            except json.JSONDecodeError:
                details = {"raw": row["details"]}
            output.append({"id": row["id"], "actorId": row["actor_id"], "actorName": row["actor_name"],
                "action": row["action"], "entityId": row["entity_id"], "details": details,
                "createdAt": timestamp_iso(row["created_at"])})
        return output


@app.get("/api/platform/users")
def platform_users(search: str = Query(default="", max_length=160)):
    with connection() as conn:
        query = """SELECT u.id,u.business_id,u.full_name,u.email,u.role,u.active,u.created_at,b.name AS business_name
            FROM auth_users u LEFT JOIN businesses b ON b.id=u.business_id"""
        params: list = []
        if search.strip():
            query += " WHERE lower(u.full_name) LIKE ? OR lower(u.email) LIKE ? OR lower(COALESCE(b.name,'')) LIKE ?"
            term = f"%{search.strip().lower()}%"
            params.extend([term, term, term])
        query += " ORDER BY u.created_at DESC LIMIT 1000"
        rows = conn.execute(query, params).fetchall()
        return [{"id": r["id"], "businessId": r["business_id"], "businessName": r["business_name"], "name": r["full_name"], "email": r["email"], "role": r["role"], "active": bool(r["active"]), "createdAt": r["created_at"]} for r in rows]


@app.post("/api/platform/users", status_code=201)
def platform_create_user(payload: PlatformCreateUserPayload):
    """Create a platform or business user. Only authenticated SUPERADMIN can reach platform endpoints."""
    identity = current_identity()
    if identity["role"] != "superadmin":
        raise HTTPException(403, "Solo SUPERADMIN puede crear usuarios globales.")
    business_id = payload.businessId.strip() if payload.businessId else None
    if payload.role == "superadmin":
        if business_id:
            raise HTTPException(422, "Una cuenta SUPERADMIN no debe pertenecer a un negocio.")
        business_id = None
    else:
        if not business_id:
            raise HTTPException(422, "Selecciona el negocio al que pertenecerá el usuario.")
        with connection() as conn:
            business = conn.execute("SELECT id FROM businesses WHERE id=?", (business_id,)).fetchone()
            if not business:
                raise HTTPException(404, "El negocio seleccionado no existe.")
            subscription = subscription_for_business(conn, business_id)
            user_count = conn.execute("SELECT count(*) FROM auth_users WHERE business_id=?", (business_id,)).fetchone()[0]
            if user_count >= subscription["plan"]["maxUsers"]:
                raise HTTPException(409, f"El plan {subscription['plan']['name']} permite hasta {subscription['plan']['maxUsers']} usuarios en total.")
    try:
        password_hash = hash_password(payload.password)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    user_id = f"USR-{uuid.uuid4().hex[:12].upper()}"
    with connection() as conn:
        try:
            conn.execute("INSERT INTO auth_users (id,business_id,full_name,email,password_hash,role,active) VALUES (?,?,?,?,?,?,1)",
                         (user_id, business_id, payload.name.strip(), payload.email, password_hash, payload.role))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "Ya existe una cuenta con ese correo.") from exc
        conn.execute("INSERT INTO platform_audit (actor_id,action,entity_id,details) VALUES (?,?,?,?)",
                     (identity["id"], "create_user", user_id, json.dumps({"role": payload.role, "businessId": business_id, "email": payload.email})))
        row = conn.execute("SELECT u.id,u.business_id,u.full_name,u.email,u.role,u.active,u.created_at,b.name business_name FROM auth_users u LEFT JOIN businesses b ON b.id=u.business_id WHERE u.id=?", (user_id,)).fetchone()
        return {"id": row["id"], "businessId": row["business_id"], "businessName": row["business_name"], "name": row["full_name"], "email": row["email"], "role": row["role"], "active": bool(row["active"]), "createdAt": row["created_at"]}


@app.patch("/api/platform/users/{user_id}/status")
def platform_user_status(user_id: str, active: bool = Query(...)):
    with connection() as conn:
        target = conn.execute("SELECT id,role FROM auth_users WHERE id=?", (user_id,)).fetchone()
        if not target:
            raise HTTPException(404, "Usuario no encontrado.")
        if target["role"] == "superadmin" and target["id"] == current_identity()["id"] and not active:
            raise HTTPException(400, "No puedes suspender tu propia cuenta SUPERADMIN.")
        conn.execute("UPDATE auth_users SET active=? WHERE id=?", (1 if active else 0, user_id))
        if not active:
            conn.execute("DELETE FROM auth_sessions WHERE user_id=?", (user_id,))
        conn.execute("INSERT INTO platform_audit (actor_id,action,entity_id,details) VALUES (?,?,?,?)", (current_identity()["id"], "activate_user" if active else "suspend_user", user_id, json.dumps({"active": active})))
        return {"id": user_id, "active": active}


@app.get("/api/health")
def health():
    with connection() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok", "database": "sqlite", "currency": CURRENCY}


@app.get("/api/product-categories")
def list_product_categories():
    with connection() as conn:
        _, categories = product_category_options(conn, current_business_id())
        return categories


@app.post("/api/product-categories", status_code=201)
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


@app.get("/api/products")
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


@app.post("/api/products", status_code=201)
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
            conn.execute(
                """INSERT INTO products (id,business_id,name,sku,category,price,cost,stock,min_stock,description,image,product_type,unit,
                   supplier_id,barcode,track_lots,default_location_id)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (product_id, current_business_id(), payload.name.strip(), payload.sku, payload.category.strip(), payload.price,
                 payload.cost, payload.stock, payload.minStock, payload.description.strip(), payload.image,
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
            conn.commit()
        except sqlite3.IntegrityError as exc:
            conn.rollback()
            raise HTTPException(409, "Ya existe un producto con ese SKU.") from exc
        return product_out(conn.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone())


@app.put("/api/products/{product_id}")
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
                 payload.minStock, payload.description.strip(), payload.image, payload.productType, payload.unit,
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


@app.delete("/api/products/{product_id}")
def delete_product(product_id: str):
    with connection() as conn:
        row = conn.execute("SELECT id FROM products WHERE id=? AND business_id=? AND active=1", (product_id, current_business_id())).fetchone()
        if not row:
            raise HTTPException(404, "Producto no encontrado.")
        conn.execute("UPDATE products SET active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?", (product_id,))
        audit(conn, "archive", "product", product_id)
        return {"ok": True, "id": product_id}


@app.get("/api/sales")
def list_sales(search: str = "", status: str | None = None, limit: int = Query(default=500, ge=1, le=500), offset: int = Query(default=0, ge=0)):
    query = "SELECT id FROM sales WHERE business_id = ?"
    params: list = [current_business_id()]
    if current_identity()["role"] == "cashier":
        query += " AND created_by = ?"
        params.append(current_identity()["id"])
    if status and status in {"completed", "pending", "cancelled"}:
        query += " AND status = ?"
        params.append(status)
    if search:
        query += " AND (lower(id) LIKE ? OR lower(customer) LIKE ?)"
        term = f"%{search.lower()}%"
        params.extend([term, term])
    query += " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    with connection() as conn:
        ids = [row["id"] for row in conn.execute(query, params).fetchall()]
        return [get_sale(conn, sale_id) for sale_id in ids]


@app.get("/api/sales/by-key/{idempotency_key}")
def sale_by_idempotency_key(idempotency_key: str):
    """Recover a committed sale after a network interruption without creating a duplicate."""
    with connection() as conn:
        if current_identity()["role"] == "cashier":
            row = conn.execute("SELECT id FROM sales WHERE business_id=? AND idempotency_key=? AND created_by=?", (current_business_id(), idempotency_key, current_identity()["id"])).fetchone()
        else:
            row = conn.execute("SELECT id FROM sales WHERE business_id=? AND idempotency_key=?", (current_business_id(), idempotency_key)).fetchone()
        if not row:
            raise HTTPException(404, "No existe una venta con esa clave de operación.")
        return get_sale(conn, row["id"])


@app.get("/api/sales/{sale_id}")
def sale_detail(sale_id: str):
    with connection() as conn:
        if current_identity()["role"] == "cashier":
            owned = conn.execute("SELECT id FROM sales WHERE id=? AND business_id=? AND created_by=?", (sale_id, current_business_id(), current_identity()["id"])).fetchone()
            if not owned:
                raise HTTPException(404, "Venta no encontrada.")
        sale = get_sale(conn, sale_id)
        if not sale:
            raise HTTPException(404, "Venta no encontrada.")
        return sale


@app.post("/api/sales", status_code=201)
def create_sale(payload: SalePayload):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute("SELECT id FROM sales WHERE business_id=? AND idempotency_key=?", (current_business_id(), payload.idempotencyKey)).fetchone()
        if existing:
            conn.commit()
            return get_sale(conn, existing["id"])
        if current_identity()["role"] == "cashier" and not payload.cashSessionId:
            conn.rollback()
            raise HTTPException(409, "Abre tu turno de caja antes de registrar una venta.")
        if payload.cashSessionId:
            if current_identity()["role"] == "cashier":
                active_session = conn.execute("SELECT id FROM cash_sessions WHERE id=? AND business_id=? AND status='open' AND opened_by_user_id=?", (payload.cashSessionId, current_business_id(), current_identity()["id"])).fetchone()
            else:
                active_session = conn.execute("SELECT id FROM cash_sessions WHERE id=? AND business_id=? AND status='open'", (payload.cashSessionId, current_business_id())).fetchone()
            if not active_session:
                conn.rollback()
                raise HTTPException(409, "La caja seleccionada no está abierta o no pertenece a tu turno.")
        business_settings = conn.execute("SELECT currency,tax_rate FROM businesses WHERE id=?", (current_business_id(),)).fetchone()
        if not business_settings:
            conn.rollback()
            raise HTTPException(404, "No se encontró la configuración del negocio.")
        sale_currency = business_settings["currency"] or CURRENCY
        sale_tax_rate = float(business_settings["tax_rate"] if business_settings["tax_rate"] is not None else DEFAULT_TAX_RATE)

        product_rows: dict[str, sqlite3.Row] = {}
        quantities_by_product: dict[str, float] = {}
        for item in payload.items:
            quantities_by_product[item.productId] = quantities_by_product.get(item.productId, 0.0) + item.quantity
        direct_requirements: dict[str, float] = {}
        ingredient_requirements: dict[str, float] = {}
        for product_id, requested_quantity in quantities_by_product.items():
            product = conn.execute("SELECT * FROM products WHERE id=? AND business_id=? AND active=1", (product_id, current_business_id())).fetchone()
            if not product:
                conn.rollback()
                raise HTTPException(404, f"No se encontró el producto {product_id}.")
            if product["product_type"] != "sale_item":
                conn.rollback()
                raise HTTPException(400, f"{product['name']} está marcado como ingrediente y no se puede vender directamente.")
            product_rows[product_id] = product
            recipe = conn.execute("SELECT id FROM recipes WHERE business_id=? AND product_id=?", (current_business_id(), product_id)).fetchone()
            if recipe:
                for ingredient_id, usage_quantity in recipe_ingredient_usage(conn, product_id, requested_quantity).items():
                    ingredient_requirements[ingredient_id] = round(ingredient_requirements.get(ingredient_id, 0.0) + usage_quantity, 6)
            else:
                direct_requirements[product_id] = round(direct_requirements.get(product_id, 0.0) + requested_quantity, 6)

        # Validate the combined physical requirement (direct sales + recipe ingredients) before writing anything.
        allow_negative = allows_negative_stock(conn)
        if not allow_negative:
            combined_requirements: dict[str, float] = {}
            for product_id, quantity in {**direct_requirements}.items():
                combined_requirements[product_id] = round(combined_requirements.get(product_id, 0.0) + quantity, 6)
            for product_id, quantity in ingredient_requirements.items():
                combined_requirements[product_id] = round(combined_requirements.get(product_id, 0.0) + quantity, 6)
            for product_id, required_quantity in combined_requirements.items():
                product = product_rows.get(product_id)
                if not product:
                    product = conn.execute("SELECT * FROM products WHERE id=? AND business_id=?", (product_id, current_business_id())).fetchone()
                    if product:
                        product_rows[product_id] = product
                if not product:
                    conn.rollback()
                    raise HTTPException(404, f"No se encontró el producto {product_id}.")
                available = float(product["stock"] or 0)
                if available + 1e-9 < required_quantity:
                    conn.rollback()
                    raise HTTPException(409, f"Stock insuficiente para {product['name']}. Disponible: {available:g}; solicitado: {required_quantity:g}.")

        subtotal = 0.0
        line_discount = 0.0
        resolved_items = []
        for item in payload.items:
            product = product_rows[item.productId]
            gross = round(product["price"] * item.quantity, 2)
            disc = round(gross * (item.discountPercent / 100), 2)
            line_total = round(gross - disc, 2)
            subtotal += gross
            line_discount += disc
            resolved_items.append((item, product, gross, disc, line_total))
        subtotal = round(subtotal, 2)
        line_discount = round(line_discount, 2)
        after_line_discount = max(0, round(subtotal - line_discount, 2))
        global_discount = round(after_line_discount * payload.globalDiscountPercent / 100, 2)
        taxable = max(0, round(after_line_discount - global_discount, 2))
        tax = round(taxable * sale_tax_rate, 2)
        total = round(taxable + tax, 2)
        payment_parts = payload.payments
        if payload.paymentMethod == "split" and not payment_parts:
            conn.rollback()
            raise HTTPException(422, "Para pago dividido debes indicar los importes de cada método de pago.")
        if payment_parts and abs(sum(part.amount for part in payment_parts) - total) > 0.02:
            conn.rollback()
            raise HTTPException(422, "La suma de los métodos de pago debe coincidir con el total de la venta.")
        if not payment_parts and payload.paymentMethod != "split":
            payment_parts = [PaymentPartPayload(method=payload.paymentMethod if payload.paymentMethod != "split" else "cash", amount=total)]
        now = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
        sale_id = f"VTA-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
        conn.execute(
            """INSERT INTO sales (id,business_id,idempotency_key,customer,payment_method,currency,subtotal,line_discount,global_discount,tax_rate,tax,total,status,created_by,cash_session_id,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (sale_id, current_business_id(), payload.idempotencyKey, payload.customer.strip() or "Cliente general", payload.paymentMethod,
             sale_currency, subtotal, line_discount, global_discount, sale_tax_rate, tax, total, payload.status, current_identity()["id"], payload.cashSessionId, now),
        )
        for part in payment_parts:
            conn.execute("INSERT INTO sale_payments (sale_id,method,amount) VALUES (?,?,?)", (sale_id, part.method, part.amount))
        recipe_costs = {product_id: recipe_unit_cost(conn, product_id) for product_id in quantities_by_product}
        for item, product, gross, disc, line_total in resolved_items:
            # Preserve unit cost at transaction time; later catalog edits must not rewrite past margins.
            # Recipe-based products snapshot the cost of their ingredients instead of the sale item's own cost.
            recipe_cost = recipe_costs.get(item.productId)
            unit_cost = float(recipe_cost if recipe_cost is not None else (product["cost"] or 0))
            conn.execute(
                """INSERT INTO sale_items (sale_id,product_id,product_name,sku_snapshot,quantity,unit_price,unit_cost_snapshot,discount_percent,line_total)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (sale_id, item.productId, product["name"], product["sku"], item.quantity, product["price"], round(unit_cost, 4), item.discountPercent, line_total),
            )
        # Deduct physical stock once per product. Recipe products consume their ingredients instead of the product itself.
        for product_id, quantity in direct_requirements.items():
            product = conn.execute("SELECT * FROM products WHERE id=? AND business_id=?", (product_id, current_business_id())).fetchone()
            if product:
                consume_product_stock(
                    conn, product, quantity, movement_type="sale", note=f"Venta {sale_id}",
                    sale_id=sale_id, reference_type="sale", reference_id=sale_id, allow_negative=allow_negative,
                )
        for product_id, quantity in ingredient_requirements.items():
            product = conn.execute("SELECT * FROM products WHERE id=? AND business_id=?", (product_id, current_business_id())).fetchone()
            if product:
                consume_product_stock(
                    conn, product, quantity, movement_type="recipe_consumption",
                    note=f"Consumo de receta · venta {sale_id}", sale_id=sale_id,
                    reference_type="sale", reference_id=sale_id, allow_negative=allow_negative,
                )

        audit(conn, "create", "sale", sale_id, {"total": total, "items": len(resolved_items), "taxRate": sale_tax_rate, "paymentMethod": payload.paymentMethod})
        conn.commit()
        return get_sale(conn, sale_id)


@app.post("/api/sales/{sale_id}/cancel")
def cancel_sale(sale_id: str):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        sale = conn.execute("SELECT * FROM sales WHERE id=? AND business_id=?", (sale_id, current_business_id())).fetchone()
        if not sale:
            conn.rollback()
            raise HTTPException(404, "Venta no encontrada.")
        if sale["status"] == "cancelled":
            conn.commit()
            return get_sale(conn, sale_id)
        movements = conn.execute(
            "SELECT * FROM inventory_movements WHERE sale_id=? AND movement_type IN ('sale','recipe_consumption') ORDER BY id",
            (sale_id,),
        ).fetchall()
        reverse_movements(conn, movements, f"Reversión de venta {sale_id}", "sale_cancelled")
        conn.execute("UPDATE sales SET status='cancelled' WHERE id=?", (sale_id,))
        audit(conn, "cancel", "sale", sale_id, {"restoredMovements": len(movements)})
        conn.commit()
        return get_sale(conn, sale_id)


@app.get("/api/suppliers")
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


@app.post("/api/suppliers", status_code=201)
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


@app.delete("/api/suppliers/{supplier_id}")
def delete_supplier(supplier_id: str):
    with connection() as conn:
        cur = conn.execute("UPDATE suppliers SET active=0 WHERE id=? AND business_id=? AND active=1", (supplier_id, current_business_id()))
        if cur.rowcount == 0:
            raise HTTPException(404, "Proveedor no encontrado.")
        audit(conn, "archive", "supplier", supplier_id)
        return {"ok": True, "id": supplier_id}


@app.get("/api/dashboard")
def dashboard():
    # Always calculate the business day in Colombia, independent of the host machine timezone.
    local_now = datetime.now(ZoneInfo("America/Bogota"))
    start_local_day = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    end_local_day = start_local_day + timedelta(days=1)
    start_utc = start_local_day.astimezone(timezone.utc).isoformat(timespec="seconds")
    end_utc = end_local_day.astimezone(timezone.utc).isoformat(timespec="seconds")
    seven_days_ago_utc = (local_now - timedelta(days=7)).astimezone(timezone.utc).isoformat(timespec="seconds")
    now_utc = datetime.now(timezone.utc).isoformat(timespec="seconds")
    identity = current_identity()
    business_id = current_business_id()
    with connection() as conn:
        business = conn.execute("SELECT business_type,settings_json FROM businesses WHERE id=?", (business_id,)).fetchone()
        try:
            settings = json.loads(business["settings_json"] or "{}") if business else {}
        except json.JSONDecodeError:
            settings = {}
        features = settings.get("features", {}) if isinstance(settings, dict) else {}
        food_modules = settings.get("foodConfig", {}).get("activeModules", []) if isinstance(settings, dict) and isinstance(settings.get("foodConfig"), dict) else []
        pos_enabled = bool(features.get("pos"))
        inventory_enabled = bool(features.get("inventory"))
        catalog_enabled = inventory_enabled or pos_enabled or bool(business and business["business_type"] == "food" and "menu" in food_modules)

        sales_today_count = 0
        revenue_today = 0.0
        revenue_last_7_days = 0.0
        if pos_enabled:
            today_query = """SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS revenue
                FROM sales WHERE business_id=? AND status='completed'
                AND julianday(created_at) >= julianday(?) AND julianday(created_at) < julianday(?)"""
            last7_query = """SELECT COALESCE(SUM(total),0) FROM sales WHERE business_id=? AND status='completed'
                AND julianday(created_at) >= julianday(?) AND julianday(created_at) <= julianday(?)"""
            today_params: list = [business_id, start_utc, end_utc]
            last7_params: list = [business_id, seven_days_ago_utc, now_utc]
            # A cashier's dashboard must not reveal aggregate revenue for other users' transactions.
            if identity["role"] == "cashier":
                today_query += " AND created_by=?"
                last7_query += " AND created_by=?"
                today_params.append(identity["id"])
                last7_params.append(identity["id"])
            row = conn.execute(today_query, today_params).fetchone()
            sales_today_count = int(row["count"] or 0)
            revenue_today = float(row["revenue"] or 0)
            revenue_last_7_days = float(conn.execute(last7_query, last7_params).fetchone()[0] or 0)

        products = 0
        low_stock = 0
        if catalog_enabled:
            products = int(conn.execute("SELECT COUNT(*) FROM products WHERE business_id=? AND active=1 AND product_type='sale_item'", (business_id,)).fetchone()[0])
        if inventory_enabled:
            low_stock = int(conn.execute("SELECT COUNT(*) FROM products WHERE business_id=? AND active=1 AND stock <= min_stock AND product_type='sale_item'", (business_id,)).fetchone()[0])
        return {"salesToday": sales_today_count, "revenueToday": revenue_today, "revenueLast7Days": revenue_last_7_days,
                "activeProducts": products, "lowStockProducts": low_stock, "posEnabled": pos_enabled,
                "inventoryEnabled": inventory_enabled, "catalogEnabled": catalog_enabled}


@app.get("/api/audit")
def list_audit(limit: int = Query(default=150, ge=1, le=500), offset: int = Query(default=0, ge=0)):
    """Return auditable business changes for troubleshooting and traceability."""
    with connection() as conn:
        rows = conn.execute(
            """SELECT id, action, entity_type, entity_id, details, created_at
               FROM audit_log WHERE business_id=? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?""",
            (current_business_id(), limit, offset),
        ).fetchall()
        result = []
        for row in rows:
            try:
                details = json.loads(row["details"] or "{}")
            except json.JSONDecodeError:
                details = {"raw": row["details"]}
            result.append({"id": row["id"], "action": row["action"], "entityType": row["entity_type"],
                           "entityId": row["entity_id"], "details": details, "createdAt": timestamp_iso(row["created_at"])})
        return result


@app.get("/api/inventory/movements")
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


@app.get("/api/inventory/settings")
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


@app.put("/api/inventory/settings")
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


@app.get("/api/inventory/locations")
def list_inventory_locations(includeInactive: bool = False):
    with connection() as conn:
        query = "SELECT * FROM warehouse_locations WHERE business_id=?"
        params: list = [current_business_id()]
        if not includeInactive:
            query += " AND active=1"
        rows = conn.execute(query + " ORDER BY zone, aisle, rack, level, code", params).fetchall()
        return [inventory_location_out(conn, row) for row in rows]


@app.post("/api/inventory/locations", status_code=201)
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


@app.patch("/api/inventory/locations/{location_id}")
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


@app.delete("/api/inventory/locations/{location_id}")
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


@app.get("/api/inventory/lots")
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


@app.get("/api/inventory/barcode/{barcode}")
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


@app.post("/api/inventory/entries", status_code=201)
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


@app.post("/api/inventory/exits", status_code=201)
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


@app.post("/api/inventory/waste", status_code=201)
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


@app.post("/api/inventory/adjustments", status_code=201)
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


@app.get("/api/inventory/purchase-orders")
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


@app.post("/api/inventory/purchase-orders", status_code=201)
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


@app.post("/api/inventory/purchase-orders/{order_id}/approve")
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


@app.post("/api/inventory/purchase-orders/{order_id}/send")
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


@app.post("/api/inventory/purchase-orders/{order_id}/receive")
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


@app.post("/api/inventory/purchase-orders/{order_id}/cancel")
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


@app.get("/api/inventory/counts")
def list_physical_counts(limit: int = Query(default=50, ge=1, le=500)):
    with connection() as conn:
        rows = conn.execute(
            "SELECT * FROM physical_counts WHERE business_id=? ORDER BY created_at DESC, id DESC LIMIT ?",
            (current_business_id(), limit),
        ).fetchall()
        return [physical_count_out(conn, row) for row in rows]


@app.post("/api/inventory/counts", status_code=201)
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


@app.get("/api/inventory/transfers")
def list_inventory_transfers(status: str | None = None):
    with connection() as conn:
        query = "SELECT * FROM inventory_transfers WHERE business_id=?"
        params: list = [current_business_id()]
        if status:
            query += " AND status=?"
            params.append(status)
        rows = conn.execute(query + " ORDER BY created_at DESC, id DESC", params).fetchall()
        return [transfer_record_out(conn, row) for row in rows]


@app.post("/api/inventory/transfers", status_code=201)
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


@app.post("/api/inventory/transfers/{transfer_id}/send")
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


@app.post("/api/inventory/transfers/{transfer_id}/receive")
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


@app.post("/api/inventory/transfers/{transfer_id}/cancel")
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


@app.get("/api/inventory/overview")
def inventory_overview():
    with connection() as conn:
        settings = inventory_settings(conn)
        alert_days = int(settings["expiryAlertDays"])
        rows = conn.execute(
            """SELECT p.*, s.company AS supplier_name FROM products p
               LEFT JOIN suppliers s ON s.id=p.supplier_id
               WHERE p.business_id=? AND p.active=1 ORDER BY p.name COLLATE NOCASE""",
            (current_business_id(),),
        ).fetchall()
        products = [inventory_product_out(row, alert_days) for row in rows]
        total_value = round(sum(product["stockValue"] for product in products), 2)
        total_retail = round(sum(product["retailValue"] for product in products), 2)
        total_units = round(sum(product["stock"] for product in products), 6)
        low_stock = [product for product in products if product["stockStatus"] in ("low", "out", "negative")]
        expiring = list_inventory_lots(status="por_vencer")
        expired = list_inventory_lots(status="vencido")
        recent = inventory_movements(limit=12)
        return {
            "totalValue": total_value, "totalRetailValue": total_retail, "totalUnits": total_units,
            "productCount": len(products), "lowStockCount": len(low_stock),
            "outOfStockCount": len([product for product in products if product["stockStatus"] == "out"]),
            "negativeStockCount": len([product for product in products if product["stockStatus"] == "negative"]),
            "expiringCount": len(expiring), "expiredCount": len(expired),
            "wasteCost": _waste_cost(conn, 30),
            "lowStockProducts": low_stock[:20], "expiringLots": expiring[:20],
            "recentMovements": recent, "settings": settings,
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }


def _waste_cost(conn: sqlite3.Connection, days: int) -> float:
    row = conn.execute(
        """SELECT COALESCE(SUM(ABS(quantity_delta) * unit_cost),0) FROM inventory_movements
           WHERE business_id=? AND movement_type='waste' AND created_at >= datetime('now', ?)""",
        (current_business_id(), f"-{int(days)} days"),
    ).fetchone()
    return round(float(row[0] or 0), 2)


@app.get("/api/inventory/alerts")
def inventory_alerts():
    with connection() as conn:
        settings = inventory_settings(conn)
        alert_days = int(settings["expiryAlertDays"])
        alerts: list[dict] = []
        rows = conn.execute(
            """SELECT p.*, s.company AS supplier_name FROM products p
               LEFT JOIN suppliers s ON s.id=p.supplier_id
               WHERE p.business_id=? AND p.active=1""",
            (current_business_id(),),
        ).fetchall()
        for row in rows:
            product = inventory_product_out(row, alert_days)
            if product["stock"] < 0:
                alerts.append({
                    "type": "negative_stock", "severity": "high", "productId": product["id"],
                    "productName": product["name"], "sku": product["sku"], "stock": product["stock"],
                    "minStock": product["minStock"], "unit": product["unit"],
                    "message": f"Stock negativo en {product['name']}: {product['stock']:g} {product['unit']}.",
                })
            elif product["stock"] <= 0:
                alerts.append({
                    "type": "out_of_stock", "severity": "high", "productId": product["id"],
                    "productName": product["name"], "sku": product["sku"], "stock": product["stock"],
                    "minStock": product["minStock"], "unit": product["unit"],
                    "message": f"{product['name']} está agotado.",
                })
            elif settings["lowStockAlerts"] and product["stock"] <= product["minStock"]:
                alerts.append({
                    "type": "low_stock", "severity": "medium", "productId": product["id"],
                    "productName": product["name"], "sku": product["sku"], "stock": product["stock"],
                    "minStock": product["minStock"], "unit": product["unit"],
                    "message": f"Stock bajo de {product['name']}: quedan {product['stock']:g} {product['unit']} (mínimo {product['minStock']:g}).",
                })
        for lot in list_inventory_lots(status="vencido"):
            alerts.append({
                "type": "expired_lot", "severity": "high", "productId": lot["productId"],
                "productName": lot["productName"], "sku": lot["sku"], "lotCode": lot["lotCode"],
                "expiryDate": lot["expiryDate"], "daysLeft": lot["daysLeft"], "quantity": lot["quantity"],
                "unit": lot["productUnit"],
                "message": f"Lote vencido de {lot['productName']} ({lot['lotCode']}): {lot['quantity']:g} {lot['productUnit']}.",
            })
        for lot in list_inventory_lots(status="por_vencer"):
            alerts.append({
                "type": "expiring_lot", "severity": "medium", "productId": lot["productId"],
                "productName": lot["productName"], "sku": lot["sku"], "lotCode": lot["lotCode"],
                "expiryDate": lot["expiryDate"], "daysLeft": lot["daysLeft"], "quantity": lot["quantity"],
                "unit": lot["productUnit"],
                "message": f"Lote de {lot['productName']} ({lot['lotCode']}) vence en {lot['daysLeft']} días.",
            })
        severity_order = {"high": 0, "medium": 1, "low": 2}
        alerts.sort(key=lambda alert: (severity_order.get(alert["severity"], 9), alert["type"], alert["productName"]))
        return {"generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "alerts": alerts}


@app.get("/api/inventory/price-history")
def inventory_price_history(productId: str | None = None, supplierId: str | None = None, limit: int = Query(default=200, ge=1, le=1000)):
    with connection() as conn:
        query = """SELECT h.*, p.name AS product_name, p.sku, p.unit AS product_unit,
                   s.company AS supplier_name
                   FROM supplier_price_history h JOIN products p ON p.id=h.product_id
                   LEFT JOIN suppliers s ON s.id=h.supplier_id
                   WHERE h.business_id=?"""
        params: list = [current_business_id()]
        if productId:
            query += " AND h.product_id=?"
            params.append(productId)
        if supplierId:
            query += " AND h.supplier_id=?"
            params.append(supplierId)
        query += " ORDER BY h.created_at DESC, h.id DESC LIMIT ?"
        params.append(limit)
        return [{
            "id": row["id"], "productId": row["product_id"], "productName": row["product_name"],
            "sku": row["sku"], "productUnit": row["product_unit"], "supplierId": row["supplier_id"],
            "supplierName": row["supplier_name"], "unitCost": float(row["unit_cost"] or 0),
            "source": row["source"], "referenceType": row["reference_type"], "referenceId": row["reference_id"],
            "createdBy": row["created_by"], "createdAt": timestamp_iso(row["created_at"]),
        } for row in conn.execute(query, params).fetchall()]


@app.get("/api/inventory/reports")
def inventory_reports(days: int = Query(default=30, ge=1, le=365), noMovementDays: int = Query(default=60, ge=1, le=3650)):
    with connection() as conn:
        settings = inventory_settings(conn)
        alert_days = int(settings["expiryAlertDays"])
        rows = conn.execute(
            """SELECT p.*, s.company AS supplier_name FROM products p
               LEFT JOIN suppliers s ON s.id=p.supplier_id
               WHERE p.business_id=? AND p.active=1""",
            (current_business_id(),),
        ).fetchall()
        products = [inventory_product_out(row, alert_days) for row in rows]
        total_value = round(sum(product["stockValue"] for product in products), 2)
        critical = [product for product in products if product["stockStatus"] in ("low", "out", "negative")]
        expiring = list_inventory_lots(status="por_vencer") + list_inventory_lots(status="vencido")

        waste_row = conn.execute(
            """SELECT COALESCE(SUM(ABS(quantity_delta) * unit_cost),0) FROM inventory_movements
               WHERE business_id=? AND movement_type='waste' AND created_at >= datetime('now', ?)""",
            (current_business_id(), f"-{days} days"),
        ).fetchone()
        waste_by_reason = [{
            "reasonCode": row["reason_code"] or "otro",
            "reasonLabel": WASTE_REASON_LABELS.get(row["reason_code"] or "otro", "Otro"),
            "quantity": round(float(row["quantity"] or 0), 6),
            "cost": round(float(row["cost"] or 0), 2),
        } for row in conn.execute(
            """SELECT o.reason_code, SUM(ABS(m.quantity_delta)) AS quantity,
                      SUM(ABS(m.quantity_delta) * m.unit_cost) AS cost
               FROM inventory_movements m LEFT JOIN inventory_operations o ON o.id=m.operation_id
               WHERE m.business_id=? AND m.movement_type='waste' AND m.created_at >= datetime('now', ?)
               GROUP BY o.reason_code ORDER BY cost DESC""",
            (current_business_id(), f"-{days} days"),
        ).fetchall()]

        rotation = [{
            "productId": row["product_id"], "productName": row["product_name"], "sku": row["sku"],
            "unit": row["unit"], "quantity": round(float(row["quantity"] or 0), 6),
            "cost": round(float(row["cost"] or 0), 2), "movements": int(row["movement_count"] or 0),
        } for row in conn.execute(
            """SELECT m.product_id, p.name AS product_name, p.sku, p.unit,
                      SUM(ABS(m.quantity_delta)) AS quantity,
                      SUM(ABS(m.quantity_delta) * m.unit_cost) AS cost,
                      COUNT(*) AS movement_count
               FROM inventory_movements m JOIN products p ON p.id=m.product_id
               WHERE m.business_id=? AND m.quantity_delta < 0
                 AND m.movement_type IN ('sale','recipe_consumption','consumption','waste')
                 AND m.created_at >= datetime('now', ?)
               GROUP BY m.product_id ORDER BY quantity DESC LIMIT 50""",
            (current_business_id(), f"-{days} days"),
        ).fetchall()]

        cutoff = f"-{noMovementDays} days"
        no_movement = [{
            "productId": row["id"], "productName": row["name"], "sku": row["sku"],
            "stock": float(row["stock"] or 0), "unit": row["unit"],
            "lastMovementAt": timestamp_iso(row["last_movement"]),
        } for row in conn.execute(
            """SELECT p.id,p.name,p.sku,p.stock,p.unit,MAX(m.created_at) AS last_movement
               FROM products p LEFT JOIN inventory_movements m ON m.product_id=p.id
               WHERE p.business_id=? AND p.active=1
               GROUP BY p.id
               HAVING MAX(m.created_at) IS NULL OR MAX(m.created_at) < datetime('now', ?)
               ORDER BY p.name COLLATE NOCASE""",
            (current_business_id(), cutoff),
        ).fetchall()]

        count_differences = [{
            "countId": row["count_id"], "productId": row["product_id"], "productName": row["product_name"],
            "sku": row["sku"] or "",
            "systemQuantity": float(row["system_quantity"] or 0),
            "countedQuantity": float(row["counted_quantity"] or 0),
            "difference": float(row["difference"] or 0), "unit": row["unit"],
            "createdAt": timestamp_iso(row["created_at"]),
        } for row in conn.execute(
            """SELECT pci.*, p.name AS product_name, p.sku, p.unit
               FROM physical_count_items pci JOIN products p ON p.id=pci.product_id
               JOIN physical_counts pc ON pc.id=pci.count_id
               WHERE pc.business_id=? AND pc.created_at >= datetime('now','-90 days')
                 AND ABS(pci.difference) > 0.000001
               ORDER BY pc.created_at DESC, pci.id DESC LIMIT 100""",
            (current_business_id(),),
        ).fetchall()]

        return {
            "totalValue": total_value, "totalUnits": round(sum(product["stock"] for product in products), 6),
            "productCount": len(products), "criticalStock": critical, "criticalStockCount": len(critical),
            "expiringItems": expiring, "expiringCount": len(expiring),
            "wasteCost": round(float(waste_row[0] or 0), 2), "wasteByReason": waste_by_reason,
            "rotation": rotation, "noMovement": no_movement, "countDifferences": count_differences,
            "periodDays": days, "noMovementDays": noMovementDays,
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }


@app.get("/api/inventory/replenishment")
def inventory_replenishment():
    with connection() as conn:
        rows = conn.execute(
            """SELECT p.*, s.company AS supplier_name,
                      (SELECT h.unit_cost FROM supplier_price_history h WHERE h.product_id=p.id AND h.business_id=p.business_id ORDER BY h.created_at DESC, h.id DESC LIMIT 1) AS last_cost
               FROM products p LEFT JOIN suppliers s ON s.id=p.supplier_id
               WHERE p.business_id=? AND p.active=1 AND p.stock <= p.min_stock
               ORDER BY (p.stock - p.min_stock) ASC, p.name COLLATE NOCASE""",
            (current_business_id(),),
        ).fetchall()
        result = []
        for row in rows:
            stock = float(row["stock"] or 0)
            min_stock = float(row["min_stock"] or 0)
            suggested = max(1.0, round(min_stock * 2 - stock, 6))
            last_cost = float(row["last_cost"] if row["last_cost"] is not None else row["cost"] or 0)
            result.append({
                **inventory_product_out(row),
                "suggestedQuantity": suggested, "lastCost": last_cost,
                "estimatedCost": round(suggested * last_cost, 2),
            })
        return result


@app.get("/api/inventory/dish-costing")
def inventory_dish_costing():
    with connection() as conn:
        rows = conn.execute(
            """SELECT r.*, p.name AS product_name, p.price, p.unit AS product_unit
               FROM recipes r JOIN products p ON p.id=r.product_id
               WHERE r.business_id=? ORDER BY p.name COLLATE NOCASE""",
            (current_business_id(),),
        ).fetchall()
        result = []
        for row in rows:
            cost = recipe_unit_cost(conn, row["product_id"]) or 0.0
            price = float(row["price"] or 0)
            ingredients = []
            for item in conn.execute(
                """SELECT ri.ingredient_id,ri.quantity,ri.unit,p.name,p.unit AS product_unit,p.cost
                   FROM recipe_items ri JOIN products p ON p.id=ri.ingredient_id WHERE ri.recipe_id=?""",
                (row["id"],),
            ).fetchall():
                converted = convert_quantity(float(item["quantity"] or 0), item["unit"], item["product_unit"]) if item["unit"] else float(item["quantity"] or 0)
                ingredients.append({
                    "ingredientId": item["ingredient_id"], "name": item["name"],
                    "quantity": float(item["quantity"] or 0), "unit": item["unit"] or item["product_unit"],
                    "baseQuantity": converted, "productUnit": item["product_unit"],
                    "unitCost": float(item["cost"] or 0), "cost": round(converted * float(item["cost"] or 0), 4),
                })
            margin = round(price - cost, 2)
            result.append({
                "recipeId": row["id"], "productId": row["product_id"], "productName": row["product_name"],
                "yieldQuantity": float(row["yield_quantity"] or 1), "cost": cost, "price": price,
                "margin": margin, "marginPercent": round((margin / price * 100) if price else 0, 2),
                "ingredients": ingredients,
            })
        return result


class ProductSubstitutionPayload(BaseModel):
    productId: str
    substituteId: str
    priority: int = Field(default=1, ge=1, le=999)
    notes: str = Field(default="", max_length=500)


@app.get("/api/inventory/substitutions")
def list_product_substitutions(productId: str | None = None):
    with connection() as conn:
        query = """SELECT ps.*, p.name AS product_name, s.name AS substitute_name, s.stock AS substitute_stock, s.unit AS substitute_unit
                   FROM product_substitutions ps
                   JOIN products p ON p.id=ps.product_id
                   JOIN products s ON s.id=ps.substitute_id
                   WHERE ps.business_id=?"""
        params: list = [current_business_id()]
        if productId:
            query += " AND ps.product_id=?"
            params.append(productId)
        rows = conn.execute(query + " ORDER BY ps.product_id, ps.priority, s.name", params).fetchall()
        return [{
            "productId": row["product_id"], "productName": row["product_name"],
            "substituteId": row["substitute_id"], "substituteName": row["substitute_name"],
            "substituteStock": float(row["substitute_stock"] or 0), "substituteUnit": row["substitute_unit"],
            "priority": int(row["priority"] or 1), "notes": row["notes"],
        } for row in rows]


@app.post("/api/inventory/substitutions", status_code=201)
def save_product_substitution(payload: ProductSubstitutionPayload):
    if payload.productId == payload.substituteId:
        raise HTTPException(422, "Un producto no puede ser sustituto de sí mismo.")
    with connection() as conn:
        fetch_inventory_product(conn, payload.productId)
        fetch_inventory_product(conn, payload.substituteId)
        conn.execute(
            """INSERT INTO product_substitutions (business_id,product_id,substitute_id,priority,notes)
               VALUES (?,?,?,?,?)
               ON CONFLICT(business_id,product_id,substitute_id)
               DO UPDATE SET priority=excluded.priority, notes=excluded.notes""",
            (current_business_id(), payload.productId, payload.substituteId, payload.priority, payload.notes.strip()),
        )
        audit(conn, "upsert", "product_substitution", f"{payload.productId}:{payload.substituteId}")
        return {"ok": True, "productId": payload.productId, "substituteId": payload.substituteId}


@app.delete("/api/inventory/substitutions/{product_id}/{substitute_id}")
def delete_product_substitution(product_id: str, substitute_id: str):
    with connection() as conn:
        cur = conn.execute(
            "DELETE FROM product_substitutions WHERE business_id=? AND product_id=? AND substitute_id=?",
            (current_business_id(), product_id, substitute_id),
        )
        if not cur.rowcount:
            raise HTTPException(404, "Sustituto no encontrado.")
        audit(conn, "delete", "product_substitution", f"{product_id}:{substitute_id}")
        return {"ok": True}


class CashSessionOpenPayload(BaseModel):
    openedBy: str = Field(default="Usuario local", min_length=1, max_length=120)
    openingAmount: float = Field(ge=0, le=100000000000)


class CashSessionClosePayload(BaseModel):
    closingAmount: float = Field(ge=0, le=100000000000)


def cash_session_out(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    cash_sales = conn.execute("""SELECT COALESCE(SUM(CASE
        WHEN EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id=s.id) THEN
          (SELECT COALESCE(SUM(sp2.amount),0) FROM sale_payments sp2 WHERE sp2.sale_id=s.id AND sp2.method='cash')
        WHEN s.payment_method='cash' THEN s.total ELSE 0 END),0)
        FROM sales s WHERE s.cash_session_id=? AND s.status='completed'""", (row["id"],)).fetchone()[0]
    expected = round(row["opening_amount"] + cash_sales, 2)
    return {"id": row["id"], "openedBy": row["opened_by"], "openingAmount": row["opening_amount"],
            "closingAmount": row["closing_amount"], "expectedAmount": row["expected_amount"] if row["status"] == "closed" else expected,
            "difference": row["difference"], "status": row["status"], "openedAt": timestamp_iso(row["opened_at"]), "closedAt": timestamp_iso(row["closed_at"])}


@app.get("/api/cash/sessions/current")
def current_cash_session():
    with connection() as conn:
        row = conn.execute("SELECT * FROM cash_sessions WHERE business_id=? AND opened_by_user_id=? AND status='open' ORDER BY opened_at DESC LIMIT 1", (current_business_id(), current_identity()["id"])).fetchone()
        return cash_session_out(conn, row) if row else None


@app.get("/api/cash/sessions")
def list_cash_sessions(limit: int = Query(default=100, ge=1, le=500)):
    with connection() as conn:
        if current_identity()["role"] == "cashier":
            rows = conn.execute("SELECT * FROM cash_sessions WHERE business_id=? AND opened_by_user_id=? ORDER BY opened_at DESC LIMIT ?", (current_business_id(), current_identity()["id"], limit)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM cash_sessions WHERE business_id=? ORDER BY opened_at DESC LIMIT ?", (current_business_id(), limit)).fetchall()
        return [cash_session_out(conn, row) for row in rows]


@app.get("/api/cash/sessions/{session_id}")
def get_cash_session(session_id: str):
    with connection() as conn:
        if current_identity()["role"] == "cashier":
            row = conn.execute("SELECT * FROM cash_sessions WHERE id=? AND business_id=? AND opened_by_user_id=?", (session_id, current_business_id(), current_identity()["id"])).fetchone()
        else:
            row = conn.execute("SELECT * FROM cash_sessions WHERE id=? AND business_id=?", (session_id, current_business_id())).fetchone()
        if not row:
            raise HTTPException(404, "Turno de caja no encontrado.")
        return cash_session_out(conn, row)


@app.post("/api/cash/sessions", status_code=201)
def open_cash_session(payload: CashSessionOpenPayload):
    session_id = f"CAJ-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        opened = conn.execute("SELECT id FROM cash_sessions WHERE business_id=? AND opened_by_user_id=? AND status='open' LIMIT 1", (current_business_id(), current_identity()["id"])).fetchone()
        if opened:
            conn.rollback()
            raise HTTPException(409, "Ya tienes un turno de caja abierto. Ciérralo antes de abrir otro.")
        conn.execute("INSERT INTO cash_sessions (id,business_id,opened_by,opened_by_user_id,opening_amount,status) VALUES (?,?,?,?,?,'open')", (session_id, current_business_id(), current_identity()["name"], current_identity()["id"], payload.openingAmount))
        audit(conn, "open", "cash_session", session_id, {"openingAmount": payload.openingAmount})
        conn.commit()
        row = conn.execute("SELECT * FROM cash_sessions WHERE id=?", (session_id,)).fetchone()
        return cash_session_out(conn, row)


@app.post("/api/cash/sessions/{session_id}/close")
def close_cash_session(session_id: str, payload: CashSessionClosePayload):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if current_identity()["role"] == "cashier":
            row = conn.execute("SELECT * FROM cash_sessions WHERE id=? AND business_id=? AND opened_by_user_id=?", (session_id, current_business_id(), current_identity()["id"])).fetchone()
        else:
            row = conn.execute("SELECT * FROM cash_sessions WHERE id=? AND business_id=?", (session_id, current_business_id())).fetchone()
        if not row:
            conn.rollback()
            raise HTTPException(404, "Turno de caja no encontrado.")
        if row["status"] == "closed":
            conn.commit()
            return cash_session_out(conn, row)
        current = cash_session_out(conn, row)
        expected = current["expectedAmount"]
        difference = round(payload.closingAmount - expected, 2)
        conn.execute("UPDATE cash_sessions SET closing_amount=?,expected_amount=?,difference=?,status='closed',closed_at=CURRENT_TIMESTAMP WHERE id=?", (payload.closingAmount, expected, difference, session_id))
        audit(conn, "close", "cash_session", session_id, {"closingAmount": payload.closingAmount, "expectedAmount": expected, "difference": difference})
        conn.commit()
        closed = conn.execute("SELECT * FROM cash_sessions WHERE id=?", (session_id,)).fetchone()
        return cash_session_out(conn, closed)


def hotel_room_out(row: sqlite3.Row) -> dict:
    try:
        amenities = json.loads(row["amenities_json"] or "[]")
    except json.JSONDecodeError:
        amenities = []
    return {"id": row["id"], "number": row["room_number"], "roomNumber": row["room_number"],
            "type": row["room_type"], "roomType": row["room_type"], "floor": row["floor"],
            "capacity": row["capacity"], "pricePerNight": row["price_per_night"], "status": row["status"],
            "amenities": amenities, "createdAt": timestamp_iso(row["created_at"]), "updatedAt": timestamp_iso(row["updated_at"])}


def hotel_reservation_out(row: sqlite3.Row) -> dict:
    check_in = datetime.strptime(row["check_in"], "%Y-%m-%d").date()
    check_out = datetime.strptime(row["check_out"], "%Y-%m-%d").date()
    return {"id": row["id"], "roomId": row["room_id"], "roomNumber": row["room_number"],
            "guestName": row["guest_name"], "guestEmail": row["guest_email"], "guestPhone": row["guest_phone"],
            "checkIn": row["check_in"], "checkOut": row["check_out"], "status": row["status"],
            "advance": row["advance"], "totalCharges": row["total_charges"], "nights": max((check_out-check_in).days, 0),
            "createdAt": timestamp_iso(row["created_at"])}


@app.get("/api/hotel/rooms")
def list_hotel_rooms():
    business_id = current_business_id()
    with connection() as conn:
        rows = conn.execute("SELECT * FROM hotel_rooms WHERE business_id=? ORDER BY floor,room_number", (business_id,)).fetchall()
        return [hotel_room_out(row) for row in rows]


@app.post("/api/hotel/rooms", status_code=201)
def create_hotel_room(payload: HotelRoomPayload):
    if current_identity()["role"] != "owner":
        raise HTTPException(403, "Solo el propietario puede crear habitaciones.")
    business_id = current_business_id()
    room_id = f"ROOM-{uuid.uuid4().hex[:12].upper()}"
    with connection() as conn:
        try:
            conn.execute("INSERT INTO hotel_rooms (id,business_id,room_number,room_type,floor,capacity,price_per_night,status,amenities_json) VALUES (?,?,?,?,?,?,?,?,?)",
                         (room_id, business_id, payload.roomNumber, payload.roomType, payload.floor, payload.capacity,
                          payload.pricePerNight, payload.status, json.dumps(payload.amenities, ensure_ascii=False)))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "Ya existe una habitación con ese número en este hotel.") from exc
        audit(conn, "create", "hotel_room", room_id, {"roomNumber": payload.roomNumber})
        row = conn.execute("SELECT * FROM hotel_rooms WHERE id=? AND business_id=?", (room_id, business_id)).fetchone()
        return hotel_room_out(row)


@app.get("/api/hotel/reservations")
def list_hotel_reservations(status: str | None = Query(default=None, max_length=30)):
    business_id = current_business_id()
    query = "SELECT r.*,h.room_number FROM hotel_reservations r JOIN hotel_rooms h ON h.id=r.room_id AND h.business_id=r.business_id WHERE r.business_id=?"
    params: list = [business_id]
    if status:
        if status not in {"confirmed", "checkin", "checkout", "cancelled"}:
            raise HTTPException(422, "Estado de reserva no válido.")
        query += " AND r.status=?"
        params.append(status)
    query += " ORDER BY r.check_in,r.room_id"
    with connection() as conn:
        return [hotel_reservation_out(row) for row in conn.execute(query, params).fetchall()]


def compute_hotel_stay_charge(room_row, check_in: str, check_out: str) -> float:
    """Calcula el cargo de la habitación consumida: noches x precio por noche."""
    start = datetime.strptime(check_in, "%Y-%m-%d").date()
    end = datetime.strptime(check_out, "%Y-%m-%d").date()
    nights = max((end - start).days, 1)
    return float(room_row["price_per_night"] or 0) * nights


@app.post("/api/hotel/reservations", status_code=201)
def create_hotel_reservation(payload: HotelReservationPayload):
    identity = current_identity()
    if identity["role"] not in {"owner", "business_admin"} and "hotel.manage" not in set(identity.get("permissions", [])):
        custom_id = identity.get("custom_role_id")
        if not custom_id:
            raise HTTPException(403, "Tu rol no puede crear reservas.")
        with connection() as conn:
            role = conn.execute("SELECT permissions_json FROM custom_roles WHERE id=? AND business_id=?", (custom_id, current_business_id())).fetchone()
        if not role or "hotel.manage" not in set(json.loads(role["permissions_json"] or "[]")):
            raise HTTPException(403, "Tu rol no puede crear reservas.")
    business_id = current_business_id()
    reservation_id = f"RES-{uuid.uuid4().hex[:12].upper()}"
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        room = conn.execute("SELECT * FROM hotel_rooms WHERE id=? AND business_id=?", (payload.roomId, business_id)).fetchone()
        if not room:
            conn.rollback()
            raise HTTPException(404, "La habitación no existe en este hotel.")
        if room["status"] in {"maintenance", "cleaning"}:
            conn.rollback()
            raise HTTPException(409, "La habitación no está habilitada para reservas.")
        overlap = conn.execute("SELECT id FROM hotel_reservations WHERE business_id=? AND room_id=? AND status IN ('confirmed','checkin') AND check_in<? AND check_out>? LIMIT 1",
                               (business_id, payload.roomId, payload.checkOut, payload.checkIn)).fetchone()
        if overlap:
            conn.rollback()
            raise HTTPException(409, "La habitación ya tiene una reserva para parte de ese periodo.")
        total = compute_hotel_stay_charge(room, payload.checkIn, payload.checkOut)
        if payload.advance > total:
            conn.rollback()
            raise HTTPException(422, "El anticipo no puede superar el valor total de la reserva.")
        conn.execute("INSERT INTO hotel_reservations (id,business_id,room_id,guest_name,guest_email,guest_phone,check_in,check_out,status,advance,total_charges) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                     (reservation_id,business_id,payload.roomId,payload.guestName,payload.guestEmail.strip(),payload.guestPhone.strip(),payload.checkIn,payload.checkOut,"confirmed",payload.advance,total))
        conn.execute("UPDATE hotel_rooms SET status='reserved',updated_at=CURRENT_TIMESTAMP WHERE id=? AND business_id=? AND status='available'", (payload.roomId,business_id))
        audit(conn, "create", "hotel_reservation", reservation_id, {"roomId": payload.roomId, "checkIn": payload.checkIn, "checkOut": payload.checkOut})
        row = conn.execute("SELECT r.*,h.room_number FROM hotel_reservations r JOIN hotel_rooms h ON h.id=r.room_id AND h.business_id=r.business_id WHERE r.id=? AND r.business_id=?", (reservation_id,business_id)).fetchone()
        conn.commit()
        return hotel_reservation_out(row)


@app.patch("/api/hotel/reservations/{reservation_id}/status")
def update_hotel_reservation_status(reservation_id: str, payload: HotelReservationStatusPayload):
    identity = current_identity()
    if identity["role"] not in {"owner", "business_admin"} and "hotel.manage" not in set(identity.get("permissions", [])):
        custom_id = identity.get("custom_role_id")
        if not custom_id:
            raise HTTPException(403, "Tu rol no puede actualizar reservas.")
        with connection() as conn:
            role = conn.execute("SELECT permissions_json FROM custom_roles WHERE id=? AND business_id=?", (custom_id, current_business_id())).fetchone()
        if not role or "hotel.manage" not in set(json.loads(role["permissions_json"] or "[]")):
            raise HTTPException(403, "Tu rol no puede actualizar reservas.")
    business_id = current_business_id()
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        reservation = conn.execute("SELECT * FROM hotel_reservations WHERE id=? AND business_id=?", (reservation_id,business_id)).fetchone()
        if not reservation:
            conn.rollback()
            raise HTTPException(404, "Reserva no encontrada.")
        conn.execute("UPDATE hotel_reservations SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND business_id=?", (payload.status,reservation_id,business_id))
        # Recalculate occupancy for this room after the reservation status changes.
        # A checkout/cancellation must not make a room available if another booking is active.
        room = conn.execute("SELECT * FROM hotel_rooms WHERE id=? AND business_id=?", (reservation["room_id"], business_id)).fetchone()
        if room and room["status"] not in {"maintenance", "cleaning"}:
            has_checkin = conn.execute("SELECT 1 FROM hotel_reservations WHERE business_id=? AND room_id=? AND status='checkin' LIMIT 1", (business_id, reservation["room_id"])).fetchone()
            has_upcoming = conn.execute("SELECT 1 FROM hotel_reservations WHERE business_id=? AND room_id=? AND status='confirmed' AND check_out>date('now') LIMIT 1", (business_id, reservation["room_id"])).fetchone()
            next_room_status = "occupied" if has_checkin else "reserved" if has_upcoming else "available"
            conn.execute("UPDATE hotel_rooms SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND business_id=?", (next_room_status, reservation["room_id"], business_id))
        # Consumo de habitación: recalcular el cargo (noches × precio por noche) y mantenerlo en la cuenta.
        if room:
            stay_charge = compute_hotel_stay_charge(room, reservation["check_in"], reservation["check_out"])
            conn.execute("UPDATE hotel_reservations SET total_charges=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND business_id=?", (stay_charge, reservation_id, business_id))
        audit(conn, payload.status, "hotel_reservation", reservation_id, {"status": payload.status})
        row = conn.execute("SELECT r.*,h.room_number FROM hotel_reservations r JOIN hotel_rooms h ON h.id=r.room_id AND h.business_id=r.business_id WHERE r.id=? AND r.business_id=?", (reservation_id,business_id)).fetchone()
        conn.commit()
        return hotel_reservation_out(row)


def service_out(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "nombre": row["name"], "name": row["name"], "duracion": row["duration_minutes"],
            "durationMinutes": row["duration_minutes"], "precio": row["price"], "price": row["price"], "categoria": row["category"],
            "category": row["category"], "color": row["color"], "active": bool(row["active"])}


def professional_out(row: sqlite3.Row) -> dict:
    try:
        availability = json.loads(row["availability_json"] or "[]")
    except json.JSONDecodeError:
        availability = []
    return {"id": row["id"], "nombre": row["name"], "name": row["name"], "especialidad": row["specialty"],
            "specialty": row["specialty"], "color": row["color"], "horario": availability, "availability": availability,
            "active": bool(row["active"])}


def appointment_out(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "clienteId": row["client_id"] if "client_id" in row.keys() else None,
            "clienteNombre": row["client_name"], "clienteTelefono": row["client_phone"], "clienteEmail": row["client_email"],
            "servicioId": row["service_id"], "servicioNombre": row["service_name_snapshot"],
            "profesionalId": row["professional_id"], "profesionalNombre": row["professional_name_snapshot"],
            "fecha": row["appointment_date"], "horaInicio": row["start_time"], "horaFin": row["end_time"],
            "estado": row["status"], "notes": row["notes"], "durationMinutes": row["duration_minutes"],
            "price": row["price_snapshot"], "createdAt": timestamp_iso(row["created_at"])}


@app.get("/api/services/catalog")
def list_services_catalog():
    with connection() as conn:
        rows = conn.execute("SELECT * FROM service_catalog WHERE business_id=? AND active=1 ORDER BY name COLLATE NOCASE", (current_business_id(),)).fetchall()
        return [service_out(row) for row in rows]


@app.post("/api/services/catalog", status_code=201)
def create_service_catalog_item(payload: ServicePayload):
    if current_identity()["role"] != "owner":
        raise HTTPException(403, "Solo el propietario puede administrar los servicios.")
    business_id = current_business_id()
    service_id = f"SVC-{uuid.uuid4().hex[:12].upper()}"
    with connection() as conn:
        try:
            conn.execute("INSERT INTO service_catalog (id,business_id,name,duration_minutes,price,category,color,active) VALUES (?,?,?,?,?,?,?,1)", (service_id,business_id,payload.name.strip(),payload.durationMinutes,payload.price,payload.category.strip(),payload.color))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "Ya existe un servicio con ese nombre.") from exc
        audit(conn, "create", "service", service_id, {"name": payload.name})
        row = conn.execute("SELECT * FROM service_catalog WHERE id=? AND business_id=?", (service_id,business_id)).fetchone()
        return service_out(row)


@app.get("/api/services/professionals")
def list_service_professionals():
    with connection() as conn:
        rows = conn.execute("SELECT * FROM service_professionals WHERE business_id=? AND active=1 ORDER BY name COLLATE NOCASE", (current_business_id(),)).fetchall()
        return [professional_out(row) for row in rows]


@app.post("/api/services/professionals", status_code=201)
def create_service_professional(payload: ProfessionalPayload):
    if current_identity()["role"] != "owner":
        raise HTTPException(403, "Solo el propietario puede administrar profesionales.")
    business_id = current_business_id()
    professional_id = f"PRO-{uuid.uuid4().hex[:12].upper()}"
    with connection() as conn:
        try:
            conn.execute("INSERT INTO service_professionals (id,business_id,name,specialty,color,availability_json,active) VALUES (?,?,?,?,?,?,1)", (professional_id,business_id,payload.name.strip(),payload.specialty.strip(),payload.color,json.dumps(payload.availability,ensure_ascii=False)))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "Ya existe un profesional con ese nombre.") from exc
        audit(conn, "create", "service_professional", professional_id, {"name": payload.name})
        row = conn.execute("SELECT * FROM service_professionals WHERE id=? AND business_id=?", (professional_id,business_id)).fetchone()
        return professional_out(row)


@app.get("/api/services/appointments")
def list_service_appointments(date_from: str | None = Query(default=None, alias="from"), date_to: str | None = Query(default=None, alias="to")):
    business_id = current_business_id()
    query = "SELECT * FROM service_appointments WHERE business_id=?"
    params: list = [business_id]
    for date_value in (date_from, date_to):
        if date_value:
            try:
                datetime.strptime(date_value, "%Y-%m-%d")
            except ValueError as exc:
                raise HTTPException(422, "Los filtros de fecha deben usar AAAA-MM-DD.") from exc
    if date_from:
        query += " AND appointment_date>=?"
        params.append(date_from)
    if date_to:
        query += " AND appointment_date<=?"
        params.append(date_to)
    query += " ORDER BY appointment_date,start_time"
    with connection() as conn:
        return [appointment_out(row) for row in conn.execute(query,params).fetchall()]


@app.post("/api/services/appointments", status_code=201)
def create_service_appointment(payload: AppointmentPayload):
    identity = current_identity()
    if identity["role"] not in {"owner", "business_admin"} and "services.manage" not in set(identity.get("permissions", [])):
        custom_id = identity.get("custom_role_id")
        if not custom_id:
            raise HTTPException(403, "Tu rol no puede crear citas.")
        with connection() as conn:
            role = conn.execute("SELECT permissions_json FROM custom_roles WHERE id=? AND business_id=?", (custom_id,current_business_id())).fetchone()
        if not role or "services.manage" not in set(json.loads(role["permissions_json"] or "[]")):
            raise HTTPException(403, "Tu rol no puede crear citas.")
    business_id = current_business_id()
    appointment_id = f"APT-{uuid.uuid4().hex[:12].upper()}"
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        service = conn.execute("SELECT * FROM service_catalog WHERE id=? AND business_id=? AND active=1", (payload.serviceId,business_id)).fetchone()
        professional = conn.execute("SELECT * FROM service_professionals WHERE id=? AND business_id=? AND active=1", (payload.professionalId,business_id)).fetchone()
        if not service or not professional:
            conn.rollback()
            raise HTTPException(404, "Selecciona un servicio y un profesional activos de este negocio.")
        start_dt = datetime.strptime(f"{payload.appointmentDate} {payload.startTime}", "%Y-%m-%d %H:%M")
        from datetime import time as datetime_time
        end_dt = start_dt + timedelta(minutes=service["duration_minutes"])
        end_time = end_dt.strftime("%H:%M")
        if end_dt.date().isoformat() != payload.appointmentDate:
            conn.rollback()
            raise HTTPException(422, "La cita no puede terminar después de la medianoche.")
        conflict = conn.execute("SELECT id FROM service_appointments WHERE business_id=? AND professional_id=? AND appointment_date=? AND status IN ('reserved','confirmed') AND start_time<? AND end_time>? LIMIT 1", (business_id,payload.professionalId,payload.appointmentDate,end_time,payload.startTime)).fetchone()
        if conflict:
            conn.rollback()
            raise HTTPException(409, "El profesional ya tiene una cita en ese horario.")
        conn.execute("INSERT INTO service_appointments (id,business_id,service_id,professional_id,client_name,client_email,client_phone,service_name_snapshot,professional_name_snapshot,duration_minutes,price_snapshot,appointment_date,start_time,end_time,status,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                     (appointment_id,business_id,service["id"],professional["id"],payload.clientName,payload.clientEmail.strip(),payload.clientPhone.strip(),service["name"],professional["name"],service["duration_minutes"],service["price"],payload.appointmentDate,payload.startTime,end_time,"reserved",payload.notes.strip()))
        audit(conn, "create", "service_appointment", appointment_id, {"serviceId": service["id"], "professionalId": professional["id"]})
        row = conn.execute("SELECT * FROM service_appointments WHERE id=? AND business_id=?",(appointment_id,business_id)).fetchone()
        conn.commit()
        return appointment_out(row)


@app.patch("/api/services/appointments/{appointment_id}/status")
def update_service_appointment_status(appointment_id: str, payload: AppointmentStatusPayload):
    identity = current_identity()
    if identity["role"] not in {"owner", "business_admin"} and "services.manage" not in set(identity.get("permissions", [])):
        custom_id = identity.get("custom_role_id")
        if not custom_id:
            raise HTTPException(403, "Tu rol no puede actualizar citas.")
        with connection() as conn:
            role = conn.execute("SELECT permissions_json FROM custom_roles WHERE id=? AND business_id=?", (custom_id,current_business_id())).fetchone()
        if not role or "services.manage" not in set(json.loads(role["permissions_json"] or "[]")):
            raise HTTPException(403, "Tu rol no puede actualizar citas.")
    business_id = current_business_id()
    with connection() as conn:
        cursor = conn.execute("UPDATE service_appointments SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND business_id=?", (payload.status,appointment_id,business_id))
        if cursor.rowcount == 0:
            raise HTTPException(404, "Cita no encontrada.")
        audit(conn, payload.status, "service_appointment", appointment_id, {"status": payload.status})
        row = conn.execute("SELECT * FROM service_appointments WHERE id=? AND business_id=?",(appointment_id,business_id)).fetchone()
        return appointment_out(row)


@app.put("/api/services/appointments/{appointment_id}")
def edit_service_appointment(appointment_id: str, payload: AppointmentPayload):
    identity = current_identity()
    business_id = current_business_id()
    if identity["role"] not in {"owner", "business_admin"}:
        custom_id = identity.get("custom_role_id")
        if not custom_id:
            raise HTTPException(403, "Tu rol no puede editar citas.")
        with connection() as conn:
            role = conn.execute("SELECT permissions_json FROM custom_roles WHERE id=? AND business_id=?", (custom_id, business_id)).fetchone()
        if not role or "services.manage" not in set(json.loads(role["permissions_json"] or "[]")):
            raise HTTPException(403, "Tu rol no puede editar citas.")
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute("SELECT id FROM service_appointments WHERE id=? AND business_id=?", (appointment_id, business_id)).fetchone()
        service = conn.execute("SELECT * FROM service_catalog WHERE id=? AND business_id=? AND active=1", (payload.serviceId, business_id)).fetchone()
        professional = conn.execute("SELECT * FROM service_professionals WHERE id=? AND business_id=? AND active=1", (payload.professionalId, business_id)).fetchone()
        if not existing:
            conn.rollback(); raise HTTPException(404, "Cita no encontrada.")
        if not service or not professional:
            conn.rollback(); raise HTTPException(404, "Selecciona un servicio y un profesional activos de este negocio.")
        start_dt = datetime.strptime(f"{payload.appointmentDate} {payload.startTime}", "%Y-%m-%d %H:%M")
        end_dt = start_dt + timedelta(minutes=service["duration_minutes"])
        end_time = end_dt.strftime("%H:%M")
        if end_dt.date().isoformat() != payload.appointmentDate:
            conn.rollback(); raise HTTPException(422, "La cita no puede terminar después de la medianoche.")
        conflict = conn.execute("SELECT id FROM service_appointments WHERE business_id=? AND professional_id=? AND appointment_date=? AND status IN ('reserved','confirmed') AND id<>? AND start_time<? AND end_time>? LIMIT 1", (business_id, payload.professionalId, payload.appointmentDate, appointment_id, end_time, payload.startTime)).fetchone()
        if conflict:
            conn.rollback(); raise HTTPException(409, "El profesional ya tiene una cita en ese horario.")
        conn.execute("UPDATE service_appointments SET service_id=?,professional_id=?,client_name=?,client_email=?,client_phone=?,service_name_snapshot=?,professional_name_snapshot=?,duration_minutes=?,price_snapshot=?,appointment_date=?,start_time=?,end_time=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND business_id=?", (service["id"], professional["id"], payload.clientName, payload.clientEmail.strip(), payload.clientPhone.strip(), service["name"], professional["name"], service["duration_minutes"], service["price"], payload.appointmentDate, payload.startTime, end_time, payload.notes.strip(), appointment_id, business_id))
        audit(conn, "edit", "service_appointment", appointment_id, {"serviceId": service["id"], "professionalId": professional["id"], "date": payload.appointmentDate, "startTime": payload.startTime})
        row = conn.execute("SELECT * FROM service_appointments WHERE id=? AND business_id=?", (appointment_id, business_id)).fetchone()
        conn.commit()
        return appointment_out(row)


@app.delete("/api/services/appointments/{appointment_id}", status_code=204)
def delete_service_appointment(appointment_id: str):
    identity = current_identity()
    business_id = current_business_id()
    if identity["role"] not in {"owner", "business_admin"}:
        custom_id = identity.get("custom_role_id")
        if not custom_id:
            raise HTTPException(403, "Tu rol no puede eliminar citas.")
        with connection() as conn:
            role = conn.execute("SELECT permissions_json FROM custom_roles WHERE id=? AND business_id=?", (custom_id, business_id)).fetchone()
        if not role or "services.manage" not in set(json.loads(role["permissions_json"] or "[]")):
            raise HTTPException(403, "Tu rol no puede eliminar citas.")
    with connection() as conn:
        row = conn.execute("SELECT id FROM service_appointments WHERE id=? AND business_id=?", (appointment_id, business_id)).fetchone()
        if not row:
            raise HTTPException(404, "Cita no encontrada.")
        conn.execute("DELETE FROM service_appointments WHERE id=? AND business_id=?", (appointment_id, business_id))
        audit(conn, "delete", "service_appointment", appointment_id, {})
    return None


@app.get("/api/orders")
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


class OrderPayload(BaseModel):
    channel: Literal["counter", "takeaway", "delivery", "table"] = "counter"
    customer: str = Field(default="Cliente general", max_length=120)
    phone: str = Field(default="", max_length=60)
    address: str = Field(default="", max_length=240)
    notes: str = Field(default="", max_length=1000)
    tableNumber: int | None = Field(default=None, ge=1, le=999)
    waiter: str = Field(default="", max_length=80)
    items: list[OrderItemPayload] = Field(min_length=1, max_length=200)


@app.post("/api/orders", status_code=201)
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
        audit(conn, "create", "order", order_id, {"total": total, "channel": channel, "tableNumber": payload.tableNumber, "waiter": payload.waiter.strip()})
        conn.commit()
        return {"id": order_id, "status": "received", "total": round(total, 2), "tableNumber": payload.tableNumber, "waiter": payload.waiter.strip(), "createdAt": datetime.now().astimezone().isoformat(timespec="seconds")}


@app.patch("/api/orders/{order_id}/status")
def update_order_status(order_id: str, status: Literal["received", "preparing", "ready", "delivered", "cancelled"]):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        order = conn.execute("SELECT * FROM orders WHERE id=? AND business_id=?", (order_id, current_business_id())).fetchone()
        if not order:
            conn.rollback()
            raise HTTPException(404, "Pedido no encontrado.")
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


@app.get("/api/orders/{order_id}")
def get_order(order_id: str):
    with connection() as conn:
        row = conn.execute("SELECT * FROM orders WHERE id=? AND business_id=?", (order_id, current_business_id())).fetchone()
        if not row:
            raise HTTPException(404, "Pedido no encontrado.")
        return order_to_dict(conn, row)


class OrderItemsPayload(BaseModel):
    items: list[OrderItemPayload] = Field(min_length=1, max_length=200)


@app.post("/api/orders/{order_id}/items", status_code=201)
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


@app.get("/api/tables")
def list_restaurant_tables():
    with connection() as conn:
        rows = conn.execute("SELECT * FROM restaurant_tables WHERE business_id=? ORDER BY number", (current_business_id(),)).fetchall()
        return [table_to_dict(conn, row) for row in rows]


@app.post("/api/tables", status_code=201)
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


@app.patch("/api/tables/{table_id}")
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


@app.delete("/api/tables/{table_id}")
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


class RecipeIngredientPayload(BaseModel):
    ingredientId: str
    quantity: float = Field(gt=0, le=100000)
    unit: str = Field(default="", max_length=32)


class RecipePayload(BaseModel):
    productId: str
    yieldQuantity: float = Field(default=1, gt=0, le=100000)
    instructions: str = Field(default="", max_length=2000)
    ingredients: list[RecipeIngredientPayload] = Field(min_length=1, max_length=100)


@app.get("/api/recipes")
def list_recipes():
    with connection() as conn:
        rows = conn.execute("""SELECT r.*, p.name AS product_name FROM recipes r
            JOIN products p ON p.id=r.product_id WHERE r.business_id=? ORDER BY p.name COLLATE NOCASE""", (current_business_id(),)).fetchall()
        result = []
        for row in rows:
            ingredients = conn.execute("""SELECT ri.ingredient_id, ri.quantity, ri.unit AS recipe_unit, p.name, p.unit AS product_unit, p.stock
                FROM recipe_items ri JOIN products p ON p.id=ri.ingredient_id WHERE ri.recipe_id=? ORDER BY p.name""", (row["id"],)).fetchall()
            result.append({"id": row["id"], "productId": row["product_id"], "productName": row["product_name"], "yieldQuantity": row["yield_quantity"], "instructions": row["instructions"], "ingredients": [{"ingredientId": i["ingredient_id"], "name": i["name"], "quantity": i["quantity"], "unit": i["recipe_unit"] or i["product_unit"], "productUnit": i["product_unit"], "stock": i["stock"]} for i in ingredients]})
        return result


@app.post("/api/recipes", status_code=201)
def save_recipe(payload: RecipePayload):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        product = conn.execute("SELECT id,name,product_type FROM products WHERE id=? AND business_id=? AND active=1", (payload.productId, current_business_id())).fetchone()
        if not product or product["product_type"] != "sale_item":
            conn.rollback()
            raise HTTPException(400, "Selecciona un producto activo que se pueda vender.")
        if len({i.ingredientId for i in payload.ingredients}) != len(payload.ingredients):
            conn.rollback()
            raise HTTPException(400, "No repitas el mismo ingrediente en una receta.")
        for item in payload.ingredients:
            ingredient = conn.execute("SELECT id,product_type FROM products WHERE id=? AND business_id=? AND active=1", (item.ingredientId, current_business_id())).fetchone()
            if not ingredient or ingredient["product_type"] != "ingredient":
                conn.rollback()
                raise HTTPException(400, f"El producto {item.ingredientId} no está configurado como ingrediente.")
        existing = conn.execute("SELECT id FROM recipes WHERE product_id=?", (payload.productId,)).fetchone()
        recipe_id = existing["id"] if existing else f"REC-{uuid.uuid4().hex[:10].upper()}"
        if existing:
            conn.execute("UPDATE recipes SET yield_quantity=?, instructions=? WHERE id=?", (payload.yieldQuantity, payload.instructions, recipe_id))
            conn.execute("DELETE FROM recipe_items WHERE recipe_id=?", (recipe_id,))
        else:
            conn.execute("INSERT INTO recipes (id,business_id,product_id,yield_quantity,instructions) VALUES (?,?,?,?,?)", (recipe_id, current_business_id(), payload.productId, payload.yieldQuantity, payload.instructions))
        conn.executemany("INSERT INTO recipe_items (recipe_id,ingredient_id,quantity,unit) VALUES (?,?,?,?)", [(recipe_id, i.ingredientId, i.quantity, i.unit) for i in payload.ingredients])
        audit(conn, "upsert", "recipe", recipe_id, {"productId": payload.productId, "ingredients": len(payload.ingredients)})
        conn.commit()
    return next(r for r in list_recipes() if r["id"] == recipe_id)


@app.delete("/api/recipes/{recipe_id}")
def delete_recipe(recipe_id: str):
    with connection() as conn:
        row = conn.execute("SELECT id FROM recipes WHERE id=? AND business_id=?", (recipe_id, current_business_id())).fetchone()
        if not row:
            raise HTTPException(404, "Receta no encontrada.")
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DELETE FROM recipe_items WHERE recipe_id=?", (recipe_id,))
        conn.execute("DELETE FROM recipes WHERE id=?", (recipe_id,))
        audit(conn, "delete", "recipe", recipe_id)
        conn.commit()
        return {"ok": True, "id": recipe_id}
