#!/usr/bin/env python3
"""Crea productos y ventas ficticios coherentes con cada tipo de negocio.

Uso solo en desarrollo:
    python scripts/seed_fake_sales_products.py --allow-demo-data
Opciones:
    --business ID     limita la generación a un negocio (id o slug, p. ej. DEMO-RETAIL-001)
    --days N          días de historial de ventas (por defecto 90)
    --seed N          semilla aleatoria para que la generación sea reproducible (42)
    --db RUTA         base SQLite alternativa a la configurada

Es idempotente: al volver a ejecutar solo añade los registros que faltan; nunca
borra ni modifica datos existentes. Está bloqueado cuando APP_ENV / MANAGER_STOCK_ENV
indican producción.
"""
from __future__ import annotations

import argparse
import os
import random
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Catálogos por tipo de negocio: (nombre, categoría, precio, costo, unidad, stock inicial, stock mínimo).
# Precios en COP, coherentes con los productos de demostración del seed oficial.
CATALOGS: dict[str, list[tuple[str, str, float, float, str, float, float]]] = {
    "retail": [
        ("Gaseosa cola 400 ml", "Bebidas", 4500, 2700, "unidad", 96, 12),
        ("Agua mineral 600 ml", "Bebidas", 3000, 1600, "unidad", 120, 15),
        ("Jugo de naranja 1 L", "Bebidas", 6500, 3900, "unidad", 48, 8),
        ("Té frío durazno 500 ml", "Bebidas", 4000, 2300, "unidad", 60, 10),
        ("Arroz blanco 1 kg", "Abarrotes", 4200, 3000, "unidad", 70, 10),
        ("Aceite vegetal 1 L", "Abarrotes", 9800, 7200, "unidad", 40, 6),
        ("Azúcar blanca 1 kg", "Abarrotes", 4500, 3200, "unidad", 55, 8),
        ("Café molido 250 g", "Abarrotes", 12500, 8900, "unidad", 36, 6),
        ("Pan tajado", "Abarrotes", 5500, 3400, "unidad", 30, 8),
        ("Leche entera 1 L", "Abarrotes", 4800, 3500, "unidad", 64, 10),
        ("Papas fritas 150 g", "Snacks", 5800, 3900, "unidad", 80, 12),
        ("Galletas surtidas", "Snacks", 3500, 2100, "unidad", 90, 12),
        ("Chocolate en barra", "Snacks", 4200, 2600, "unidad", 72, 10),
        ("Detergente líquido 1 L", "Limpieza", 8900, 6300, "unidad", 42, 6),
        ("Papel higiénico x4", "Limpieza", 7800, 5400, "unidad", 50, 8),
    ],
    "food": [
        ("Hamburguesa doble", "Hamburguesas", 24000, 12500, "unidad", 40, 6),
        ("Hamburguesa vegana", "Hamburguesas", 22000, 11800, "unidad", 30, 6),
        ("Salchipapa familiar", "Comidas rápidas", 19000, 9600, "unidad", 45, 8),
        ("Papas rústicas", "Comidas rápidas", 12000, 5400, "unidad", 60, 10),
        ("Nuggets x8", "Comidas rápidas", 14000, 7300, "unidad", 50, 8),
        ("Aros de cebolla", "Comidas rápidas", 9000, 4200, "unidad", 55, 8),
        ("Limonada natural 500 ml", "Bebidas", 6000, 2900, "unidad", 70, 10),
        ("Gaseosa 400 ml", "Bebidas", 4500, 2600, "unidad", 96, 12),
        ("Malteada de fresa", "Bebidas", 9500, 4700, "unidad", 40, 6),
        ("Café con leche", "Bebidas", 5000, 2300, "unidad", 60, 8),
        ("Brownie con helado", "Postres", 11000, 5300, "unidad", 35, 6),
        ("Helado en copa", "Postres", 8500, 4100, "unidad", 40, 6),
    ],
    "hotel": [
        ("Cerveza 330 ml", "Minibar", 8000, 4800, "unidad", 72, 10),
        ("Vino tinto copa", "Minibar", 18000, 10500, "unidad", 30, 6),
        ("Agua mineral 600 ml", "Minibar", 4500, 2200, "unidad", 96, 12),
        ("Snack mix", "Minibar", 9500, 5600, "unidad", 48, 8),
        ("Refresco lata", "Minibar", 5000, 2800, "unidad", 84, 10),
        ("Desayuno a la habitación", "Restaurante", 32000, 15500, "servicio", 60, 10),
        ("Cena para dos", "Restaurante", 68000, 33000, "servicio", 40, 8),
        ("Lavandería express", "Servicios", 25000, 9000, "servicio", 50, 8),
        ("Kit de aseo premium", "Recepción", 12000, 6400, "unidad", 45, 8),
        ("Toalla extra", "Recepción", 6000, 2500, "unidad", 60, 10),
    ],
    "warehouse": [
        ("Film plástico 500 m", "Empaque", 38000, 27000, "unidad", 45, 6),
        ("Cinta canela x6", "Empaque", 15000, 9800, "unidad", 60, 10),
        ("Caja corrugada mediana", "Empaque", 6500, 3900, "unidad", 200, 30),
        ("Etiquetas térmicas x500", "Empaque", 22000, 14500, "unidad", 40, 6),
        ("Guantes de nitrilo x100", "Seguridad", 45000, 31000, "unidad", 70, 12),
        ("Casco de seguridad", "Seguridad", 28000, 18500, "unidad", 35, 6),
        ("Camilla reflectiva", "Seguridad", 16000, 10200, "unidad", 50, 8),
        ("Resma papel carta", "Oficina", 18500, 13500, "unidad", 55, 8),
        ("Tóner impresora", "Oficina", 95000, 72000, "unidad", 20, 4),
        ("Archivador A4", "Oficina", 12000, 7800, "unidad", 65, 10),
    ],
    "services": [
        ("Corte de cabello", "Cabello", 25000, 5000, "servicio", 500, 0),
        ("Corte infantil", "Cabello", 18000, 3600, "servicio", 500, 0),
        ("Tinte completo", "Cabello", 60000, 18000, "servicio", 500, 0),
        ("Alisado", "Cabello", 120000, 42000, "servicio", 500, 0),
        ("Peinado", "Cabello", 30000, 6500, "servicio", 500, 0),
        ("Manicure", "Uñas", 30000, 6000, "servicio", 500, 0),
        ("Pedicure", "Uñas", 35000, 7500, "servicio", 500, 0),
        ("Acrílicas", "Uñas", 55000, 16000, "servicio", 500, 0),
        ("Tratamiento capilar", "Tratamientos", 45000, 14000, "servicio", 500, 0),
        ("Masaje relajante 30 min", "Tratamientos", 40000, 9000, "servicio", 500, 0),
    ],
}

