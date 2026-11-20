"""Fiado: what each customer owes on credit sales, the limit the owner sets, and abonos received through the till."""
import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

from backend.core.context import current_business_id, current_identity
from backend.core.db import audit, connection, timestamp_iso
from backend.core.security import has_permission
from backend.schemas import DigitalProvider, _digital_details

router = APIRouter(prefix="/api/customers")

CREDIT_SALES = """FROM sale_payments sp JOIN sales s ON s.id=sp.sale_id
    JOIN customer_operations c ON c.source_type='sale' AND c.source_id=s.id AND c.business_id=s.business_id
    WHERE c.customer_id=? AND s.business_id=? AND s.status='completed' AND sp.method='credit'"""
CREDIT_RETURNS = """FROM sale_return_payments p JOIN sale_returns r ON r.id=p.return_id
    JOIN customer_operations c ON c.source_type='sale' AND c.source_id=r.sale_id AND c.business_id=r.business_id
    WHERE c.customer_id=? AND r.business_id=? AND p.method='credit'"""


def credit_balance(conn, customer_id: str) -> float:
    """Credit sold minus credit returned minus abonos. Negative means the customer has money in favour."""
    args = (customer_id, current_business_id())
    sold = conn.execute(f"SELECT COALESCE(SUM(sp.amount),0) {CREDIT_SALES}", args).fetchone()[0]
    returned = conn.execute(f"SELECT COALESCE(SUM(p.amount),0) {CREDIT_RETURNS}", args).fetchone()[0]
    paid = conn.execute("SELECT COALESCE(SUM(amount),0) FROM customer_credit_payments WHERE customer_id=? AND business_id=?", args).fetchone()[0]
    return round(sold - returned - paid, 2)


def check_credit_sale(conn, customer: dict | None, amount: float) -> None:
    """Called by create_sale under its write lock, so two tills cannot both use the same available limit."""
    if amount <= 0:
        return
    if not customer:
        raise HTTPException(422, "Elige un cliente registrado para vender fiado.")
    limit = conn.execute("SELECT credit_limit FROM customers WHERE id=?", (customer["id"],)).fetchone()[0]
    if limit <= 0:
        raise HTTPException(409, f"{customer['name']} no tiene cupo de fiado. El dueño o un administrador puede asignarlo en Clientes.")
    available = round(limit - credit_balance(conn, customer["id"]), 2)
    if amount > available + 0.005:
        raise HTTPException(409, f"El cupo de fiado de {customer['name']} no alcanza. Disponible: ${max(available, 0):,.0f}".replace(",", "."))


def require_customer(conn, customer_id: str):
    row = conn.execute("SELECT * FROM customers WHERE id=? AND business_id=?", (customer_id, current_business_id())).fetchone()
    if not row:
        raise HTTPException(404, "Cliente no encontrado.")
    return row


def payment_out(row) -> dict:
    return {"id": row["id"], "amount": row["amount"], "method": row["method"], "provider": row["provider"], "reference": row["reference"],
            "cashSessionId": row["cash_session_id"], "createdBy": row["created_by"], "createdAt": timestamp_iso(row["created_at"])}


@router.get("/{customer_id}/credit")
def customer_credit(customer_id: str):
    with connection() as conn:
        customer = require_customer(conn, customer_id)
        args = (customer_id, current_business_id())
        movements = [{"type": "sale", "id": r["id"], "amount": r["amount"], "createdAt": timestamp_iso(r["created_at"])}
                     for r in conn.execute(f"SELECT s.id, s.created_at, SUM(sp.amount) amount {CREDIT_SALES} GROUP BY s.id", args)]
        movements += [{"type": "return", "id": r["sale_id"], "amount": r["amount"], "createdAt": timestamp_iso(r["created_at"])}
                      for r in conn.execute(f"SELECT r.sale_id, r.created_at, p.amount {CREDIT_RETURNS}", args)]
        movements += [{"type": "payment", **payment_out(r)} for r in conn.execute(
            "SELECT * FROM customer_credit_payments WHERE customer_id=? AND business_id=?", args)]
        movements.sort(key=lambda m: m["createdAt"] or "", reverse=True)
        balance = credit_balance(conn, customer_id)
        limit = customer["credit_limit"]
        return {"customerId": customer_id, "creditLimit": limit, "balance": balance, "available": round(max(limit - balance, 0), 2), "movements": movements[:200]}


