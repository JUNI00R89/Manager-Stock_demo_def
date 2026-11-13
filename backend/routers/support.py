from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.core.context import current_business_id, current_identity
from backend.core.db import connection, timestamp_iso
from backend.schemas import SupportMessagePayload
from backend.services.support import support_case_out, support_messages_out


router = APIRouter()


@router.get("/api/suspension/status")
def suspension_status():
    identity = current_identity()
    if identity["role"] != "owner":
        raise HTTPException(403, "Solo el propietario puede consultar el caso de suspensión.")
    business_id = current_business_id()
    with connection() as conn:
        business = conn.execute("SELECT id,name,active,suspension_reason,suspension_description,suspended_at FROM businesses WHERE id=?", (business_id,)).fetchone()
        case = conn.execute("SELECT * FROM support_cases WHERE business_id=? ORDER BY created_at DESC LIMIT 1", (business_id,)).fetchone()
        output_case = None
        if case:
            case = conn.execute("SELECT c.*,b.name AS business_name FROM support_cases c JOIN businesses b ON b.id=c.business_id WHERE c.id=?", (case["id"],)).fetchone()
            output_case = support_case_out(conn, case)
            messages = support_messages_out(conn, case["id"], identity["id"])
        else:
            messages = []
        return {"businessId": business["id"], "businessName": business["name"], "active": bool(business["active"]),
            "reason": business["suspension_reason"] or "", "description": business["suspension_description"] or "",
            "suspendedAt": timestamp_iso(business["suspended_at"]), "case": output_case, "messages": messages}


@router.get("/api/support/case")
def owner_support_case():
    identity = current_identity()
    if identity["role"] != "owner":
        raise HTTPException(403, "Solo el propietario puede consultar este caso.")
    with connection() as conn:
        row = conn.execute("SELECT c.*,b.name business_name FROM support_cases c JOIN businesses b ON b.id=c.business_id WHERE c.business_id=? ORDER BY c.created_at DESC LIMIT 1", (current_business_id(),)).fetchone()
        if not row:
            return None
        return support_case_out(conn, row)


@router.get("/api/support/messages")
def owner_support_messages():
    identity = current_identity()
    if identity["role"] != "owner":
        raise HTTPException(403, "Solo el propietario puede consultar esta conversación.")
    with connection() as conn:
        case = conn.execute("SELECT id FROM support_cases WHERE business_id=? ORDER BY created_at DESC LIMIT 1", (current_business_id(),)).fetchone()
        if not case: return []
        return support_messages_out(conn, case["id"], identity["id"])


@router.post("/api/support/messages", status_code=201)
def owner_send_support_message(payload: SupportMessagePayload):
    identity = current_identity()
    if identity["role"] != "owner":
        raise HTTPException(403, "Solo el propietario puede enviar mensajes a soporte.")
    with connection() as conn:
        case = conn.execute("SELECT id,status FROM support_cases WHERE business_id=? ORDER BY created_at DESC LIMIT 1", (current_business_id(),)).fetchone()
        if not case:
            raise HTTPException(404, "No existe un caso de soporte para este negocio.")
        if case["status"] in {"resolved", "closed"}:
            conn.execute("UPDATE support_cases SET status='open',updated_at=CURRENT_TIMESTAMP WHERE id=?", (case["id"],))
        conn.execute("INSERT INTO support_messages (case_id,business_id,sender_id,sender_role,message) VALUES (?,?,?,?,?)", (case["id"], current_business_id(), identity["id"], "owner", payload.message))
        conn.execute("UPDATE support_cases SET updated_at=CURRENT_TIMESTAMP WHERE id=?", (case["id"],))
        return support_messages_out(conn, case["id"])[-1]
