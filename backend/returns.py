"""Partial returns: original prices, bounded refunds, a current cash shift and no duplicate stock."""
import hashlib
import json
import uuid
from decimal import Decimal, ROUND_HALF_UP
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator
from . import main as core

router = APIRouter(prefix='/api/sales')


def cents(value):
    return Decimal(str(value)).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)


class ReturnLine(BaseModel):
    itemId: int = Field(gt=0)
    quantity: float = Field(gt=0, le=100000, allow_inf_nan=False)
    restock: bool = True


class ReturnSelection(BaseModel):
    items: list[ReturnLine] = Field(default_factory=list, max_length=200)
    serviceAmount: float = Field(default=0, ge=0, allow_inf_nan=False)


class ReturnPayload(ReturnSelection):
    idempotencyKey: str = Field(min_length=8, max_length=100)
    cashSessionId: str = Field(min_length=1, max_length=100)
    reason: str = Field(min_length=3, max_length=500)
    payments: list[core.PaymentPartPayload] = Field(default_factory=list, max_length=4)
    expectedTotal: float = Field(ge=0, allow_inf_nan=False)

    @field_validator('reason', mode='before')
    @classmethod
    def trim(cls, value):
        return value.strip() if isinstance(value, str) else value


def return_out(conn, row):
    service = conn.execute('SELECT amount FROM service_return_amounts WHERE return_id=?', (row['id'],)).fetchone()
    return {'id': row['id'], 'saleId': row['sale_id'], 'total': row['total'], 'reason': row['reason'],
            'serviceAmount': service['amount'] if service else 0,
            'cashSessionId': row['cash_session_id'], 'createdAt': core.timestamp_iso(row['created_at']),
            'items': [{'itemId': r['sale_item_id'], 'quantity': r['quantity'], 'restock': bool(r['restock']), 'amount': r['amount']}
                      for r in conn.execute('SELECT * FROM sale_return_items WHERE return_id=? ORDER BY id', (row['id'],))],
            'payments': [dict(r) for r in conn.execute('SELECT method,amount FROM sale_return_payments WHERE return_id=? ORDER BY method', (row['id'],))]}


def returns_for_sale(conn, sale_id):
    return [return_out(conn, r) for r in conn.execute('SELECT * FROM sale_returns WHERE business_id=? AND sale_id=? ORDER BY created_at,id', (core.current_business_id(), sale_id))]


def allocation(conn, sale):
    rows = conn.execute('SELECT * FROM sale_items WHERE sale_id=? AND product_id IS NOT NULL ORDER BY id', (sale['id'],)).fetchall()
    service = conn.execute('SELECT line_total FROM service_sale_lines WHERE sale_id=?', (sale['id'],)).fetchone()
    legacy = conn.execute('SELECT COALESCE(SUM(line_total),0) FROM sale_items WHERE sale_id=? AND product_id IS NULL', (sale['id'],)).fetchone()[0]
    if legacy: service = {'line_total': (service['line_total'] if service else 0) + legacy}
    line_base = sum(Decimal(str(r['line_total'])) for r in rows) + (Decimal(str(service['line_total'])) if service else Decimal(0))
    remaining = cents(sale['total'])
    budgets = {}
    for index, row in enumerate(rows):
        amount = remaining if index == len(rows) - 1 and not service else min(remaining, cents(Decimal(str(row['line_total'])) / line_base * cents(sale['total']))) if line_base else Decimal(0)
        budgets[row['id']] = amount
        remaining -= amount
    return rows, budgets, remaining if service else Decimal(0)


def service_balance(conn, sale):
    _, _, budget = allocation(conn, sale)
    returned = conn.execute('SELECT COALESCE(SUM(a.amount),0) FROM service_return_amounts a JOIN sale_returns r ON r.id=a.return_id WHERE r.sale_id=?', (sale['id'],)).fetchone()[0]
    return max(Decimal(0), budget - cents(returned))


