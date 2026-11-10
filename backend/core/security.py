from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone

from backend.core.context import current_identity
from backend.core.db import connection, timestamp_iso


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


def issue_session(conn: sqlite3.Connection, user_id: str) -> str:
    token = secrets.token_urlsafe(36)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    expires = (datetime.now(timezone.utc) + timedelta(hours=12)).isoformat(timespec="seconds")
    conn.execute("INSERT INTO auth_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)", (token_hash, user_id, expires))
    return token
