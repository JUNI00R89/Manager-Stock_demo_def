from __future__ import annotations

import sqlite3
import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from backend.core.config import SUBSCRIPTION_PLANS
from backend.core.db import timestamp_iso

# Días que suma cada cobro mensual verificado.
BILLING_PERIOD_DAYS = 30
# Estados en los que el plan pagado sigue vigente. Durante una renovación pendiente
# ("pending_payment" con un plan pagado) el negocio conserva su plan hasta que vence.
PLAN_IN_FORCE_STATES = ("active", "pending_payment")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_expiry(value: str | None) -> datetime | None:
    """Fecha de vencimiento en UTC; None si falta o es inválida."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def subscription_for_business(conn: sqlite3.Connection, business_id: str) -> dict:
    row = conn.execute("SELECT * FROM business_subscriptions WHERE business_id=?", (business_id,)).fetchone()
    if not row:
        conn.execute("INSERT OR IGNORE INTO business_subscriptions (business_id,plan_id,status) VALUES (?, 'free', 'active')", (business_id,))
        row = conn.execute("SELECT * FROM business_subscriptions WHERE business_id=?", (business_id,)).fetchone()
    if row["status"] in PLAN_IN_FORCE_STATES and row["expires_at"]:
        expires = _parse_expiry(row["expires_at"])
        # Fechas inválidas heredadas fallan cerradas al plan gratuito.
        if expires is None or expires <= _now():
            now = _now().isoformat(timespec="seconds")
            if row["status"] == "pending_payment":
                # Venció con una renovación pendiente: pasa a Gratis pero la solicitud sigue viva.
                conn.execute("UPDATE business_subscriptions SET plan_id='free',expires_at=NULL,updated_at=? WHERE business_id=?", (now, business_id))
            else:
                conn.execute("UPDATE business_subscriptions SET plan_id='free',status='expired',pending_plan_id=NULL,updated_at=? WHERE business_id=?", (now, business_id))
            row = conn.execute("SELECT * FROM business_subscriptions WHERE business_id=?", (business_id,)).fetchone()
    effective_plan_id = row["plan_id"] if row["status"] in PLAN_IN_FORCE_STATES else "free"
    plan = SUBSCRIPTION_PLANS.get(effective_plan_id, SUBSCRIPTION_PLANS["free"])
    pending = SUBSCRIPTION_PLANS.get(row["pending_plan_id"]) if row["pending_plan_id"] else None
    return {"businessId": business_id, "plan": plan, "status": row["status"], "pendingPlan": pending, "startedAt": timestamp_iso(row["started_at"]), "expiresAt": timestamp_iso(row["expires_at"]) if row["expires_at"] else None, "updatedAt": timestamp_iso(row["updated_at"])}


def last_payment(conn: sqlite3.Connection, business_id: str) -> dict | None:
    row = conn.execute(
        "SELECT plan_id,amount_cop,payment_reference,period_start,period_end,created_at FROM subscription_payments WHERE business_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1",
        (business_id,),
    ).fetchone()
    if not row:
        return None
    return {"planId": row["plan_id"], "amountCOP": row["amount_cop"], "paymentReference": row["payment_reference"],
            "periodStart": timestamp_iso(row["period_start"]), "periodEnd": timestamp_iso(row["period_end"]), "createdAt": timestamp_iso(row["created_at"])}


def apply_verified_payment(conn: sqlite3.Connection, business_id: str, plan_id: str, payment_reference: str, recorded_by: str | None) -> dict:
    """Registra un cobro verificado y extiende la vigencia. Debe llamarse dentro de una transacción.

    Si el negocio ya tiene ese mismo plan vigente, el nuevo periodo empieza cuando vence
    el actual (pagar antes de tiempo no hace perder días). Si es otro plan o no hay
    vigencia, empieza ahora.
    """
    plan = SUBSCRIPTION_PLANS.get(plan_id)
    if not plan or plan["priceCOP"] <= 0:
        raise HTTPException(422, "Solo se pueden registrar pagos de planes de pago.")
    # Case, spaces and dashes are typing noise: "mp 0202" is the same payment as "MP-0202".
    reference = payment_reference.strip()
    reference_key = re.sub(r"[\s-]+", "", reference).upper()
    if len(reference_key) < 4:
        raise HTTPException(422, "Registra una referencia de pago verificada antes de activar el plan.")
    if conn.execute("SELECT 1 FROM subscription_payments WHERE upper(replace(replace(payment_reference,' ',''),'-',''))=?", (reference_key,)).fetchone():
        raise HTTPException(409, "Esa referencia de pago ya se registró. Cada cobro solo puede sumar un periodo.")

    subscription_for_business(conn, business_id)  # normaliza vencimientos antes de calcular
    row = conn.execute("SELECT * FROM business_subscriptions WHERE business_id=?", (business_id,)).fetchone()
    now = _now()
    current_expiry = _parse_expiry(row["expires_at"])
    same_plan_in_force = (row["plan_id"] == plan_id and row["status"] in PLAN_IN_FORCE_STATES
                          and current_expiry is not None and current_expiry > now)
    period_start = current_expiry if same_plan_in_force else now
    period_end = period_start + timedelta(days=BILLING_PERIOD_DAYS)
    started_at = row["started_at"] if same_plan_in_force else now.isoformat(timespec="seconds")

    conn.execute(
        "INSERT INTO subscription_payments (id,business_id,plan_id,amount_cop,payment_reference,period_start,period_end,recorded_by) VALUES (?,?,?,?,?,?,?,?)",
        (f"SPAY-{uuid.uuid4().hex[:12].upper()}", business_id, plan_id, plan["priceCOP"], reference,
         period_start.isoformat(timespec="seconds"), period_end.isoformat(timespec="seconds"), recorded_by),
    )
    conn.execute(
        "UPDATE business_subscriptions SET plan_id=?,status='active',pending_plan_id=NULL,started_at=?,expires_at=?,updated_at=? WHERE business_id=?",
        (plan_id, started_at, period_end.isoformat(timespec="seconds"), now.isoformat(timespec="seconds"), business_id),
    )
    return {"planId": plan_id, "paymentReference": reference, "periodStart": period_start.isoformat(timespec="seconds"),
            "periodEnd": period_end.isoformat(timespec="seconds"), "extendedFromPreviousExpiry": same_plan_in_force}