FALLBACK_CATALOG: list[tuple[str, str, float, float, str, float, float]] = [
    ("Producto básico A", "General", 8000, 4800, "unidad", 60, 8),
    ("Producto básico B", "General", 12000, 7200, "unidad", 50, 8),
    ("Producto básico C", "General", 5500, 3300, "unidad", 80, 10),
    ("Insumo estándar", "Insumos", 18000, 12000, "unidad", 40, 6),
    ("Suministro premium", "Insumos", 35000, 24000, "unidad", 30, 5),
    ("Accesorio común", "Accesorios", 9500, 5700, "unidad", 70, 10),
    ("Consumible", "Consumibles", 6500, 3900, "unidad", 90, 12),
    ("Servicio estándar", "Servicios", 25000, 8000, "servicio", 400, 0),
]

CUSTOMERS = [
    "Cliente general", "María López", "Carlos Pérez", "Ana Gómez", "Luis Rodríguez",
    "Paula Martínez", "Jorge Hernández", "Sofía Ríos", "Andrés Vargas", "Laura Medina",
    "Diego Castillo", "Camila Ortiz",
]
PAYMENT_METHODS = ["cash", "card", "digital", "transfer"]
PAYMENT_WEIGHTS = [55, 25, 12, 8]
QTY_WEIGHTS = [60, 25, 10, 5]  # 1, 2, 3, 4 unidades
STATUS_CHOICES = ["completed", "pending", "cancelled"]
STATUS_WEIGHTS = [90, 5, 5]


