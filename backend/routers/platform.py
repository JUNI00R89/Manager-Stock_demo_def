from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from backend.core.context import current_identity
from backend.core.db import connection, timestamp_iso
from backend.core.security import hash_password
from backend.schemas import PlatformCreateUserPayload, SupportMessagePayload, SupportStatusPayload
from backend.services.subscriptions import subscription_for_business
from backend.services.support import support_case_out, support_messages_out


router = APIRouter()


@router.get("/api/platform/stats")
def platform_stats():
    with connection() as conn:
        businesses = conn.execute("SELECT COUNT(*) total, SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) active FROM businesses").fetchone()
        users = conn.execute("SELECT COUNT(*) total, SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) active FROM auth_users").fetchone()
        sales = conn.execute("SELECT COUNT(*) total, COALESCE(SUM(total),0) total_amount FROM sales WHERE status='completed'").fetchone()
        return {"businesses": int(businesses["total"] or 0), "activeBusinesses": int(businesses["active"] or 0), "users": int(users["total"] or 0), "activeUsers": int(users["active"] or 0), "completedSales": int(sales["total"] or 0), "salesVolumeCOP": float(sales["total_amount"] or 0)}


@router.get("/api/platform/businesses")
def platform_businesses():
    with connection() as conn:
        rows = conn.execute("""SELECT b.id,b.name,b.business_type,b.currency,b.active,b.created_at,b.suspension_reason,b.suspension_description,b.suspended_at,COUNT(DISTINCT u.id) users
            FROM businesses b LEFT JOIN auth_users u ON u.business_id=b.id GROUP BY b.id ORDER BY b.created_at DESC""").fetchall()
        return [{"id": r["id"], "name": r["name"], "type": r["business_type"], "currency": r["currency"], "active": bool(r["active"]), "createdAt": r["created_at"], "users": r["users"], "suspensionReason": r["suspension_reason"] or "", "suspensionDescription": r["suspension_description"] or "", "suspendedAt": timestamp_iso(r["suspended_at"])} for r in rows]


@router.patch("/api/platform/businesses/{business_id}/status")
def platform_business_status(business_id: str, active: bool = Query(...), reason: str = Query(default="", max_length=160), description: str = Query(default="", max_length=2000)):
    if not active and len(reason.strip()) < 4:
        raise HTTPException(422, "Es obligatorio indicar un motivo de suspensión (mínimo 4 caracteres).")
    case_id = None
    with connection() as conn:
        cur = conn.execute("UPDATE businesses SET active=?,suspension_reason=?,suspension_description=?,suspended_at=? WHERE id=?",
            (1 if active else 0, "" if active else reason.strip(), "" if active else description.strip(), None if active else datetime.now(timezone.utc).isoformat(timespec="seconds"), business_id))
        if not cur.rowcount:
            raise HTTPException(404, "Negocio no encontrado.")
        if not active:
            existing = conn.execute("SELECT id FROM support_cases WHERE business_id=? AND status NOT IN ('resolved','closed') ORDER BY created_at DESC LIMIT 1", (business_id,)).fetchone()
            if existing:
                case_id = existing["id"]
                conn.execute("UPDATE support_cases SET reason=?,description=?,status='open',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", (reason.strip(), description.strip(), current_identity()["id"], case_id))
            else:
                case_id = f"CASE-{uuid.uuid4().hex[:12].upper()}"
                conn.execute("INSERT INTO support_cases (id,business_id,reason,description,status,created_by,updated_by) VALUES (?,?,?,?, 'open',?,?)",
                    (case_id, business_id, reason.strip(), description.strip(), current_identity()["id"], current_identity()["id"]))
        else:
            conn.execute("UPDATE support_cases SET status='resolved',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE business_id=? AND status NOT IN ('resolved','closed')", (current_identity()["id"], business_id))
        audit_row = f"business:{business_id}"
        # Platform activity has no tenant id; keep it in a dedicated global event table.
        conn.execute("INSERT INTO platform_audit (actor_id,action,entity_id,details) VALUES (?,?,?,?)", (current_identity()["id"], "activate" if active else "suspend", audit_row, json.dumps({"active": active, "reason": reason.strip() if not active else "", "caseId": case_id})))
        return {"id": business_id, "active": active, "caseId": case_id}


