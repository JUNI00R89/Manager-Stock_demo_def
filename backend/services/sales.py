from __future__ import annotations

import sqlite3

from backend.core.context import current_business_id
from backend.core.db import timestamp_iso


def get_sale(conn: sqlite3.Connection, sale_id: str) -> dict | None:
    sale = conn.execute("SELECT * FROM sales WHERE id = ? AND business_id = ?", (sale_id, current_business_id())).fetchone()
    if not sale:
        return None
    items = conn.execute("SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id", (sale_id,)).fetchall()
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
    payment_rows = conn.execute("SELECT method, amount FROM sale_payments WHERE sale_id = ? ORDER BY id", (sale_id,)).fetchall()
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