def return_product(conn, product_id):
    product = conn.execute('SELECT * FROM products WHERE id=? AND business_id=?', (product_id, core.current_business_id())).fetchone()
    if not product:
        raise HTTPException(404, 'Producto original no encontrado.')
    return product


def quote(conn, sale_id, selection):
    sale = conn.execute('SELECT * FROM sales WHERE id=? AND business_id=?', (sale_id, core.current_business_id())).fetchone()
    if not sale:
        raise HTTPException(404, 'Venta no encontrada.')
    if sale['status'] != 'completed':
        raise HTTPException(409, 'Solo se devuelven artículos de ventas completadas.')
    if not selection.items and selection.serviceAmount <= 0:
        raise HTTPException(422, 'Selecciona productos o un importe del servicio a devolver.')
    if cents(selection.serviceAmount) != Decimal(str(selection.serviceAmount)) or cents(selection.serviceAmount) > service_balance(conn, sale):
        raise HTTPException(422, 'El importe supera lo que queda del servicio o tiene más de dos decimales.')
    # Allocate the original total in cents; the final line absorbs rounding.
    rows, budgets, _ = allocation(conn, sale)
    by_id = {r['id']: r for r in rows}
    selected = set()
    output = []
    for item in selection.items:
        if item.itemId in selected or item.itemId not in by_id:
            raise HTTPException(422, 'Selecciona líneas distintas de esta venta.')
        selected.add(item.itemId)
        row = by_id[item.itemId]
        if round(item.quantity, 6) != item.quantity:
            raise HTTPException(422, 'La cantidad admite hasta seis decimales.')
        used = conn.execute('SELECT COALESCE(SUM(quantity),0) qty,COALESCE(SUM(amount),0) amount FROM sale_return_items WHERE sale_item_id=?', (item.itemId,)).fetchone()
        quantity = Decimal(str(item.quantity))
        cumulative = Decimal(str(round(used['qty'], 6))) + quantity
        if cumulative > Decimal(str(row['quantity'])):
            raise HTTPException(409, 'La cantidad supera lo que queda por devolver. Actualiza la venta.')
        product = return_product(conn, row['product_id'])
        core.validate_product_quantity(product, item.quantity)
        recipe = conn.execute('SELECT id FROM recipes WHERE product_id=? AND business_id=?', (row['product_id'], core.current_business_id())).fetchone()
        # Cooked/prepared products do not turn back into raw ingredients.
        physical = conn.execute("SELECT 1 FROM inventory_movements WHERE sale_id=? AND product_id=? AND movement_type='sale' LIMIT 1", (sale_id, row['product_id'])).fetchone()
        if item.restock and (recipe or not physical or product['track_lots']):
            raise HTTPException(422, 'Este artículo no puede reponerse automáticamente. Los productos preparados o con lotes requieren revisión física; selecciona sin reposición.')
        target = cents(budgets[item.itemId] * cumulative / Decimal(str(row['quantity'])))
        amount = target - cents(used['amount'])
        output.append({'itemId': item.itemId, 'productId': row['product_id'], 'productName': row['product_name'],
                       'quantity': item.quantity, 'restock': item.restock, 'amount': float(amount), 'unitCost': row['unit_cost_snapshot']})
    payments = {r['method']: float(r['amount']) for r in conn.execute('SELECT method,SUM(amount) amount FROM sale_payments WHERE sale_id=? GROUP BY method', (sale_id,))}
    if not payments and sale['payment_method'] != 'split':
        payments[sale['payment_method']] = float(sale['total'])
    for r in conn.execute('''SELECT p.method,SUM(p.amount) amount FROM sale_return_payments p JOIN sale_returns r ON r.id=p.return_id
                             WHERE r.sale_id=? GROUP BY p.method''', (sale_id,)):
        payments[r['method']] = round(payments.get(r['method'], 0) - r['amount'], 2)
    return {'saleId': sale_id, 'items': output, 'serviceAmount': selection.serviceAmount,
            'total': float(sum(cents(i['amount']) for i in output) + cents(selection.serviceAmount)), 'availablePayments': payments}


