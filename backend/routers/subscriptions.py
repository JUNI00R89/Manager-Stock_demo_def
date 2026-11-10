from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.core.config import SUBSCRIPTION_PLANS
from backend.core.context import current_business_id, current_identity
from backend.core.db import audit, connection
from backend.services.subscriptions import subscription_for_business


router = APIRouter()


@router.get("/api/subscription/plans")
def list_subscription_plans():
    return list(SUBSCRIPTION_PLANS.values())


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
    action: Literal["confirm_payment", "cancel_request"]
    paymentReference: str | None = Field(default=None, min_length=4, max_length=120)


@router.get("/api/platform/subscriptions")
def platform_subscriptions():
    with connection() as conn:
        businesses = conn.execute("SELECT id,name FROM businesses ORDER BY name COLLATE NOCASE").fetchall()
        output = []
        for business in businesses:
            subscription = subscription_for_business(conn, business["id"])
            output.append({**subscription, "businessName": business["name"]})
        return output


@router.patch("/api/platform/subscriptions/{business_id}")
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
