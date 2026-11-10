from __future__ import annotations

import asyncio
import json
import sqlite3
from datetime import datetime, timezone

from backend.core.db import connection, table_exists, table_has_column
from backend.services.catalog import canonical_business_type


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
    if old_type == "hotel" and (conn.execute("SELECT 1 FROM hotel_payments WHERE business_id=? LIMIT 1", (business_id,)).fetchone() or conn.execute("SELECT 1 FROM hotel_account_closures WHERE business_id=? LIMIT 1", (business_id,)).fetchone()):
        return deleted  # Paid stays and cash records must survive a business-type change.
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
