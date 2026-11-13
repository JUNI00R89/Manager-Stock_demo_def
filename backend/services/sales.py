from __future__ import annotations

import sqlite3
import json
from decimal import Decimal, ROUND_HALF_UP

from backend.core.context import current_business_id
from backend.core.db import timestamp_iso


def _sale_out(sale: sqlite3.Row, items: list[sqlite3.Row], payment_rows: list[sqlite3.Row]) -> dict:
    mapped_items = [{
        "id": i["id"] if i["product_id"] else None, "productId": i["product_id"], "productName": i["product_name"], "sku": i["sku_snapshot"],
        "quantity": i["quantity"], "price": i["unit_price"],
        "unitCost": i["unit_cost_snapshot"] if "unit_cost_snapshot" in i.keys() else 0,
        "discountPercent": i["discount_percent"], "subtotal": i["line_total"],
    } for i in items]
    count_products = len(mapped_items)
    product_names = ", ".join(i["productName"] for i in mapped_items[:2])
    if count_products > 2:
        product_names += f" y {count_products - 2} más"
    return {
        "id": sale["id"], "date": timestamp_iso(sale["created_at"]), "status": sale["status"], "customer": sale["customer"],
        "paymentMethod": sale["payment_method"], "currency": sale["currency"], "subtotal": sale["subtotal"],
        "lineDiscount": sale["line_discount"], "globalDiscount": sale["global_discount"],
        "taxRate": sale["tax_rate"], "tax": sale["tax"], "totalPrice": sale["total"],
        "cashSessionId": sale["cash_session_id"], "createdBy": sale["created_by"],
        "payments": [{"method": row["method"], "amount": row["amount"]} for row in payment_rows],
        "productId": mapped_items[0]["productId"] if mapped_items else "", "productName": product_names or "Venta sin productos",
        "quantity": sum(i["quantity"] for i in mapped_items), "items": mapped_items,
    }


def get_sale(conn, sale_id):
    row = conn.execute('SELECT * FROM sales WHERE id=? AND business_id=?', (sale_id, current_business_id())).fetchone()
    return get_sales(conn, [row])[0] if row else None


def get_sales(conn, sales):
    """Batch all receipt metadata; query count is independent of page size."""
    if not sales: return []
    ids = [s['id'] for s in sales]
    marks = ','.join('?' for _ in ids)
    def grouped(query, params, key):
        result = {}
        for row in conn.execute(query, params): result.setdefault(row[key], []).append(row)
        return result
    items = grouped(f'SELECT * FROM sale_items WHERE sale_id IN ({marks}) ORDER BY id', ids, 'sale_id')
    payments = grouped(f'SELECT * FROM sale_payments WHERE sale_id IN ({marks}) ORDER BY id', ids, 'sale_id')
    services = grouped(f'SELECT * FROM service_sale_lines WHERE sale_id IN ({marks})', ids, 'sale_id')
    customers = grouped(f"SELECT * FROM customer_operations WHERE business_id=? AND source_type='sale' AND source_id IN ({marks})", [current_business_id(), *ids], 'source_id')
    refunds = grouped(f'SELECT * FROM sale_returns WHERE business_id=? AND sale_id IN ({marks}) ORDER BY created_at,id', [current_business_id(), *ids], 'sale_id')
    refund_ids = [r['id'] for rows in refunds.values() for r in rows]
    ri, rp, rs = {}, {}, {}
    if refund_ids:
        rm = ','.join('?' for _ in refund_ids)
        ri = grouped(f'SELECT * FROM sale_return_items WHERE return_id IN ({rm}) ORDER BY id', refund_ids, 'return_id')
        rp = grouped(f'SELECT * FROM sale_return_payments WHERE return_id IN ({rm})', refund_ids, 'return_id')
        rs = grouped(f'SELECT * FROM service_return_amounts WHERE return_id IN ({rm})', refund_ids, 'return_id')
    out = []
    cents = lambda n: Decimal(str(n)).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)
    for sale in sales:
        sid = sale['id']; lines = items.get(sid, [])
        value = _sale_out(sale, lines, payments.get(sid, []))
        for service in services.get(sid, []):
            value['items'].insert(0, dict(productId='service:'+service['service_id'], productName=service['service_name'], sku='SERVICIO', quantity=1, price=service['unit_price'], unitCost=0, discountPercent=0, subtotal=service['line_total']))
        if services.get(sid):
            value['productName'] = ', '.join(i['productName'] for i in value['items'][:2])
            value['quantity'] = sum(i['quantity'] for i in value['items'])
        value['returns'] = [dict(id=r['id'], saleId=sid, total=r['total'], reason=r['reason'], cashSessionId=r['cash_session_id'], createdAt=timestamp_iso(r['created_at']), serviceAmount=sum(a['amount'] for a in rs.get(r['id'], [])), items=[dict(itemId=i['sale_item_id'],quantity=i['quantity'],restock=bool(i['restock']),amount=i['amount']) for i in ri.get(r['id'], [])], payments=[dict(method=i['method'],amount=i['amount']) for i in rp.get(r['id'], [])]) for r in refunds.get(sid, [])]
        returned = round(sum(r['total'] for r in value['returns']), 2)
        value.update(returnedTotal=returned, netTotal=0 if sale['status']=='cancelled' else round(sale['total']-returned,2), returnableServiceAmount=0, customerId=None, customerSnapshot=None)
        link = customers.get(sid, [])
        if link: value.update(customerId=link[0]['customer_id'], customerSnapshot=json.loads(link[0]['customer_snapshot']))
        if services.get(sid) or any(i['product_id'] is None for i in lines):
            base = sum(Decimal(str(i['subtotal'])) for i in value['items'])
            remaining = cents(sale['total'])
            for i in lines:
                if i['product_id']:
                    remaining -= min(remaining, cents(Decimal(str(i['line_total'])) / base * cents(sale['total']))) if base else Decimal(0)
            value['returnableServiceAmount'] = float(max(Decimal(0), remaining-sum(cents(r['serviceAmount']) for r in value['returns'])))
        out.append(value)
    return out
