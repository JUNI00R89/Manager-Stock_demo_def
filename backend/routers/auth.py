from __future__ import annotations

import sqlite3
import uuid

from fastapi import APIRouter, HTTPException

from backend.core.config import DEFAULT_TAX_RATE
from backend.core.context import current_identity
from backend.core.db import connection
from backend.core.security import hash_password, issue_session, public_user, verify_password
from backend.schemas import LoginPayload, RegisterPayload


router = APIRouter()


def make_auth_response(conn: sqlite3.Connection, user_row: sqlite3.Row) -> dict:
    token = issue_session(conn, user_row["id"])
    return {"access_token": token, "token_type": "bearer", "user": public_user(user_row, conn)}


@router.post("/api/auth/register", status_code=201)
def register(payload: RegisterPayload):
    try:
        password_hash = hash_password(payload.password)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    business_id = f"NEG-{uuid.uuid4().hex[:12].upper()}"
    user_id = f"USR-{uuid.uuid4().hex[:12].upper()}"
    business_name = (payload.businessName or f"Negocio de {payload.name.strip()}").strip()
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        exists = conn.execute("SELECT id FROM auth_users WHERE email=?", (payload.email,)).fetchone()
        if exists:
            conn.rollback()
            raise HTTPException(409, "Ya existe una cuenta con ese correo.")
        conn.execute("INSERT INTO businesses (id,name,business_type,currency,tax_rate,settings_json,active) VALUES (?,?,?,?,?,'{}',1)",
                     (business_id, business_name, "retail", "COP", DEFAULT_TAX_RATE))
        conn.execute("INSERT INTO auth_users (id,business_id,full_name,email,password_hash,role) VALUES (?,?,?,?,?,'owner')",
                     (user_id, business_id, payload.name.strip(), payload.email, password_hash))
        user_row = conn.execute("SELECT * FROM auth_users WHERE id=?", (user_id,)).fetchone()
        response = make_auth_response(conn, user_row)
        conn.commit()
        return response


@router.post("/api/auth/login")
def login(payload: LoginPayload):
    with connection() as conn:
        row = conn.execute("SELECT * FROM auth_users WHERE email=?", (payload.email,)).fetchone()
        if not row or not row["active"] or not verify_password(payload.password, row["password_hash"]):
            raise HTTPException(401, "Correo o contraseña incorrectos.")
        if row["business_id"]:
            business = conn.execute("SELECT active FROM businesses WHERE id=?", (row["business_id"],)).fetchone()
            if not business:
                raise HTTPException(403, "El negocio asignado a esta cuenta no existe.")
            if not business["active"] and row["role"] != "owner":
                raise HTTPException(403, "El negocio está suspendido. Solo el propietario puede acceder al centro de revisión.")
        return make_auth_response(conn, row)


@router.get("/api/auth/me")
def auth_me():
    identity = current_identity()
    with connection() as conn:
        row = conn.execute("SELECT * FROM auth_users WHERE id=?", (identity["id"],)).fetchone()
        if not row:
            raise HTTPException(401, "La cuenta ya no existe.")
        return public_user(row, conn)


@router.post("/api/auth/logout")
def auth_logout():
    identity = current_identity()
    with connection() as conn:
        conn.execute("DELETE FROM auth_sessions WHERE token_hash=?", (identity["token_hash"],))
    return {"ok": True}
