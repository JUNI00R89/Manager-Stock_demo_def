from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Literal
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.core.config import SUBSCRIPTION_PAYMENT_LINKS, SUBSCRIPTION_PLANS
from backend.core.context import current_business_id, current_identity
from backend.core.db import audit, connection
from backend.services.subscriptions import PLAN_IN_FORCE_STATES, apply_verified_payment, last_payment, subscription_for_business


router = APIRouter()


def payment_url(plan_id: str) -> str | None:
    """Link de pago configurado para el plan, solo si es un https:// bien formado."""
    raw = (SUBSCRIPTION_PAYMENT_LINKS.get(plan_id) or "").strip()
    parsed = urlparse(raw)
    if parsed.scheme != "https" or not parsed.netloc or any(ch.isspace() for ch in raw):
        return None
    return raw


@router.get("/api/subscription/plans")
def list_subscription_plans():
    return [{**plan, "paymentUrl": payment_url(plan["id"])} for plan in SUBSCRIPTION_PLANS.values()]


@router.get("/api/subscription")
def get_business_subscription():
    identity = current_identity()
    if identity["role"] != "owner":
        raise HTTPException(403, "Solo el propietario puede consultar la suscripción del negocio.")
    with connection() as conn:
        return subscription_for_business(conn, current_business_id())


class SubscriptionSelectionPayload(BaseModel):
    planId: Literal["free", "entrepreneur", "business", "enterprise"]


@router.put("/api/subscription")
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
    # confirm_payment: activa la solicitud pendiente del propietario.
    # renew: registra el cobro de un periodo (p. ej. el cobro mensual automático del
    #        proveedor) sin que el propietario tenga que pedirlo de nuevo.
    # cancel_request: descarta la solicitud pendiente sin tocar el plan vigente.
    action: Literal["confirm_payment", "renew", "cancel_request"]
    paymentReference: str | None = Field(default=None, min_length=4, max_length=120)
    planId: Literal["entrepreneur", "business", "enterprise"] | None = None


@router.get("/api/platform/subscriptions")
def platform_subscriptions():
    with connection() as conn:
        businesses = conn.execute("SELECT id,name FROM businesses ORDER BY name COLLATE NOCASE").fetchall()
        output = []
        for business in businesses:
            subscription = subscription_for_business(conn, business["id"])
            output.append({**subscription, "businessName": business["name"], "lastPayment": last_payment(conn, business["id"])})
        return output


def _plan_to_renew(conn, business_id: str, row, requested: str | None) -> str:
    if requested:
        return requested
    if row["plan_id"] in SUBSCRIPTION_PLANS and SUBSCRIPTION_PLANS[row["plan_id"]]["priceCOP"] > 0 and row["status"] in PLAN_IN_FORCE_STATES:
        return row["plan_id"]
    previous = last_payment(conn, business_id)
    if previous:
        return previous["planId"]  # p. ej. el plan venció porque el pago del mes se registró tarde
    raise HTTPException(422, "Indica el plan pagado: el negocio no tiene un plan de pago vigente ni pagos anteriores.")


@router.patch("/api/platform/subscriptions/{business_id}")
def platform_update_subscription(business_id: str, payload: PlatformSubscriptionActionPayload):
    identity = current_identity()
    if identity["role"] != "superadmin":
        raise HTTPException(403, "Solo SUPERADMIN puede gestionar solicitudes de suscripción.")
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            if not conn.execute("SELECT 1 FROM businesses WHERE id=?", (business_id,)).fetchone():
                raise HTTPException(404, "Negocio no encontrado.")
            subscription_for_business(conn, business_id)  # crea el registro y normaliza vencimientos
            row = conn.execute("SELECT * FROM business_subscriptions WHERE business_id=?", (business_id,)).fetchone()
            if payload.action == "confirm_payment":
                if row["status"] != "pending_payment" or not row["pending_plan_id"]:
                    raise HTTPException(409, "No existe una solicitud de pago pendiente para este negocio.")
                result = apply_verified_payment(conn, business_id, row["pending_plan_id"], payload.paymentReference or "", identity["id"])
                action = "subscription_payment_manually_verified"
                details = {**result, "verificationMode": "manual_by_superadmin"}
            elif payload.action == "renew":
                if row["status"] == "pending_payment" and row["pending_plan_id"]:
                    raise HTTPException(409, "Hay una solicitud de cambio de plan pendiente: confírmala o cancélala antes de renovar.")
                plan_id = _plan_to_renew(conn, business_id, row, payload.planId)
                result = apply_verified_payment(conn, business_id, plan_id, payload.paymentReference or "", identity["id"])
                action = "subscription_renewed"
                details = {**result, "verificationMode": "manual_by_superadmin"}
            else:
                if row["status"] != "pending_payment":
                    raise HTTPException(409, "No existe una solicitud de pago pendiente para este negocio.")
                conn.execute("UPDATE business_subscriptions SET status='active',pending_plan_id=NULL,updated_at=? WHERE business_id=?", (now, business_id))
                action = "subscription_request_cancelled"
                details = {"cancelledPlanId": row["pending_plan_id"]}
            conn.execute("INSERT INTO platform_audit (actor_id,action,entity_id,details) VALUES (?,?,?,?)", (identity["id"], action, business_id, json.dumps(details, ensure_ascii=False)))
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        return subscription_for_business(conn, business_id)
