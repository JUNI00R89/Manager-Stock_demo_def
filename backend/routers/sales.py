from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from backend.core.config import CURRENCY, DEFAULT_TAX_RATE
from backend.core.context import current_business_id, current_identity
from backend.core.db import audit, connection
from backend.schemas import PaymentPartPayload, SaleItemPayload, SalePayload
from backend.services.inventory import allows_negative_stock, consume_product_stock, recipe_ingredient_usage, recipe_unit_cost, reverse_movements, validate_product_quantity
from backend.services.sales import get_sale


router = APIRouter()


@router.get("/api/sales")
def list_sales(search: str = "", status: str | None = None, limit: int = Query(default=500, ge=1, le=500), offset: int = Query(default=0, ge=0)):
    query = "SELECT id FROM sales WHERE business_id = ?"
    params: list = [current_business_id()]
    if current_identity()["role"] == "cashier":
        query += " AND created_by = ?"
        params.append(current_identity()["id"])
    if status and status in {"completed", "pending", "cancelled"}:
        query += " AND status = ?"
        params.append(status)
    if search:
        query += " AND (lower(id) LIKE ? OR lower(customer) LIKE ?)"
        term = f"%{search.lower()}%"
        params.extend([term, term])
    query += " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    with connection() as conn:
        ids = [row["id"] for row in conn.execute(query, params).fetchall()]
        return [get_sale(conn, sale_id) for sale_id in ids]


@router.get("/api/sales/by-key/{idempotency_key}")
def sale_by_idempotency_key(idempotency_key: str):
    """Recover a committed sale after a network interruption without creating a duplicate."""
    with connection() as conn:
        if current_identity()["role"] == "cashier":
            row = conn.execute("SELECT id FROM sales WHERE business_id=? AND idempotency_key=? AND created_by=?", (current_business_id(), idempotency_key, current_identity()["id"])).fetchone()
        else:
            row = conn.execute("SELECT id FROM sales WHERE business_id=? AND idempotency_key=?", (current_business_id(), idempotency_key)).fetchone()
        if not row:
            raise HTTPException(404, "No existe una venta con esa clave de operación.")
        return get_sale(conn, row["id"])


@router.get("/api/sales/{sale_id}")
def sale_detail(sale_id: str):
    with connection() as conn:
        if current_identity()["role"] == "cashier":
            owned = conn.execute("SELECT id FROM sales WHERE id=? AND business_id=? AND created_by=?", (sale_id, current_business_id(), current_identity()["id"])).fetchone()
            if not owned:
                raise HTTPException(404, "Venta no encontrada.")
        sale = get_sale(conn, sale_id)
        if not sale:
            raise HTTPException(404, "Venta no encontrada.")
        return sale


