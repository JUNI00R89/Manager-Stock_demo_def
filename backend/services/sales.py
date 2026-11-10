from __future__ import annotations

import sqlite3

from backend.core.context import current_business_id
from backend.core.db import timestamp_iso


def _sale_out(sale: sqlite3.Row, items: list[sqlite3.Row], payment_rows: list[sqlite3.Row]) -> dict:
    mapped_items = [{
        "productId": i["product_id"], "productName": i["product_name"], "sku": i["sku_snapshot"],
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


def get_sale(conn: sqlite3.Connection, sale_id: str) -> dict | None:
    sale = conn.execute("SELECT * FROM sales WHERE id = ? AND business_id = ?", (sale_id, current_business_id())).fetchone()
    if not sale:
        return None
    items = conn.execute("SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id", (sale_id,)).fetchall()
    payment_rows = conn.execute("SELECT method, amount FROM sale_payments WHERE sale_id = ? ORDER BY id", (sale_id,)).fetchall()
    return _sale_out(sale, items, payment_rows)


def get_sales(conn: sqlite3.Connection, sales: list[sqlite3.Row]) -> list[dict]:
    """Same output as get_sale for many sales, with 2 queries in total instead of 3 per sale."""
    if not sales:
        return []
    ids = [sale["id"] for sale in sales]
    marks = ",".join("?" * len(ids))  # list_sales caps a page at 500 ids, below SQLite's parameter limit
    items: dict[str, list[sqlite3.Row]] = {sale_id: [] for sale_id in ids}
    for row in conn.execute(f"SELECT * FROM sale_items WHERE sale_id IN ({marks}) ORDER BY id", ids):
        items[row["sale_id"]].append(row)
    payments: dict[str, list[sqlite3.Row]] = {sale_id: [] for sale_id in ids}
    for row in conn.execute(f"SELECT sale_id, method, amount FROM sale_payments WHERE sale_id IN ({marks}) ORDER BY id", ids):
        payments[row["sale_id"]].append(row)
    return [_sale_out(sale, items[sale["id"]], payments[sale["id"]]) for sale in sales]
