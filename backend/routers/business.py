from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from backend.core.config import DEFAULT_TAX_RATE
from backend.core.context import current_business_id, current_identity
from backend.core.db import audit, connection, timestamp_iso
from backend.core.security import hash_password
from backend.schemas import BusinessConfigPayload, CreateStaffPayload, CustomRolePayload, UpdateStaffPayload
from backend.services.business_types import process_due_type_transitions
from backend.services.catalog import canonical_business_type
from backend.services.subscriptions import subscription_for_business


router = APIRouter()


@router.get("/api/business/config")
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


@router.put("/api/business/config")
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


@router.get("/api/business/type-transitions")
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


@router.post("/api/business/type-transitions/{transition_id}/restore")
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


@router.get("/api/users")
def list_business_users():
    business_id = current_business_id()
    with connection() as conn:
        rows = conn.execute("""SELECT u.id,u.business_id,u.full_name,u.email,u.role,u.custom_role_id,u.active,u.created_at,
            cr.name AS custom_role_name FROM auth_users u LEFT JOIN custom_roles cr ON cr.id=u.custom_role_id
            WHERE u.business_id=? ORDER BY u.created_at""", (business_id,)).fetchall()
        return [{"id": r["id"], "businessId": r["business_id"], "name": r["full_name"], "email": r["email"], "role": r["role"],
            "customRoleId": r["custom_role_id"], "customRoleName": r["custom_role_name"],
            "active": bool(r["active"]), "createdAt": r["created_at"]} for r in rows]


@router.get("/api/custom-roles")
def list_custom_roles():
    identity = current_identity()
    if identity["role"] not in {"owner", "business_admin"}:
        raise HTTPException(403, "No tienes permiso para consultar los roles personalizados.")
    with connection() as conn:
        rows = conn.execute("SELECT id,name,permissions_json,created_at FROM custom_roles WHERE business_id=? ORDER BY name", (current_business_id(),)).fetchall()
        return [{"id": r["id"], "name": r["name"], "permissions": json.loads(r["permissions_json"] or "[]"), "createdAt": r["created_at"]} for r in rows]


def require_role_owner() -> dict:
    identity = current_identity()
    if identity["role"] != "owner" or identity.get("custom_role_id"):
        raise HTTPException(403, "Solo el propietario puede administrar roles personalizados.")
    return identity


def custom_role_out(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "name": row["name"], "permissions": json.loads(row["permissions_json"]), "createdAt": row["created_at"]}


def expand_role_permissions(requested: list[str]) -> list[str]:
    # Every custom role must be able to land on a safe dashboard after login.
    # Add only the read/operational prerequisites required for granted actions to work.
    permission_set = set(requested)
    permission_set.add("dashboard.view")
    dependencies = {
        "customers.manage": {"customers.view"},
        "billing.manage": {"billing.view", "customers.view"},
        "catalog.create": {"catalog.view"},
        "catalog.edit": {"catalog.view"},
        "inventory.edit": {"inventory.view"},
        "inventory.entry": {"inventory.view", "catalog.view"},
        "inventory.adjust": {"inventory.view", "catalog.view", "inventory.count"},
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
    return ["dashboard.view", *sorted(permission_set - {"dashboard.view"})]


@router.post("/api/custom-roles", status_code=201)
def create_custom_role(payload: CustomRolePayload):
    identity = require_role_owner()
    role_id = f"ROLE-{uuid.uuid4().hex[:12].upper()}"
    permissions = expand_role_permissions(payload.permissions)
    with connection() as conn:
        try:
            conn.execute("INSERT INTO custom_roles (id,business_id,name,permissions_json,created_by) VALUES (?,?,?,?,?)",
                (role_id, current_business_id(), payload.name, json.dumps(permissions), identity["id"]))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "Ya existe un rol con ese nombre en este negocio.") from exc
        audit(conn, "create", "custom_role", role_id, {"name": payload.name, "permissions": permissions})
        return custom_role_out(conn.execute("SELECT id,name,permissions_json,created_at FROM custom_roles WHERE id=?", (role_id,)).fetchone())