@router.get("/api/platform/support/cases")
def platform_support_cases():
    with connection() as conn:
        rows = conn.execute("""SELECT c.*,b.name business_name FROM support_cases c JOIN businesses b ON b.id=c.business_id
            ORDER BY CASE WHEN c.status IN ('open','in_review','awaiting_business') THEN 0 ELSE 1 END,c.updated_at DESC LIMIT 200""").fetchall()
        return [support_case_out(conn, row) for row in rows]


@router.get("/api/platform/support/cases/{case_id}/messages")
def platform_support_case_messages(case_id: str):
    with connection() as conn:
        case = conn.execute("SELECT id FROM support_cases WHERE id=?", (case_id,)).fetchone()
        if not case: raise HTTPException(404, "Caso de soporte no encontrado.")
        return support_messages_out(conn, case_id, current_identity()["id"])


@router.post("/api/platform/support/cases/{case_id}/messages", status_code=201)
def platform_send_support_message(case_id: str, payload: SupportMessagePayload):
    identity = current_identity()
    with connection() as conn:
        case = conn.execute("SELECT id,business_id,status FROM support_cases WHERE id=?", (case_id,)).fetchone()
        if not case: raise HTTPException(404, "Caso de soporte no encontrado.")
        conn.execute("INSERT INTO support_messages (case_id,business_id,sender_id,sender_role,message) VALUES (?,?,?,?,?)", (case_id, case["business_id"], identity["id"], "superadmin", payload.message))
        conn.execute("UPDATE support_cases SET status='awaiting_business',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", (identity["id"], case_id))
        conn.execute("INSERT INTO platform_audit (actor_id,action,entity_id,details) VALUES (?,?,?,?)", (identity["id"], "support_reply", case_id, json.dumps({"businessId": case["business_id"]})))
        return support_messages_out(conn, case_id)[-1]


@router.patch("/api/platform/support/cases/{case_id}")
def platform_update_support_case(case_id: str, payload: SupportStatusPayload):
    identity = current_identity()
    with connection() as conn:
        case = conn.execute("SELECT id,business_id FROM support_cases WHERE id=?", (case_id,)).fetchone()
        if not case: raise HTTPException(404, "Caso de soporte no encontrado.")
        conn.execute("UPDATE support_cases SET status=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", (payload.status, identity["id"], case_id))
        if payload.status == "resolved":
            conn.execute("UPDATE businesses SET active=1,suspension_reason='',suspension_description='',suspended_at=NULL WHERE id=?", (case["business_id"],))
        conn.execute("INSERT INTO platform_audit (actor_id,action,entity_id,details) VALUES (?,?,?,?)", (identity["id"], "support_case_status", case_id, json.dumps({"status": payload.status})))
        return {"id": case_id, "status": payload.status}


@router.get("/api/platform/audit")
def platform_audit(limit: int = Query(default=50, ge=1, le=200), offset: int = Query(default=0, ge=0)):
    with connection() as conn:
        rows = conn.execute("""SELECT a.id,a.actor_id,a.action,a.entity_id,a.details,a.created_at,u.full_name AS actor_name
            FROM platform_audit a JOIN auth_users u ON u.id=a.actor_id
            ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?""", (limit, offset)).fetchall()
        output = []
        for row in rows:
            try:
                details = json.loads(row["details"] or "{}")
            except json.JSONDecodeError:
                details = {"raw": row["details"]}
            output.append({"id": row["id"], "actorId": row["actor_id"], "actorName": row["actor_name"],
                "action": row["action"], "entityId": row["entity_id"], "details": details,
                "createdAt": timestamp_iso(row["created_at"])})
        return output


