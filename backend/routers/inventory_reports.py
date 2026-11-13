from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.core.context import current_business_id
from backend.core.db import audit, connection, timestamp_iso
from backend.routers.inventory import inventory_movements, list_inventory_lots
from backend.services.inventory import WASTE_REASON_LABELS, convert_quantity, fetch_inventory_product, inventory_product_out, inventory_settings, recipe_unit_cost


router = APIRouter()


@router.get("/api/inventory/overview")
def inventory_overview():
    with connection() as conn:
        settings = inventory_settings(conn)
        alert_days = int(settings["expiryAlertDays"])
        rows = conn.execute(
            """SELECT p.*, s.company AS supplier_name FROM products p
               LEFT JOIN suppliers s ON s.id=p.supplier_id
               WHERE p.business_id=? AND p.active=1 ORDER BY p.name COLLATE NOCASE""",
            (current_business_id(),),
        ).fetchall()
        products = [inventory_product_out(row, alert_days) for row in rows]
        total_value = round(sum(product["stockValue"] for product in products), 2)
        total_retail = round(sum(product["retailValue"] for product in products), 2)
        total_units = round(sum(product["stock"] for product in products), 6)
        low_stock = [product for product in products if product["stockStatus"] in ("low", "out", "negative")]
        expiring = list_inventory_lots(status="por_vencer")
        expired = list_inventory_lots(status="vencido")
        recent = inventory_movements(limit=12)
        return {
            "totalValue": total_value, "totalRetailValue": total_retail, "totalUnits": total_units,
            "productCount": len(products), "lowStockCount": len(low_stock),
            "outOfStockCount": len([product for product in products if product["stockStatus"] == "out"]),
            "negativeStockCount": len([product for product in products if product["stockStatus"] == "negative"]),
            "expiringCount": len(expiring), "expiredCount": len(expired),
            "wasteCost": _waste_cost(conn, 30),
            "lowStockProducts": low_stock[:20], "expiringLots": expiring[:20],
            "recentMovements": recent, "settings": settings,
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }


def _waste_cost(conn: sqlite3.Connection, days: int) -> float:
    row = conn.execute(
        """SELECT COALESCE(SUM(ABS(quantity_delta) * unit_cost),0) FROM inventory_movements
           WHERE business_id=? AND movement_type='waste' AND created_at >= datetime('now', ?)""",
        (current_business_id(), f"-{int(days)} days"),
    ).fetchone()
    return round(float(row[0] or 0), 2)