@router.put("/api/custom-roles/{role_id}")
def update_custom_role(role_id: str, payload: CustomRolePayload):
    require_role_owner()
    permissions = expand_role_permissions(payload.permissions)
    with connection() as conn:
        try:
            cursor = conn.execute("UPDATE custom_roles SET name=?,permissions_json=? WHERE id=? AND business_id=?",
                                  (payload.name, json.dumps(permissions), role_id, current_business_id()))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "Ya existe un rol con ese nombre en este negocio.") from exc
        if cursor.rowcount == 0:
            raise HTTPException(404, "Rol no encontrado.")
        # The middleware reads role permissions on every request, so holders get the change immediately.
        audit(conn, "update", "custom_role", role_id, {"name": payload.name, "permissions": permissions})
        return custom_role_out(conn.execute("SELECT id,name,permissions_json,created_at FROM custom_roles WHERE id=?", (role_id,)).fetchone())


@router.delete("/api/custom-roles/{role_id}", status_code=204)
def delete_custom_role(role_id: str):
    require_role_owner()
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if not conn.execute("SELECT 1 FROM custom_roles WHERE id=? AND business_id=?", (role_id, current_business_id())).fetchone():
            conn.rollback(); raise HTTPException(404, "Rol no encontrado.")
        holders = conn.execute("SELECT count(*) FROM auth_users WHERE custom_role_id=?", (role_id,)).fetchone()[0]
        if holders:
            conn.rollback(); raise HTTPException(409, f"Reasigna primero {holders} usuario(s) que tienen este rol.")
        conn.execute("DELETE FROM custom_roles WHERE id=? AND business_id=?", (role_id, current_business_id()))
        audit(conn, "delete", "custom_role", role_id, {})
        conn.commit()


@router.post("/api/users", status_code=201)
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
    try:
        password_hash = hash_password(payload.password)  # slow on purpose: done before taking the write lock
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    user_id = f"USR-{uuid.uuid4().hex[:12].upper()}"
    with connection() as conn:
        # Count and insert under one write lock, so two simultaneous sign-ups cannot exceed the plan.
        conn.execute("BEGIN IMMEDIATE")
        plan_limits = subscription_for_business(conn, business_id)["plan"]
        user_count = conn.execute("SELECT count(*) FROM auth_users WHERE business_id=?", (business_id,)).fetchone()[0]
        if user_count >= plan_limits["maxUsers"]:
            conn.rollback()
            raise HTTPException(409, f"El plan {plan_limits['name']} permite hasta {plan_limits['maxUsers']} usuarios en total. Cambia de plan para añadir más.")
        try:
            conn.execute("INSERT INTO auth_users (id,business_id,full_name,email,password_hash,role,custom_role_id) VALUES (?,?,?,?,?,?,?)", (user_id, business_id, payload.name.strip(), email, password_hash, payload.role, payload.customRoleId))
        except sqlite3.IntegrityError as exc:
            conn.rollback()
            raise HTTPException(409, "Ya existe una cuenta con ese correo.") from exc
        audit(conn, "create", "user", user_id, {"role": payload.role, "email": email})
        conn.commit()
        row = conn.execute("""SELECT u.id,u.business_id,u.full_name,u.email,u.role,u.custom_role_id,u.active,u.created_at,cr.name custom_role_name
            FROM auth_users u LEFT JOIN custom_roles cr ON cr.id=u.custom_role_id WHERE u.id=?""", (user_id,)).fetchone()
        return {"id": row["id"], "businessId": row["business_id"], "name": row["full_name"], "email": row["email"], "role": row["role"], "customRoleId": row["custom_role_id"], "customRoleName": row["custom_role_name"], "active": bool(row["active"]), "createdAt": row["created_at"]}


@router.patch("/api/users/{user_id}")
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