@router.post('/{sale_id}/returns/quote')
def quote_return(sale_id: str, payload: ReturnSelection):
    with core.connection() as conn:
        conn.execute('BEGIN')
        return quote(conn, sale_id, payload)


@router.post('/{sale_id}/returns', status_code=201)
def create_return(sale_id: str, payload: ReturnPayload):
    if not core.has_permission('cash.manage'):
        raise HTTPException(403, 'Necesitas permiso de caja para registrar la devolución.')
    fingerprint = hashlib.sha256(json.dumps({'saleId': sale_id, **payload.model_dump()}, sort_keys=True, allow_nan=False).encode()).hexdigest()
    with core.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        previous = conn.execute('SELECT * FROM sale_returns WHERE business_id=? AND idempotency_key=?', (core.current_business_id(), payload.idempotencyKey)).fetchone()
        if previous:
            if previous['request_hash'] != fingerprint:
                raise HTTPException(409, 'La clave de operación ya fue utilizada con otros datos.')
            return return_out(conn, previous)
        summary = quote(conn, sale_id, payload)
        if cents(payload.expectedTotal) != cents(summary['total']):
            raise HTTPException(409, 'El total cambió. Revisa de nuevo la devolución.')
        amounts = {}
        for payment in payload.payments:
            if payment.method in amounts or not Decimal(str(payment.amount)).is_finite() or cents(payment.amount) != Decimal(str(payment.amount)) or payment.amount <= 0:
                raise HTTPException(422, 'Indica una sola cantidad positiva, con hasta dos decimales, por medio de devolución.')
            amounts[payment.method] = cents(payment.amount)
            if amounts[payment.method] > cents(summary['availablePayments'].get(payment.method, 0)):
                raise HTTPException(422, 'La devolución supera lo cobrado por ese medio de pago.')
        if sum(amounts.values()) != cents(summary['total']):
            raise HTTPException(422, 'Los importes devueltos deben coincidir con el total.')
        session = conn.execute("SELECT * FROM cash_sessions WHERE id=? AND business_id=? AND opened_by_user_id=? AND status='open'", (payload.cashSessionId, core.current_business_id(), core.current_identity()['id'])).fetchone()
        if not session:
            raise HTTPException(409, 'Abre tu turno de caja antes de devolver dinero.')
        if amounts.get('cash', 0) > cents(core.cash_session_out(conn, session)['expectedAmount']):
            raise HTTPException(409, 'El efectivo disponible en este turno es insuficiente.')
        return_id = 'DEV-' + uuid.uuid4().hex[:16]
        conn.execute('''INSERT INTO sale_returns(id,business_id,sale_id,cash_session_id,reason,total,idempotency_key,request_hash,created_by)
            VALUES (?,?,?,?,?,?,?,?,?)''', (return_id, core.current_business_id(), sale_id, session['id'], payload.reason, summary['total'], payload.idempotencyKey, fingerprint, core.current_identity()['id']))
        for item in summary['items']:
            conn.execute('INSERT INTO sale_return_items(return_id,sale_item_id,quantity,restock,amount) VALUES (?,?,?,?,?)', (return_id, item['itemId'], item['quantity'], item['restock'], item['amount']))
            if item['restock']:
                product = return_product(conn, item['productId'])
                core.add_product_stock(conn, product, item['quantity'], movement_type='customer_return', note=payload.reason,
                                       reference_type='sale_return', reference_id=return_id, unit_cost=item['unitCost'])
        for method, amount in amounts.items():
            conn.execute('INSERT INTO sale_return_payments VALUES (?,?,?)', (return_id, method, float(amount)))
        if payload.serviceAmount:
            conn.execute('INSERT INTO service_return_amounts VALUES (?,?)', (return_id, payload.serviceAmount))
        core.audit(conn, 'return', 'sale', sale_id, {'returnId': return_id, 'total': summary['total']})
        conn.commit()
        return return_out(conn, conn.execute('SELECT * FROM sale_returns WHERE id=?', (return_id,)).fetchone())