@router.get("/api/platform/users")
def platform_users(search: str = Query(default="", max_length=160)):
    with connection() as conn:
        query = """SELECT u.id,u.business_id,u.full_name,u.email,u.role,u.active,u.created_at,b.name AS business_name
            FROM auth_users u LEFT JOIN businesses b ON b.id=u.business_id"""
        params: list = []
        if search.strip():
            query += " WHERE lower(u.full_name) LIKE ? OR lower(u.email) LIKE ? OR lower(COALESCE(b.name,'')) LIKE ?"
            term = f"%{search.strip().lower()}%"
            params.extend([term, term, term])
        query += " ORDER BY u.created_at DESC LIMIT 1000"
        rows = conn.execute(query, params).fetchall()
        return [{"id": r["id"], "businessId": r["business_id"], "businessName": r["business_name"], "name": r["full_name"], "email": r["email"], "role": r["role"], "active": bool(r["active"]), "createdAt": r["created_at"]} for r in rows]


@router.post("/api/platform/users", status_code=201)
def platform_create_user(payload: PlatformCreateUserPayload):
    """Create a platform or business user. Only authenticated SUPERADMIN can reach platform endpoints."""
    identity = current_identity()
    if identity["role"] != "superadmin":
        raise HTTPException(403, "Solo SUPERADMIN puede crear usuarios globales.")
    business_id = payload.businessId.strip() if payload.businessId else None
    if payload.role == "superadmin":
        if business_id:
            raise HTTPException(422, "Una cuenta SUPERADMIN no debe pertenecer a un negocio.")
        business_id = None
    else:
        if not business_id:
            raise HTTPException(422, "Selecciona el negocio al que pertenecerá el usuario.")
        with connection() as conn:
            business = conn.execute("SELECT id FROM businesses WHERE id=?", (business_id,)).fetchone()
            if not business:
                raise HTTPException(404, "El negocio seleccionado no existe.")
            subscription = subscription_for_business(conn, business_id)
            user_count = conn.execute("SELECT count(*) FROM auth_users WHERE business_id=?", (business_id,)).fetchone()[0]
            if user_count >= subscription["plan"]["maxUsers"]:
                raise HTTPException(409, f"El plan {subscription['plan']['name']} permite hasta {subscription['plan']['maxUsers']} usuarios en total.")
    try:
        password_hash = hash_password(payload.password)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    user_id = f"USR-{uuid.uuid4().hex[:12].upper()}"
    with connection() as conn:
        try:
            conn.execute("INSERT INTO auth_users (id,business_id,full_name,email,password_hash,role,active) VALUES (?,?,?,?,?,?,1)",
                         (user_id, business_id, payload.name.strip(), payload.email, password_hash, payload.role))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "Ya existe una cuenta con ese correo.") from exc
        conn.execute("INSERT INTO platform_audit (actor_id,action,entity_id,details) VALUES (?,?,?,?)",
                     (identity["id"], "create_user", user_id, json.dumps({"role": payload.role, "businessId": business_id, "email": payload.email})))
        row = conn.execute("SELECT u.id,u.business_id,u.full_name,u.email,u.role,u.active,u.created_at,b.name business_name FROM auth_users u LEFT JOIN businesses b ON b.id=u.business_id WHERE u.id=?", (user_id,)).fetchone()
        return {"id": row["id"], "businessId": row["business_id"], "businessName": row["business_name"], "name": row["full_name"], "email": row["email"], "role": row["role"], "active": bool(row["active"]), "createdAt": row["created_at"]}


@router.patch("/api/platform/users/{user_id}/status")
def platform_user_status(user_id: str, active: bool = Query(...)):
    with connection() as conn:
        target = conn.execute("SELECT id,role FROM auth_users WHERE id=?", (user_id,)).fetchone()
        if not target:
            raise HTTPException(404, "Usuario no encontrado.")
        if target["role"] == "superadmin" and target["id"] == current_identity()["id"] and not active:
            raise HTTPException(400, "No puedes suspender tu propia cuenta SUPERADMIN.")
        conn.execute("UPDATE auth_users SET active=? WHERE id=?", (1 if active else 0, user_id))
        if not active:
            conn.execute("DELETE FROM auth_sessions WHERE user_id=?", (user_id,))
        conn.execute("INSERT INTO platform_audit (actor_id,action,entity_id,details) VALUES (?,?,?,?)", (current_identity()["id"], "activate_user" if active else "suspend_user", user_id, json.dumps({"active": active})))
        return {"id": user_id, "active": active}
