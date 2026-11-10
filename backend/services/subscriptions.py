from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

from backend.core.config import SUBSCRIPTION_PLANS
from backend.core.db import timestamp_iso


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
