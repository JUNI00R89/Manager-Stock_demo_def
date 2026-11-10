from __future__ import annotations

from contextvars import ContextVar

from fastapi import HTTPException


# Request-scoped identity: never keep a tenant or user in a mutable global variable.
_current_identity: ContextVar[dict | None] = ContextVar("manager_stock_identity", default=None)


def current_identity() -> dict:
    identity = _current_identity.get()
    if not identity:
        raise HTTPException(status_code=401, detail="Inicia sesión para continuar.")
    return identity


def current_business_id() -> str:
    identity = current_identity()
    business_id = identity.get("business_id")
    if not business_id:
        raise HTTPException(status_code=403, detail="Esta operación requiere un negocio asignado.")
    return str(business_id)
