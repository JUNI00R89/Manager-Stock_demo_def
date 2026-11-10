from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query

from backend.core.config import CURRENCY
from backend.core.context import current_business_id, current_identity
from backend.core.db import connection, timestamp_iso


router = APIRouter()


@router.get("/api/health")
def health():
    with connection() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok", "database": "sqlite", "currency": CURRENCY}


@router.get("/api/dashboard")
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


@router.get("/api/audit")
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
