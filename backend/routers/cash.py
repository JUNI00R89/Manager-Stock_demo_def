from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.core.context import current_business_id, current_identity
from backend.core.db import audit, connection
from backend.services.cash import cash_session_out


router = APIRouter()


class CashSessionOpenPayload(BaseModel):
    openedBy: str = Field(default="Usuario local", min_length=1, max_length=120)
    openingAmount: float = Field(ge=0, le=100000000000)


class CashSessionClosePayload(BaseModel):
    closingAmount: float = Field(ge=0, le=100000000000)


@router.get("/api/cash/sessions/current")
def current_cash_session():
    with connection() as conn:
        row = conn.execute("SELECT * FROM cash_sessions WHERE business_id=? AND opened_by_user_id=? AND status='open' ORDER BY opened_at DESC LIMIT 1", (current_business_id(), current_identity()["id"])).fetchone()
        return cash_session_out(conn, row) if row else None


@router.get("/api/cash/sessions")
def list_cash_sessions(limit: int = Query(default=100, ge=1, le=500)):
    with connection() as conn:
        if current_identity()["role"] == "cashier":
            rows = conn.execute("SELECT * FROM cash_sessions WHERE business_id=? AND opened_by_user_id=? ORDER BY opened_at DESC LIMIT ?", (current_business_id(), current_identity()["id"], limit)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM cash_sessions WHERE business_id=? ORDER BY opened_at DESC LIMIT ?", (current_business_id(), limit)).fetchall()
        return [cash_session_out(conn, row) for row in rows]


@router.get("/api/cash/sessions/{session_id}")
def get_cash_session(session_id: str):
    with connection() as conn:
        if current_identity()["role"] == "cashier":
            row = conn.execute("SELECT * FROM cash_sessions WHERE id=? AND business_id=? AND opened_by_user_id=?", (session_id, current_business_id(), current_identity()["id"])).fetchone()
        else:
            row = conn.execute("SELECT * FROM cash_sessions WHERE id=? AND business_id=?", (session_id, current_business_id())).fetchone()
        if not row:
            raise HTTPException(404, "Turno de caja no encontrado.")
        return cash_session_out(conn, row)


@router.post("/api/cash/sessions", status_code=201)
def open_cash_session(payload: CashSessionOpenPayload):
    session_id = f"CAJ-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        opened = conn.execute("SELECT id FROM cash_sessions WHERE business_id=? AND opened_by_user_id=? AND status='open' LIMIT 1", (current_business_id(), current_identity()["id"])).fetchone()
        if opened:
            conn.rollback()
            raise HTTPException(409, "Ya tienes un turno de caja abierto. Ciérralo antes de abrir otro.")
        conn.execute("INSERT INTO cash_sessions (id,business_id,opened_by,opened_by_user_id,opening_amount,status) VALUES (?,?,?,?,?,'open')", (session_id, current_business_id(), current_identity()["name"], current_identity()["id"], payload.openingAmount))
        audit(conn, "open", "cash_session", session_id, {"openingAmount": payload.openingAmount})
        conn.commit()
        row = conn.execute("SELECT * FROM cash_sessions WHERE id=?", (session_id,)).fetchone()
        return cash_session_out(conn, row)


@router.post("/api/cash/sessions/{session_id}/close")
def close_cash_session(session_id: str, payload: CashSessionClosePayload):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if current_identity()["role"] == "cashier":
            row = conn.execute("SELECT * FROM cash_sessions WHERE id=? AND business_id=? AND opened_by_user_id=?", (session_id, current_business_id(), current_identity()["id"])).fetchone()
        else:
            row = conn.execute("SELECT * FROM cash_sessions WHERE id=? AND business_id=?", (session_id, current_business_id())).fetchone()
        if not row:
            conn.rollback()
            raise HTTPException(404, "Turno de caja no encontrado.")
        if row["status"] == "closed":
            conn.commit()
            return cash_session_out(conn, row)
        current = cash_session_out(conn, row)
        expected = current["expectedAmount"]
        difference = round(payload.closingAmount - expected, 2)
        conn.execute("UPDATE cash_sessions SET closing_amount=?,expected_amount=?,difference=?,status='closed',closed_at=CURRENT_TIMESTAMP WHERE id=?", (payload.closingAmount, expected, difference, session_id))
        audit(conn, "close", "cash_session", session_id, {"closingAmount": payload.closingAmount, "expectedAmount": expected, "difference": difference})
        conn.commit()
        closed = conn.execute("SELECT * FROM cash_sessions WHERE id=?", (session_id,)).fetchone()
        return cash_session_out(conn, closed)