class CreditLimitPayload(BaseModel):
    creditLimit: float = Field(ge=0, le=1_000_000_000, allow_inf_nan=False)


@router.put("/{customer_id}/credit-limit")
def set_credit_limit(customer_id: str, payload: CreditLimitPayload):
    if current_identity()["role"] not in {"owner", "business_admin"}:
        raise HTTPException(403, "Solo el dueño o un administrador pueden cambiar el cupo de fiado.")
    with connection() as conn:
        require_customer(conn, customer_id)
        conn.execute("UPDATE customers SET credit_limit=?, revision=revision+1, updated_at=CURRENT_TIMESTAMP WHERE id=?", (round(payload.creditLimit, 2), customer_id))
        audit(conn, "credit_limit", "customer", customer_id, {"creditLimit": payload.creditLimit})
        conn.commit()
        from backend.commerce import resolve_customer
        return resolve_customer(conn, customer_id, active=False)


class CreditPaymentPayload(BaseModel):
    idempotencyKey: str = Field(min_length=8, max_length=100)
    amount: float = Field(gt=0, le=1_000_000_000, allow_inf_nan=False)
    method: Literal["cash", "card", "digital", "transfer"]
    provider: DigitalProvider | None = None
    reference: str = Field(default="", max_length=60)
    cashSessionId: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def digital_needs_provider(self):
        self.provider, self.reference = _digital_details(self.method, self.provider, self.reference)
        self.amount = round(self.amount, 2)
        return self


@router.post("/{customer_id}/credit-payments", status_code=201)
def receive_credit_payment(customer_id: str, payload: CreditPaymentPayload):
    identity = current_identity()
    base_cashier = identity["role"] == "cashier" and not identity.get("custom_role_id")
    if not base_cashier and not has_permission("cash.manage"):
        raise HTTPException(403, "Necesitas permiso de caja para recibir abonos.")
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        require_customer(conn, customer_id)
        previous = conn.execute("SELECT * FROM customer_credit_payments WHERE business_id=? AND idempotency_key=?", (current_business_id(), payload.idempotencyKey)).fetchone()
        if previous:
            same = (previous["customer_id"], previous["amount"], previous["method"], previous["provider"], previous["created_by"]) == (customer_id, payload.amount, payload.method, payload.provider, identity["id"])
            if not same:
                raise HTTPException(409, "La clave de operación ya fue utilizada con otros datos.")
            conn.commit()
            return {"payment": payment_out(previous), "balance": credit_balance(conn, customer_id)}
        session = conn.execute("SELECT id FROM cash_sessions WHERE id=? AND business_id=? AND opened_by_user_id=? AND status='open'",
                               (payload.cashSessionId, current_business_id(), identity["id"])).fetchone()
        if not session:
            raise HTTPException(409, "Abre tu turno de caja antes de recibir un abono.")
        balance = credit_balance(conn, customer_id)
        if payload.amount > balance + 0.005:
            raise HTTPException(422, f"El abono supera el saldo pendiente (${max(balance, 0):,.0f}).".replace(",", "."))
        payment_id = "ABO-" + uuid.uuid4().hex[:16]
        conn.execute("""INSERT INTO customer_credit_payments (id,business_id,customer_id,amount,method,provider,reference,cash_session_id,idempotency_key,created_by)
                        VALUES (?,?,?,?,?,?,?,?,?,?)""", (payment_id, current_business_id(), customer_id, payload.amount, payload.method,
                                                          payload.provider, payload.reference, session["id"], payload.idempotencyKey, identity["id"]))
        audit(conn, "credit_payment", "customer", customer_id, {"paymentId": payment_id, "amount": payload.amount, "method": payload.method})
        conn.commit()
        row = conn.execute("SELECT * FROM customer_credit_payments WHERE id=?", (payment_id,)).fetchone()
        return {"payment": payment_out(row), "balance": credit_balance(conn, customer_id)}