@router.get("/api/inventory/alerts")
def inventory_alerts():
    with connection() as conn:
        settings = inventory_settings(conn)
        alert_days = int(settings["expiryAlertDays"])
        alerts: list[dict] = []
        rows = conn.execute(
            """SELECT p.*, s.company AS supplier_name FROM products p
               LEFT JOIN suppliers s ON s.id=p.supplier_id
               WHERE p.business_id=? AND p.active=1""",
            (current_business_id(),),
        ).fetchall()
        for row in rows:
            product = inventory_product_out(row, alert_days)
            if product["stock"] < 0:
                alerts.append({
                    "type": "negative_stock", "severity": "high", "productId": product["id"],
                    "productName": product["name"], "sku": product["sku"], "stock": product["stock"],
                    "minStock": product["minStock"], "unit": product["unit"],
                    "message": f"Stock negativo en {product['name']}: {product['stock']:g} {product['unit']}.",
                })
            elif product["stock"] <= 0:
                alerts.append({
                    "type": "out_of_stock", "severity": "high", "productId": product["id"],
                    "productName": product["name"], "sku": product["sku"], "stock": product["stock"],
                    "minStock": product["minStock"], "unit": product["unit"],
                    "message": f"{product['name']} está agotado.",
                })
            elif settings["lowStockAlerts"] and product["stock"] <= product["minStock"]:
                alerts.append({
                    "type": "low_stock", "severity": "medium", "productId": product["id"],
                    "productName": product["name"], "sku": product["sku"], "stock": product["stock"],
                    "minStock": product["minStock"], "unit": product["unit"],
                    "message": f"Stock bajo de {product['name']}: quedan {product['stock']:g} {product['unit']} (mínimo {product['minStock']:g}).",
                })
        for lot in list_inventory_lots(status="vencido"):
            alerts.append({
                "type": "expired_lot", "severity": "high", "productId": lot["productId"],
                "productName": lot["productName"], "sku": lot["sku"], "lotCode": lot["lotCode"],
                "expiryDate": lot["expiryDate"], "daysLeft": lot["daysLeft"], "quantity": lot["quantity"],
                "unit": lot["productUnit"],
                "message": f"Lote vencido de {lot['productName']} ({lot['lotCode']}): {lot['quantity']:g} {lot['productUnit']}.",
            })
        for lot in list_inventory_lots(status="por_vencer"):
            alerts.append({
                "type": "expiring_lot", "severity": "medium", "productId": lot["productId"],
                "productName": lot["productName"], "sku": lot["sku"], "lotCode": lot["lotCode"],
                "expiryDate": lot["expiryDate"], "daysLeft": lot["daysLeft"], "quantity": lot["quantity"],
                "unit": lot["productUnit"],
                "message": f"Lote de {lot['productName']} ({lot['lotCode']}) vence en {lot['daysLeft']} días.",
            })
        severity_order = {"high": 0, "medium": 1, "low": 2}
        alerts.sort(key=lambda alert: (severity_order.get(alert["severity"], 9), alert["type"], alert["productName"]))
        return {"generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "alerts": alerts}


@router.get("/api/inventory/price-history")
def inventory_price_history(productId: str | None = None, supplierId: str | None = None, limit: int = Query(default=200, ge=1, le=1000)):
    with connection() as conn:
        query = """SELECT h.*, p.name AS product_name, p.sku, p.unit AS product_unit,
                   s.company AS supplier_name
                   FROM supplier_price_history h JOIN products p ON p.id=h.product_id
                   LEFT JOIN suppliers s ON s.id=h.supplier_id
                   WHERE h.business_id=?"""
        params: list = [current_business_id()]
        if productId:
            query += " AND h.product_id=?"
            params.append(productId)
        if supplierId:
            query += " AND h.supplier_id=?"
            params.append(supplierId)
        query += " ORDER BY h.created_at DESC, h.id DESC LIMIT ?"
        params.append(limit)
        return [{
            "id": row["id"], "productId": row["product_id"], "productName": row["product_name"],
            "sku": row["sku"], "productUnit": row["product_unit"], "supplierId": row["supplier_id"],
            "supplierName": row["supplier_name"], "unitCost": float(row["unit_cost"] or 0),
            "source": row["source"], "referenceType": row["reference_type"], "referenceId": row["reference_id"],
            "createdBy": row["created_by"], "createdAt": timestamp_iso(row["created_at"]),
        } for row in conn.execute(query, params).fetchall()]


@router.get("/api/inventory/reports")
def inventory_reports(days: int = Query(default=30, ge=1, le=365), noMovementDays: int = Query(default=60, ge=1, le=3650)):
    with connection() as conn:
        settings = inventory_settings(conn)
        alert_days = int(settings["expiryAlertDays"])
        rows = conn.execute(
            """SELECT p.*, s.company AS supplier_name FROM products p
               LEFT JOIN suppliers s ON s.id=p.supplier_id
               WHERE p.business_id=? AND p.active=1""",
            (current_business_id(),),
        ).fetchall()
        products = [inventory_product_out(row, alert_days) for row in rows]
        total_value = round(sum(product["stockValue"] for product in products), 2)
        critical = [product for product in products if product["stockStatus"] in ("low", "out", "negative")]
        expiring = list_inventory_lots(status="por_vencer") + list_inventory_lots(status="vencido")

        waste_row = conn.execute(
            """SELECT COALESCE(SUM(ABS(quantity_delta) * unit_cost),0) FROM inventory_movements
               WHERE business_id=? AND movement_type='waste' AND created_at >= datetime('now', ?)""",
            (current_business_id(), f"-{days} days"),
        ).fetchone()
        waste_by_reason = [{
            "reasonCode": row["reason_code"] or "otro",
            "reasonLabel": WASTE_REASON_LABELS.get(row["reason_code"] or "otro", "Otro"),
            "quantity": round(float(row["quantity"] or 0), 6),
            "cost": round(float(row["cost"] or 0), 2),
        } for row in conn.execute(
            """SELECT o.reason_code, SUM(ABS(m.quantity_delta)) AS quantity,
                      SUM(ABS(m.quantity_delta) * m.unit_cost) AS cost
               FROM inventory_movements m LEFT JOIN inventory_operations o ON o.id=m.operation_id
               WHERE m.business_id=? AND m.movement_type='waste' AND m.created_at >= datetime('now', ?)
               GROUP BY o.reason_code ORDER BY cost DESC""",
            (current_business_id(), f"-{days} days"),
        ).fetchall()]

        rotation = [{
            "productId": row["product_id"], "productName": row["product_name"], "sku": row["sku"],
            "unit": row["unit"], "quantity": round(float(row["quantity"] or 0), 6),
            "cost": round(float(row["cost"] or 0), 2), "movements": int(row["movement_count"] or 0),
        } for row in conn.execute(
            """SELECT m.product_id, p.name AS product_name, p.sku, p.unit,
                      SUM(ABS(m.quantity_delta)) AS quantity,
                      SUM(ABS(m.quantity_delta) * m.unit_cost) AS cost,
                      COUNT(*) AS movement_count
               FROM inventory_movements m JOIN products p ON p.id=m.product_id
               WHERE m.business_id=? AND m.quantity_delta < 0
                 AND m.movement_type IN ('sale','recipe_consumption','consumption','waste')
                 AND m.created_at >= datetime('now', ?)
               GROUP BY m.product_id ORDER BY quantity DESC LIMIT 50""",
            (current_business_id(), f"-{days} days"),
        ).fetchall()]

        cutoff = f"-{noMovementDays} days"
        no_movement = [{
            "productId": row["id"], "productName": row["name"], "sku": row["sku"],
            "stock": float(row["stock"] or 0), "unit": row["unit"],
            "lastMovementAt": timestamp_iso(row["last_movement"]),
        } for row in conn.execute(
            """SELECT p.id,p.name,p.sku,p.stock,p.unit,MAX(m.created_at) AS last_movement
               FROM products p LEFT JOIN inventory_movements m ON m.product_id=p.id
               WHERE p.business_id=? AND p.active=1
               GROUP BY p.id
               HAVING MAX(m.created_at) IS NULL OR MAX(m.created_at) < datetime('now', ?)
               ORDER BY p.name COLLATE NOCASE""",
            (current_business_id(), cutoff),
        ).fetchall()]

        count_differences = [{
            "countId": row["count_id"], "productId": row["product_id"], "productName": row["product_name"],
            "sku": row["sku"] or "",
            "systemQuantity": float(row["system_quantity"] or 0),
            "countedQuantity": float(row["counted_quantity"] or 0),
            "difference": float(row["difference"] or 0), "unit": row["unit"],
            "createdAt": timestamp_iso(row["created_at"]),
        } for row in conn.execute(
            """SELECT pci.*, p.name AS product_name, p.sku, p.unit
               FROM physical_count_items pci JOIN products p ON p.id=pci.product_id
               JOIN physical_counts pc ON pc.id=pci.count_id
               WHERE pc.business_id=? AND pc.created_at >= datetime('now','-90 days')
                 AND ABS(pci.difference) > 0.000001
               ORDER BY pc.created_at DESC, pci.id DESC LIMIT 100""",
            (current_business_id(),),
        ).fetchall()]

        return {
            "totalValue": total_value, "totalUnits": round(sum(product["stock"] for product in products), 6),
            "productCount": len(products), "criticalStock": critical, "criticalStockCount": len(critical),
            "expiringItems": expiring, "expiringCount": len(expiring),
            "wasteCost": round(float(waste_row[0] or 0), 2), "wasteByReason": waste_by_reason,
            "rotation": rotation, "noMovement": no_movement, "countDifferences": count_differences,
            "periodDays": days, "noMovementDays": noMovementDays,
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }


@router.get("/api/inventory/replenishment")
def inventory_replenishment():
    with connection() as conn:
        rows = conn.execute(
            """SELECT p.*, s.company AS supplier_name,
                      (SELECT h.unit_cost FROM supplier_price_history h WHERE h.product_id=p.id AND h.business_id=p.business_id ORDER BY h.created_at DESC, h.id DESC LIMIT 1) AS last_cost
               FROM products p LEFT JOIN suppliers s ON s.id=p.supplier_id
               WHERE p.business_id=? AND p.active=1 AND p.stock <= p.min_stock
               ORDER BY (p.stock - p.min_stock) ASC, p.name COLLATE NOCASE""",
            (current_business_id(),),
        ).fetchall()
        result = []
        for row in rows:
            stock = float(row["stock"] or 0)
            min_stock = float(row["min_stock"] or 0)
            suggested = max(1.0, round(min_stock * 2 - stock, 6))
            last_cost = float(row["last_cost"] if row["last_cost"] is not None else row["cost"] or 0)
            result.append({
                **inventory_product_out(row),
                "suggestedQuantity": suggested, "lastCost": last_cost,
                "estimatedCost": round(suggested * last_cost, 2),
            })
        return result


@router.get("/api/inventory/dish-costing")
def inventory_dish_costing():
    with connection() as conn:
        rows = conn.execute(
            """SELECT r.*, p.name AS product_name, p.price, p.unit AS product_unit
               FROM recipes r JOIN products p ON p.id=r.product_id
               WHERE r.business_id=? ORDER BY p.name COLLATE NOCASE""",
            (current_business_id(),),
        ).fetchall()
        result = []
        for row in rows:
            cost = recipe_unit_cost(conn, row["product_id"]) or 0.0
            price = float(row["price"] or 0)
            ingredients = []
            for item in conn.execute(
                """SELECT ri.ingredient_id,ri.quantity,ri.unit,p.name,p.unit AS product_unit,p.cost
                   FROM recipe_items ri JOIN products p ON p.id=ri.ingredient_id WHERE ri.recipe_id=?""",
                (row["id"],),
            ).fetchall():
                converted = convert_quantity(float(item["quantity"] or 0), item["unit"], item["product_unit"]) if item["unit"] else float(item["quantity"] or 0)
                ingredients.append({
                    "ingredientId": item["ingredient_id"], "name": item["name"],
                    "quantity": float(item["quantity"] or 0), "unit": item["unit"] or item["product_unit"],
                    "baseQuantity": converted, "productUnit": item["product_unit"],
                    "unitCost": float(item["cost"] or 0), "cost": round(converted * float(item["cost"] or 0), 4),
                })
            margin = round(price - cost, 2)
            result.append({
                "recipeId": row["id"], "productId": row["product_id"], "productName": row["product_name"],
                "yieldQuantity": float(row["yield_quantity"] or 1), "cost": cost, "price": price,
                "margin": margin, "marginPercent": round((margin / price * 100) if price else 0, 2),
                "ingredients": ingredients,
            })
        return result


class ProductSubstitutionPayload(BaseModel):
    productId: str
    substituteId: str
    priority: int = Field(default=1, ge=1, le=999)
    notes: str = Field(default="", max_length=500)


@router.get("/api/inventory/substitutions")
def list_product_substitutions(productId: str | None = None):
    with connection() as conn:
        query = """SELECT ps.*, p.name AS product_name, s.name AS substitute_name, s.stock AS substitute_stock, s.unit AS substitute_unit
                   FROM product_substitutions ps
                   JOIN products p ON p.id=ps.product_id
                   JOIN products s ON s.id=ps.substitute_id
                   WHERE ps.business_id=?"""
        params: list = [current_business_id()]
        if productId:
            query += " AND ps.product_id=?"
            params.append(productId)
        rows = conn.execute(query + " ORDER BY ps.product_id, ps.priority, s.name", params).fetchall()
        return [{
            "productId": row["product_id"], "productName": row["product_name"],
            "substituteId": row["substitute_id"], "substituteName": row["substitute_name"],
            "substituteStock": float(row["substitute_stock"] or 0), "substituteUnit": row["substitute_unit"],
            "priority": int(row["priority"] or 1), "notes": row["notes"],
        } for row in rows]


@router.post("/api/inventory/substitutions", status_code=201)
def save_product_substitution(payload: ProductSubstitutionPayload):
    if payload.productId == payload.substituteId:
        raise HTTPException(422, "Un producto no puede ser sustituto de sí mismo.")
    with connection() as conn:
        fetch_inventory_product(conn, payload.productId)
        fetch_inventory_product(conn, payload.substituteId)
        conn.execute(
            """INSERT INTO product_substitutions (business_id,product_id,substitute_id,priority,notes)
               VALUES (?,?,?,?,?)
               ON CONFLICT(business_id,product_id,substitute_id)
               DO UPDATE SET priority=excluded.priority, notes=excluded.notes""",
            (current_business_id(), payload.productId, payload.substituteId, payload.priority, payload.notes.strip()),
        )
        audit(conn, "upsert", "product_substitution", f"{payload.productId}:{payload.substituteId}")
        return {"ok": True, "productId": payload.productId, "substituteId": payload.substituteId}


@router.delete("/api/inventory/substitutions/{product_id}/{substitute_id}")
def delete_product_substitution(product_id: str, substitute_id: str):
    with connection() as conn:
        cur = conn.execute(
            "DELETE FROM product_substitutions WHERE business_id=? AND product_id=? AND substitute_id=?",
            (current_business_id(), product_id, substitute_id),
        )
        if not cur.rowcount:
            raise HTTPException(404, "Sustituto no encontrado.")
        audit(conn, "delete", "product_substitution", f"{product_id}:{substitute_id}")
        return {"ok": True}