@router.post("/api/sales", status_code=201)
def create_sale(payload: SalePayload):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute("SELECT id FROM sales WHERE business_id=? AND idempotency_key=?", (current_business_id(), payload.idempotencyKey)).fetchone()
        if existing:
            conn.commit()
            return get_sale(conn, existing["id"])
        if current_identity()["role"] == "cashier" and not payload.cashSessionId:
            conn.rollback()
            raise HTTPException(409, "Abre tu turno de caja antes de registrar una venta.")
        if payload.cashSessionId:
            if current_identity()["role"] == "cashier":
                active_session = conn.execute("SELECT id FROM cash_sessions WHERE id=? AND business_id=? AND status='open' AND opened_by_user_id=?", (payload.cashSessionId, current_business_id(), current_identity()["id"])).fetchone()
            else:
                active_session = conn.execute("SELECT id FROM cash_sessions WHERE id=? AND business_id=? AND status='open'", (payload.cashSessionId, current_business_id())).fetchone()
            if not active_session:
                conn.rollback()
                raise HTTPException(409, "La caja seleccionada no está abierta o no pertenece a tu turno.")
        business_settings = conn.execute("SELECT currency,tax_rate FROM businesses WHERE id=?", (current_business_id(),)).fetchone()
        if not business_settings:
            conn.rollback()
            raise HTTPException(404, "No se encontró la configuración del negocio.")
        sale_currency = business_settings["currency"] or CURRENCY
        sale_tax_rate = float(business_settings["tax_rate"] if business_settings["tax_rate"] is not None else DEFAULT_TAX_RATE)

        # Resolve linked orders under the same write lock as the sale. Clients
        # supply only extra items; order lines and ownership come from SQLite.
        if payload.orderIds and payload.status != "completed":
            raise HTTPException(422, "El cobro de pedidos debe ser una venta completada.")
        linked_orders = []
        items = list(payload.items)
        for order_id in dict.fromkeys(payload.orderIds):
            order = conn.execute("SELECT * FROM orders WHERE id=? AND business_id=?", (order_id, current_business_id())).fetchone()
            if not order:
                raise HTTPException(404, "Pedido no encontrado.")
            if order["sale_id"] or order["status"] in {"cancelled", "delivered"}:
                raise HTTPException(409, "El pedido ya fue cobrado o cerrado.")
            linked_orders.append(order)
            items.extend(SaleItemPayload(productId=row["product_id"], quantity=row["quantity"]) for row in conn.execute("SELECT product_id,quantity FROM order_items WHERE order_id=?", (order_id,)))
            if order["stock_consumed"]:
                movements = conn.execute("SELECT * FROM inventory_movements WHERE order_id=? AND movement_type IN ('consumption','recipe_consumption') ORDER BY id", (order_id,)).fetchall()
                reverse_movements(conn, movements, f"Traslado a venta del pedido {order_id}", "adjustment")
        if not items:
            raise HTTPException(422, "Agrega al menos un producto o pedido a la venta.")
        payload = payload.model_copy(update={"items": items})

        product_rows: dict[str, sqlite3.Row] = {}
        quantities_by_product: dict[str, float] = {}
        for item in payload.items:
            quantities_by_product[item.productId] = quantities_by_product.get(item.productId, 0.0) + item.quantity
        direct_requirements: dict[str, float] = {}
        ingredient_requirements: dict[str, float] = {}
        for product_id, requested_quantity in quantities_by_product.items():
            product = conn.execute("SELECT * FROM products WHERE id=? AND business_id=? AND active=1", (product_id, current_business_id())).fetchone()
            if not product:
                conn.rollback()
                raise HTTPException(404, f"No se encontró el producto {product_id}.")
            if product["product_type"] != "sale_item":
                conn.rollback()
                raise HTTPException(400, f"{product['name']} está marcado como ingrediente y no se puede vender directamente.")
            validate_product_quantity(product, requested_quantity)
            product_rows[product_id] = product
            recipe = conn.execute("SELECT id FROM recipes WHERE business_id=? AND product_id=?", (current_business_id(), product_id)).fetchone()
            if recipe:
                for ingredient_id, usage_quantity in recipe_ingredient_usage(conn, product_id, requested_quantity).items():
                    ingredient_requirements[ingredient_id] = round(ingredient_requirements.get(ingredient_id, 0.0) + usage_quantity, 6)
            else:
                direct_requirements[product_id] = round(direct_requirements.get(product_id, 0.0) + requested_quantity, 6)

        # Validate the combined physical requirement (direct sales + recipe ingredients) before writing anything.
        allow_negative = allows_negative_stock(conn)
        if not allow_negative:
            combined_requirements: dict[str, float] = {}
            for product_id, quantity in {**direct_requirements}.items():
                combined_requirements[product_id] = round(combined_requirements.get(product_id, 0.0) + quantity, 6)
            for product_id, quantity in ingredient_requirements.items():
                combined_requirements[product_id] = round(combined_requirements.get(product_id, 0.0) + quantity, 6)
            for product_id, required_quantity in combined_requirements.items():
                product = product_rows.get(product_id)
                if not product:
                    product = conn.execute("SELECT * FROM products WHERE id=? AND business_id=?", (product_id, current_business_id())).fetchone()
                    if product:
                        product_rows[product_id] = product
                if not product:
                    conn.rollback()
                    raise HTTPException(404, f"No se encontró el producto {product_id}.")
                available = float(product["stock"] or 0)
                if available + 1e-9 < required_quantity:
                    conn.rollback()
                    raise HTTPException(409, f"Stock insuficiente para {product['name']}. Disponible: {available:g}; solicitado: {required_quantity:g}.")

        subtotal = 0.0
        line_discount = 0.0
        resolved_items = []
        for item in payload.items:
            product = product_rows[item.productId]
            validate_product_quantity(product, item.quantity)
            gross = round(product["price"] * item.quantity, 2)
            disc = round(gross * (item.discountPercent / 100), 2)
            line_total = round(gross - disc, 2)
            subtotal += gross
            line_discount += disc
            resolved_items.append((item, product, gross, disc, line_total))
        subtotal = round(subtotal, 2)
        line_discount = round(line_discount, 2)
        after_line_discount = max(0, round(subtotal - line_discount, 2))
        global_discount = round(after_line_discount * payload.globalDiscountPercent / 100, 2)
        taxable = max(0, round(after_line_discount - global_discount, 2))
        tax = round(taxable * sale_tax_rate, 2)
        total = round(taxable + tax, 2)
        payment_parts = payload.payments
        if payload.paymentMethod == "split" and not payment_parts:
            conn.rollback()
            raise HTTPException(422, "Para pago dividido debes indicar los importes de cada método de pago.")
        if payment_parts and abs(sum(part.amount for part in payment_parts) - total) > 0.02:
            conn.rollback()
            raise HTTPException(422, "La suma de los métodos de pago debe coincidir con el total de la venta.")
        if not payment_parts and payload.paymentMethod != "split":
            payment_parts = [PaymentPartPayload(method=payload.paymentMethod if payload.paymentMethod != "split" else "cash", amount=total)]
        now = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
        sale_id = f"VTA-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
        conn.execute(
            """INSERT INTO sales (id,business_id,idempotency_key,customer,payment_method,currency,subtotal,line_discount,global_discount,tax_rate,tax,total,status,created_by,cash_session_id,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (sale_id, current_business_id(), payload.idempotencyKey, payload.customer.strip() or "Cliente general", payload.paymentMethod,
             sale_currency, subtotal, line_discount, global_discount, sale_tax_rate, tax, total, payload.status, current_identity()["id"], payload.cashSessionId, now),
        )
        for part in payment_parts:
            conn.execute("INSERT INTO sale_payments (sale_id,method,amount) VALUES (?,?,?)", (sale_id, part.method, part.amount))
        recipe_costs = {product_id: recipe_unit_cost(conn, product_id) for product_id in quantities_by_product}
        for item, product, gross, disc, line_total in resolved_items:
            # Preserve unit cost at transaction time; later catalog edits must not rewrite past margins.
            # Recipe-based products snapshot the cost of their ingredients instead of the sale item's own cost.
            recipe_cost = recipe_costs.get(item.productId)
            unit_cost = float(recipe_cost if recipe_cost is not None else (product["cost"] or 0))
            conn.execute(
                """INSERT INTO sale_items (sale_id,product_id,product_name,sku_snapshot,quantity,unit_price,unit_cost_snapshot,discount_percent,line_total)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (sale_id, item.productId, product["name"], product["sku"], item.quantity, product["price"], round(unit_cost, 4), item.discountPercent, line_total),
            )
        # Deduct physical stock once per product. Recipe products consume their ingredients instead of the product itself.
        for product_id, quantity in direct_requirements.items():
            product = conn.execute("SELECT * FROM products WHERE id=? AND business_id=?", (product_id, current_business_id())).fetchone()
            if product:
                consume_product_stock(
                    conn, product, quantity, movement_type="sale", note=f"Venta {sale_id}",
                    sale_id=sale_id, reference_type="sale", reference_id=sale_id, allow_negative=allow_negative,
                )
        for product_id, quantity in ingredient_requirements.items():
            product = conn.execute("SELECT * FROM products WHERE id=? AND business_id=?", (product_id, current_business_id())).fetchone()
            if product:
                consume_product_stock(
                    conn, product, quantity, movement_type="recipe_consumption",
                    note=f"Consumo de receta · venta {sale_id}", sale_id=sale_id,
                    reference_type="sale", reference_id=sale_id, allow_negative=allow_negative,
                )

        for order in linked_orders:
            conn.execute("UPDATE orders SET sale_id=?,status='delivered',stock_consumed=0,updated_at=CURRENT_TIMESTAMP WHERE id=?", (sale_id, order["id"]))
        audit(conn, "create", "sale", sale_id, {"total": total, "items": len(resolved_items), "taxRate": sale_tax_rate, "paymentMethod": payload.paymentMethod})
        conn.commit()
        return get_sale(conn, sale_id)


@router.post("/api/sales/{sale_id}/cancel")
def cancel_sale(sale_id: str):
    with connection() as conn:
        conn.execute("BEGIN IMMEDIATE")
        sale = conn.execute("SELECT * FROM sales WHERE id=? AND business_id=?", (sale_id, current_business_id())).fetchone()
        if not sale:
            conn.rollback()
            raise HTTPException(404, "Venta no encontrada.")
        if sale["status"] == "cancelled":
            conn.commit()
            return get_sale(conn, sale_id)
        movements = conn.execute(
            "SELECT * FROM inventory_movements WHERE sale_id=? AND movement_type IN ('sale','recipe_consumption') ORDER BY id",
            (sale_id,),
        ).fetchall()
        reverse_movements(conn, movements, f"Reversión de venta {sale_id}", "sale_cancelled")
        conn.execute("UPDATE sales SET status='cancelled' WHERE id=?", (sale_id,))
        audit(conn, "cancel", "sale", sale_id, {"restoredMovements": len(movements)})
        conn.commit()
        return get_sale(conn, sale_id)