def slugify(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "", value).upper() or "BIZ"


def ensure_products(conn, business_id: str, business_type: str, rng: random.Random) -> int:
    """Inserta el catálogo ficticio del negocio; devuelve cuántos productos creó."""
    catalog = CATALOGS.get(business_type, FALLBACK_CATALOG)
    slug = slugify(business_id)
    created = 0
    for index, (name, category, price, cost, unit, stock, min_stock) in enumerate(catalog, start=1):
        product_id = f"FAKE-PRD-{slug}-{index:03d}"
        sku = f"FAKE-{slug[:6]}-{index:03d}"
        cursor = conn.execute(
            """INSERT OR IGNORE INTO products
               (id,business_id,name,sku,category,price,cost,stock,min_stock,description,image,product_type,unit,active)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)""",
            (product_id, business_id, name, sku, category, price, cost, stock, min_stock,
             "Producto ficticio generado para pruebas locales.", "", "sale_item", unit),
        )
        created += cursor.rowcount
    return created


def load_sellable_products(conn, business_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT id,name,sku,price,cost,stock,min_stock,unit FROM products "
        "WHERE business_id=? AND active=1 AND product_type='sale_item' ORDER BY id",
        (business_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def restock_low_products(conn, business_id: str, stocks: dict[str, float], rng: random.Random) -> int:
    """Reposiciones ocasionales ('purchase') para que el historial nunca se quede sin stock."""
    restocked = 0
    for product_id, stock in stocks.items():
        row = conn.execute(
            "SELECT min_stock,unit FROM products WHERE id=? AND business_id=?", (product_id, business_id)
        ).fetchone()
        if not row or row["unit"] == "servicio":
            continue
        threshold = float(row["min_stock"]) * 1.5
        if stock > threshold or rng.random() > 0.18:
            continue
        delta = rng.randint(20, 80)
        before = stock
        after = before + delta
        conn.execute(
            "INSERT INTO inventory_movements (business_id,product_id,sale_id,movement_type,quantity_delta,stock_before,stock_after,note) "
            "VALUES (?,?,NULL,'purchase',?,?,?,?)",
            (business_id, product_id, delta, before, after, "Reposición ficticia (datos de prueba)"),
        )
        stocks[product_id] = after
        restocked += 1
    return restocked


def create_sale(
    conn,
    business: dict,
    day: date,
    index: int,
    hour: int,
    minute: int,
    stocks: dict[str, float],
    products: list[dict],
    created_by: str | None,
    rng: random.Random,
) -> bool:
    """Crea una venta ficticia completa con sus líneas, pago y movimientos."""
    key = f"fake-seed-{slugify(business['id'])}-{day.isoformat()}-{index:02d}"
    existing = conn.execute("SELECT 1 FROM sales WHERE business_id=? AND idempotency_key=?", (business["id"], key)).fetchone()
    if existing:
        return False

    # Selección de 1 a 4 productos con stock disponible.
    candidates = [p for p in products if stocks.get(p["id"], 0) >= 1]
    if not candidates:
        return False
    line_count = min(len(candidates), rng.choices([1, 2, 3, 4], weights=[45, 30, 17, 8])[0])
    chosen = rng.sample(candidates, line_count)

    lines: list[tuple[dict, float, float, float, float]] = []
    for product in chosen:
        available = stocks.get(product["id"], 0)
        qty = float(rng.choices([1, 2, 3, 4], weights=QTY_WEIGHTS)[0])
        qty = min(qty, available)
        if qty < 1:
            continue
        discount_pct = 10.0 if rng.random() < 0.12 else 0.0
        gross = round(product["price"] * qty, 2)
        discount = round(gross * discount_pct / 100, 2)
        line_total = round(gross - discount, 2)
        lines.append((product, qty, gross, discount, line_total))
    if not lines:
        return False

    subtotal = round(sum(line[2] for line in lines), 2)
    line_discount = round(sum(line[3] for line in lines), 2)
    global_discount = round(max(0.0, subtotal - line_discount) * (5.0 if rng.random() < 0.08 else 0.0) / 100, 2)
    taxable = max(0.0, round(subtotal - line_discount - global_discount, 2))
    tax_rate = float(business["tax_rate"] if business["tax_rate"] is not None else 0.19)
    tax = round(taxable * tax_rate, 2)
    total = round(taxable + tax, 2)
    if total <= 0:
        return False

    status = rng.choices(STATUS_CHOICES, weights=STATUS_WEIGHTS)[0]
    payment = rng.choices(PAYMENT_METHODS, weights=PAYMENT_WEIGHTS)[0]
    sale_id = f"FAKE-VTA-{slugify(business['id'])}-{day.strftime('%Y%m%d')}-{index:02d}"
    created_at = f"{day.isoformat()}T{hour:02d}:{minute:02d}:00-05:00"  # hora local de Colombia

    conn.execute(
        """INSERT INTO sales (id,business_id,idempotency_key,customer,payment_method,currency,subtotal,line_discount,
                              global_discount,tax_rate,tax,total,status,created_by,cash_session_id,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)""",
        (sale_id, business["id"], key, rng.choice(CUSTOMERS), payment, business["currency"] or "COP",
         subtotal, line_discount, global_discount, tax_rate, tax, total, status, created_by, created_at),
    )
    conn.execute("INSERT INTO sale_payments (sale_id,method,amount) VALUES (?,?,?)", (sale_id, payment, total))

    for product, qty, _gross, discount, line_total in lines:
        conn.execute(
            """INSERT INTO sale_items (sale_id,product_id,product_name,sku_snapshot,quantity,unit_price,
                                       unit_cost_snapshot,discount_percent,line_total)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (sale_id, product["id"], product["name"], product["sku"], qty, product["price"],
             round(float(product["cost"] or 0), 4), discount, line_total),
        )
        # Solo las ventas completadas descuentan stock (igual que la API real).
        if status == "completed":
            before = stocks[product["id"]]
            after = round(before - qty, 4)
            stocks[product["id"]] = after
            conn.execute("UPDATE products SET stock=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (after, product["id"]))
            conn.execute(
                "INSERT INTO inventory_movements (business_id,product_id,sale_id,movement_type,quantity_delta,stock_before,stock_after,note) "
                "VALUES (?,?,?,'sale',?,?,?,?)",
                (business["id"], product["id"], sale_id, -qty, before, after, f"Venta ficticia {sale_id}"),
            )
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Crea productos y ventas ficticios de desarrollo.")
    parser.add_argument("--allow-demo-data", action="store_true", help="Confirma explícitamente que deseas añadir datos ficticios.")
    parser.add_argument("--db", type=str, default=None, help="Ruta a una base SQLite de desarrollo.")
    parser.add_argument("--business", type=str, default=None, help="Id o slug de un negocio concreto.")
    parser.add_argument("--days", type=int, default=90, help="Días de historial de ventas (por defecto 90).")
    parser.add_argument("--seed", type=int, default=42, help="Semilla para generar los mismos datos en cada ejecución.")
    args = parser.parse_args()

    env_name = os.getenv("MANAGER_STOCK_ENV", os.getenv("APP_ENV", "development")).lower()
    if env_name in {"prod", "production"}:
        print("ERROR: la generación de datos ficticios está bloqueada en producción.", file=sys.stderr)
        return 2
    if not args.allow_demo_data:
        parser.error("Debes incluir --allow-demo-data para confirmar la creación de registros ficticios.")
    if args.days < 1:
        parser.error("--days debe ser mayor que cero.")
    if args.db:
        db_path = Path(args.db).expanduser().resolve()
        db_path.parent.mkdir(parents=True, exist_ok=True)
        os.environ["MANAGER_STOCK_DB"] = str(db_path)

    sys.path.insert(0, str(ROOT))
    from backend.main import connection  # noqa: PLC0415

    rng = random.Random(args.seed)
    schema = (ROOT / "database" / "schema.sql").read_text(encoding="utf-8")

    # "Hoy" en Colombia (UTC-5): las ventas se fechan con hora local para que el
    # Dashboard (que compara fechas UTC con la fecha de Colombia) las cuente bien.
    now_colombia = datetime.now(timezone.utc) - timedelta(hours=5)
    today = now_colombia.date()

    with connection() as conn:
        conn.executescript(schema)
        query = "SELECT id,name,business_type,currency,tax_rate FROM businesses"
        params: tuple = ()
        if args.business:
            query += " WHERE id=? OR lower(id)=lower(?)"
            params = (args.business, args.business)
        businesses = [dict(row) for row in conn.execute(query, params).fetchall()]
        if not businesses:
            print("No se encontró ningún negocio con ese identificador.", file=sys.stderr)
            return 1

        total_products = total_sales = 0
        for business in businesses:
            created_products = ensure_products(conn, business["id"], business["business_type"], rng)
            products = load_sellable_products(conn, business["id"])
            if not products:
                print(f"{business['name']}: sin productos; se omite.")
                continue
            stocks = {p["id"]: float(p["stock"]) for p in products}
            owner = conn.execute(
                "SELECT id FROM auth_users WHERE business_id=? AND role IN ('owner','business_admin') ORDER BY role='owner' DESC LIMIT 1",
                (business["id"],),
            ).fetchone()
            created_by = owner["id"] if owner else None

            created_sales = 0
            for offset in range(args.days):
                day = today - timedelta(days=offset)
                count = rng.choices([0, 1, 2, 3, 4, 5, 6], weights=[5, 20, 25, 20, 15, 10, 5])[0]
                if day.weekday() >= 5:  # fin de semana
                    if business["business_type"] == "warehouse":
                        if rng.random() < 0.7:
                            continue
                    else:
                        count = round(count * 1.3)
                if offset == 0:  # hoy siempre muestra actividad en el Dashboard
                    count = max(count, 2)
                if count == 0:
                    continue
                restock_low_products(conn, business["id"], stocks, rng)
                for index in range(1, count + 1):
                    hour = rng.choices(range(8, 21), weights=[2, 3, 5, 7, 9, 10, 10, 9, 8, 7, 6, 5, 4])[0]
                    minute = rng.randint(0, 59)
                    if offset == 0:  # no crear ventas en el futuro de "hoy"
                        hour = min(hour, now_colombia.hour)
                        if hour == now_colombia.hour:
                            minute = min(minute, now_colombia.minute)
                    if create_sale(conn, business, day, index, hour, minute, stocks, products, created_by, rng):
                        created_sales += 1

            total_products += created_products
            total_sales += created_sales
            print(f"{business['name']}: +{created_products} productos, +{created_sales} ventas (historial de {args.days} días)")

        print(f"\nTotal: {total_products} productos y {total_sales} ventas ficticias añadidas.")
        print(f"Base de datos: {os.getenv('MANAGER_STOCK_DB', str(ROOT / 'backend' / 'data' / 'manager_stock.db'))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
