"""Autenticación y autorización de cada petición a /api.

Orden de las comprobaciones (cada una puede responder 401/403 y cortar):
  1. Rutas públicas y OPTIONS pasan sin sesión.
  2. Sesión Bearer válida, no vencida y de una cuenta activa.
  3. Negocio suspendido: solo el propietario y solo las rutas de soporte.
  4. Rol personalizado: lista explícita de permisos (lo no mapeado se niega).
  5. Módulo del negocio habilitado (no basta con ocultar la ruta en React).
  6. Restricciones por rol base (superadmin, cajero, administrador).

Toda la información se obtiene con una sola consulta por petición.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone

from fastapi import Request
from fastapi.responses import JSONResponse

from backend.core.context import _current_identity
from backend.core.db import connection

PUBLIC_PATHS = {"/api/health", "/api/auth/login", "/api/auth/register", "/api/subscription/plans"}
SESSION_PATHS = {"/api/auth/me", "/api/auth/logout"}
SUSPENSION_ALLOWED_PATHS = SESSION_PATHS | {"/api/suspension/status", "/api/support/messages", "/api/support/case"}

# --- Permisos requeridos por ruta -------------------------------------------
# (patrón, permiso para GET, permiso para el resto de métodos). Gana la primera
# coincidencia. Un patrón que termina en "*" es un prefijo; si no, ruta exacta.
# Una ruta /api que no aparezca aquí no la puede usar ningún rol personalizado.
ROUTE_PERMISSIONS: tuple[tuple[str, str, str], ...] = (
    ("/api/tables*", "orders.view", "orders.manage"),
    ("/api/dashboard", "dashboard.view", "dashboard.view"),
    ("/api/product-categories", "catalog.view", "catalog.create"),
    ("/api/hotel/reports/income", "reports.view", "reports.view"),
    ("/api/hotel/rooms*", "hotel.view", "hotel.manage"),
    ("/api/hotel/reservations*", "hotel.view", "hotel.manage"),
    ("/api/hotel/products", "hotel.view", "hotel.manage"),
    ("/api/services/catalog*", "services.view", "services.manage"),
    ("/api/services/professionals*", "services.view", "services.manage"),
    ("/api/services/appointments*", "services.view", "services.manage"),
    ("/api/products", "catalog.view", "catalog.create"),
    ("/api/products/import/template", "catalog.view", "catalog.view"),
    ("/api/products/import*", "catalog.create", "catalog.create"),
    ("/api/products/*", "catalog.view", "catalog.edit"),
    ("/api/suppliers", "suppliers.view", "suppliers.manage"),
    ("/api/suppliers/*", "suppliers.view", "suppliers.manage"),
    ("/api/recipes", "catalog.view", "catalog.edit"),
    ("/api/recipes/*", "catalog.view", "catalog.edit"),
    ("/api/sales", "sales.view", "sales.create"),
    ("/api/sales/*", "sales.view", "sales.view"),  # anular venta (/cancel): ver required_permission_for_request
    ("/api/cash/*", "cash.view", "cash.manage"),
    ("/api/orders", "orders.view", "orders.manage"),
    ("/api/orders/*", "orders.manage", "orders.manage"),
    ("/api/reports*", "reports.view", "reports.view"),
    ("/api/audit", "activity.view", "activity.view"),
)


def _matches(pattern: str, path: str) -> bool:
    return path.startswith(pattern[:-1]) if pattern.endswith("*") else path == pattern


def _inventory_permission(path: str, method: str) -> str:
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
    if path == "/api/inventory/settings" or path.startswith("/api/inventory/locations"):
        return "inventory.edit"
    return "inventory.entry"


def required_permission_for_request(path: str, method: str) -> str | None:
    # Casos que no encajan en la tabla; ninguna entrada de ROUTE_PERMISSIONS los cubre antes.
    if path.startswith('/api/customers'):
        return 'customers.view' if method == 'GET' else 'customers.manage'
    if path.startswith('/api/billing'):
        return 'billing.view' if method == 'GET' else 'billing.manage'
    if path.startswith('/api/inventory/count-reviews') or path == '/api/inventory/count-products':
        return 'inventory.adjust' if path.endswith(('/approve', '/cancel')) else 'inventory.count'
    if path.startswith('/api/sales/') and '/returns' in path:
        return 'sales.cancel'
    if path.startswith("/api/inventory/"):
        return _inventory_permission(path, method)
    if path.startswith("/api/sales/") and path.endswith("/cancel"):
        return "sales.cancel"
    for pattern, read_permission, write_permission in ROUTE_PERMISSIONS:
        if _matches(pattern, path):
            return read_permission if method == "GET" else write_permission
    return None


# --- Módulos del negocio ----------------------------------------------------
def _module_for_request(path: str, method: str) -> str | None:
    if path.startswith("/api/products") or path.startswith("/api/product-categories") or path.startswith("/api/recipes"):
        return "catalog_read" if method == "GET" else "catalog_write"
    if path.startswith("/api/hotel/"):
        return "hotel"
    if path.startswith("/api/services/"):
        return "services"
    if path.startswith("/api/suppliers") or path.startswith("/api/inventory/"):
        return "inventory"
    if path.startswith("/api/sales") or path.startswith("/api/cash/"):
        return "pos"
    if path.startswith("/api/orders") or path.startswith("/api/tables"):
        return "orders"
    return None


def _module_enabled(module: str, path: str, business_exists: bool, business_type: str | None, settings_json: str | None) -> bool:
    if not business_exists:
        settings = {}
    else:
        try:
            settings = json.loads(settings_json or "{}")
        except (json.JSONDecodeError, TypeError):
            return False
    if not isinstance(settings, dict):
        settings = {}
    features = settings.get("features", {})
    if not isinstance(features, dict):
        features = {}  # ajustes corruptos: el módulo queda deshabilitado en lugar de producir un 500
    food_config = settings.get("foodConfig")
    food_modules = food_config.get("activeModules", []) if isinstance(food_config, dict) else []
    has_food_menu = business_type == "food" and "menu" in food_modules

    if module == "catalog_read":
        return bool(features.get("inventory") or features.get("pos") or has_food_menu)
    if module == "catalog_write":
        return bool(features.get("inventory") or has_food_menu)
    if module == "hotel":
        return business_type == "hotel" and bool(features.get("rooms") or features.get("reservations"))
    if module == "services":
        return business_type == "services" and bool(features.get("services") or features.get("reservations"))
    if module == "inventory":
        return bool(features.get("inventory"))
    if module == "pos":
        hotel_cash = path.startswith("/api/cash/") and business_type == "hotel" and bool(features.get("rooms") or features.get("reservations"))
        return bool(features.get("pos")) or hotel_cash or (path.startswith("/api/cash/") and business_type == "services" and bool(features.get("services") or features.get("reservations")))
    # orders
    return business_type == "food" and "pedidos" in food_modules


# --- Rol base ---------------------------------------------------------------
def _cashier_allowed(path: str, method: str) -> bool:
    if path.startswith("/api/customers"):
        return method in {"GET", "POST", "PUT"}
    if path in SESSION_PATHS:
        return True
    if path in {"/api/products", "/api/business/config", "/api/tables", "/api/dashboard"}:
        return method == "GET"
    if path == "/api/sales":
        return method in {"GET", "POST"}
    if path.startswith("/api/sales/by-key/") or (path.startswith("/api/sales/") and not path.endswith("/cancel")):
        return method == "GET"
    if path in {"/api/orders", "/api/cash/sessions", "/api/cash/sessions/current"} or path.startswith("/api/cash/sessions/"):
        return method in {"GET", "POST"}
    if path.startswith("/api/orders/"):
        return method == "PATCH"
    return False


def _role_denial(role: str, has_custom_role: bool, path: str, method: str) -> str | None:
    """Mensaje de rechazo por rol base, o None si el rol permite la petición."""
    if role == "superadmin":
        if not (path.startswith("/api/platform/") or path in SESSION_PATHS):
            return "El SUPERADMIN debe utilizar los módulos de administración global."
        return None
    if path.startswith("/api/platform/"):
        return "Solo el SUPERADMIN puede administrar la plataforma."
    if role == "cashier" and not has_custom_role:
        return None if _cashier_allowed(path, method) else "Tu rol de cajero no permite esta operación."
    if role == "business_admin":
        if path == "/api/business/config" and method in {"PUT", "PATCH"}:
            return "Solo el propietario puede cambiar la configuración del negocio."
        if path == "/api/subscription":
            return "Esta acción está reservada al propietario o al SUPERADMIN."
    return None


def _forbidden(detail: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=403, content={"detail": detail, **extra})


SESSION_QUERY = """SELECT u.id,u.business_id,u.email,u.full_name,u.role,u.custom_role_id,u.active,
    u.created_at,b.id AS business_row_id,b.active AS business_active,b.business_type,b.settings_json,
    b.suspension_reason,b.suspension_description,b.suspended_at,s.token_hash,
    cr.id AS custom_role_row_id,cr.permissions_json AS custom_permissions_json
    FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id
    LEFT JOIN businesses b ON b.id=u.business_id
    LEFT JOIN custom_roles cr ON cr.id=u.custom_role_id AND cr.business_id=u.business_id
    WHERE s.token_hash=? AND s.expires_at>?"""


def _custom_permissions(row: sqlite3.Row) -> set[str]:
    if row["custom_role_row_id"] is None:
        return set()
    try:
        permissions = set(json.loads(row["custom_permissions_json"] or "[]"))
        if "inventory.adjust" in permissions: permissions.add("inventory.count")
        return permissions
    except (json.JSONDecodeError, TypeError):
        return set()


async def authenticate_and_authorize(request: Request, call_next):
    path = request.url.path
    method = request.method
    if not path.startswith("/api/") or method == "OPTIONS" or path in PUBLIC_PATHS:
        return await call_next(request)

    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        return JSONResponse(status_code=401, content={"detail": "Sesión no válida. Inicia sesión nuevamente."})
    token_hash = hashlib.sha256(auth_header[7:].strip().encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    try:
        with connection() as conn:
            row = conn.execute(SESSION_QUERY, (token_hash, now)).fetchone()
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
    has_custom_role = bool(identity["custom_role_id"])

    is_suspended = bool(row["business_id"] and row["business_active"] == 0)
    if is_suspended and (role != "owner" or path not in SUSPENSION_ALLOWED_PATHS):
        return _forbidden(
            "El negocio está suspendido. Puedes consultar el motivo y comunicarte con soporte desde la pantalla de suspensión.",
            code="BUSINESS_SUSPENDED",
        )

    # Un rol personalizado solo puede usar lo que su lista de permisos autoriza explícitamente.
    custom_role_exempt = path in SESSION_PATHS or (path == "/api/business/config" and method == "GET")
    if has_custom_role and not is_suspended and not custom_role_exempt:
        required = required_permission_for_request(path, method)
        if not required or required not in _custom_permissions(row):
            return _forbidden("Tu rol personalizado no tiene permiso para esta operación.")

    # Los módulos desactivados también se bloquean en la API, no solo en el menú.
    if role != "superadmin":
        module = _module_for_request(path, method)
        if module and not _module_enabled(module, path, row["business_row_id"] is not None, row["business_type"], row["settings_json"]):
            return _forbidden("Este módulo no está habilitado en la configuración de tu negocio.")

    denial = _role_denial(role, has_custom_role, path, method)
    if denial:
        return _forbidden(denial)

    marker = _current_identity.set(identity)
    try:
        return await call_next(request)
    finally:
        _current_identity.reset(marker)
