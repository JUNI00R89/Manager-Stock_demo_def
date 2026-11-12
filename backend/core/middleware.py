from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone

from fastapi import Request
from fastapi.responses import JSONResponse

from backend.core.context import _current_identity
from backend.core.db import connection


def required_permission_for_request(path: str, method: str) -> str | None:
    if path.startswith("/api/tables"):
        return "orders.view" if method == "GET" else "orders.manage"
    if path == "/api/dashboard": return "dashboard.view"
    if path == "/api/product-categories": return "catalog.view" if method == "GET" else "catalog.create"
    if path == "/api/hotel/reports/income":
        return "reports.view"
    if path.startswith("/api/hotel/rooms") or path.startswith("/api/hotel/reservations") or path == "/api/hotel/products":
        return "hotel.view" if method == "GET" else "hotel.manage"
    if path.startswith("/api/services/catalog") or path.startswith("/api/services/professionals") or path.startswith("/api/services/appointments"):
        return "services.view" if method == "GET" else "services.manage"
    if path == "/api/products":
        return "catalog.view" if method == "GET" else "catalog.create"
    if path == "/api/products/import/template":
        return "catalog.view"
    if path.startswith("/api/products/import"):
        return "catalog.create"
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
    if identity["custom_role_id"] and not is_suspended and path not in {"/api/auth/me", "/api/auth/logout"} and not (path == "/api/business/config" and request.method == "GET"):
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
        elif path.startswith("/api/orders") or path.startswith("/api/tables"):
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
                    enabled = bool(features.get("pos")) or bool(path.startswith("/api/cash/") and business_row and business_row["business_type"] == "hotel" and (features.get("rooms") or features.get("reservations")))
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
        elif path in {"/api/products", "/api/business/config", "/api/tables"}:
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
