#!/usr/bin/env python3
"""Create idempotent local demo tenants for Manager Stock.

Run only in a development database:
    python scripts/seed_demo_data.py --allow-demo-data
Optionally select a separate database:
    python scripts/seed_demo_data.py --allow-demo-data --db backend/data/manager_stock_demo.db
The script never clears or resets existing records.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser(description="Crea negocios y cuentas ficticias de demostración.")
    parser.add_argument("--allow-demo-data", action="store_true", help="Confirma explícitamente que deseas añadir datos ficticios.")
    parser.add_argument("--db", type=str, default=None, help="Ruta a una base SQLite de desarrollo; evita usar una base de producción.")
    args = parser.parse_args()
    env_name = os.getenv("MANAGER_STOCK_ENV", os.getenv("APP_ENV", "development")).lower()
    if env_name in {"prod", "production"}:
        print("ERROR: el seed de demostración está bloqueado en producción.", file=sys.stderr)
        return 2
    if not args.allow_demo_data:
        parser.error("Debes incluir --allow-demo-data para confirmar la creación de registros ficticios.")
    if args.db:
        db_path = Path(args.db).expanduser().resolve()
        db_path.parent.mkdir(parents=True, exist_ok=True)
        os.environ["MANAGER_STOCK_DB"] = str(db_path)

    sys.path.insert(0, str(ROOT))
    from backend.main import connection, hash_password, timestamp_iso  # noqa: PLC0415

    schema = (ROOT / "database" / "schema.sql").read_text(encoding="utf-8")
    # Import's DB_PATH is already set after processing --db above.
    from backend.main import SCHEMA_PATH  # noqa: PLC0415

    businesses = [
        {
            "slug": "retail", "id": "DEMO-RETAIL-001", "name": "Tienda Aurora (Demo)", "db_type": "retail", "type": "retail",
            "owner": ("owner.retail@managerstock.test", "Propietario Tienda Demo", "TiendaDemo2026!"),
            "employee": ("empleado.retail@managerstock.test", "Empleado Tienda Demo", "EmpleadoTienda2026!"),
            "category": "Bebidas", "sku": "DEMO-RET-001", "product": "Agua mineral 600 ml", "price": 3000, "cost": 1200, "stock": 48, "min_stock": 10,
            "supplier": "Distribuciones Aurora", "features": {"inventory": True, "pos": True, "reservations": False, "tables": False, "rooms": False, "warehouse": False, "services": False, "delivery": False},
            "theme": {"primary": "#28566B", "secondary": "#789889", "accent": "#9BBFAD", "background": "#F5F7F8", "surface": "#FFFFFF", "lightBackground": "#F5F7F8", "lightSurface": "#FFFFFF", "darkBackground": "#111C24", "darkSurface": "#1B2A33", "mode": "light", "customized": False},
        },
        {
            "slug": "food", "id": "DEMO-FOOD-001", "name": "Sabores del Parque (Demo)", "db_type": "food", "type": "restaurant",
            "owner": ("owner.comidas@managerstock.test", "Propietario Comidas Demo", "ComidasDemo2026!"),
            "employee": ("empleado.comidas@managerstock.test", "Empleado Comidas Demo", "EmpleadoComidas2026!"),
            "category": "Hamburguesas", "sku": "DEMO-FOOD-001", "product": "Hamburguesa clásica", "price": 18000, "cost": 7200, "stock": 32, "min_stock": 8,
            "supplier": "Alimentos Sabores", "features": {"inventory": True, "pos": True, "reservations": False, "tables": True, "rooms": False, "warehouse": False, "services": False, "delivery": False},
            "foodConfig": {"serviceModes": ["mostrador", "para_llevar"], "foodTypes": ["hamburguesas", "variadas"], "activeModules": ["menu", "caja", "inventario", "pedidos", "mesas"], "displayLabel": "Negocio de comidas"},
            "theme": {"primary": "#A95F45", "secondary": "#C79658", "accent": "#DCA184", "background": "#FBF6F0", "surface": "#FFFFFF", "lightBackground": "#FBF6F0", "lightSurface": "#FFFFFF", "darkBackground": "#211914", "darkSurface": "#30241E", "mode": "light", "customized": False},
        },
        {
            "slug": "hotel", "id": "DEMO-HOTEL-001", "name": "Hotel Senderos (Demo)", "db_type": "hotel", "type": "hotel",
            "owner": ("owner.hotel@managerstock.test", "Propietario Hotel Demo", "HotelDemo2026!"),
            "employee": ("empleado.hotel@managerstock.test", "Recepción Hotel Demo", "EmpleadoHotel2026!"),
            "category": "Minibar", "sku": "DEMO-HOT-001", "product": "Kit de bienvenida", "price": 12000, "cost": 5000, "stock": 25, "min_stock": 5,
            "supplier": "Suministros Senderos", "features": {"inventory": True, "pos": True, "reservations": True, "tables": False, "rooms": True, "warehouse": False, "services": False, "delivery": False},
            "theme": {"primary": "#31584C", "secondary": "#A58B62", "accent": "#C7BCA6", "background": "#F7F5F0", "surface": "#FFFFFF", "lightBackground": "#F7F5F0", "lightSurface": "#FFFFFF", "darkBackground": "#151C19", "darkSurface": "#222E28", "mode": "light", "customized": False},
        },
        {
            "slug": "warehouse", "id": "DEMO-WAREHOUSE-001", "name": "Logística Norte (Demo)", "db_type": "warehouse", "type": "warehouse",
            "owner": ("owner.bodega@managerstock.test", "Propietario Bodega Demo", "BodegaDemo2026!"),
            "employee": ("empleado.bodega@managerstock.test", "Empleado Bodega Demo", "EmpleadoBodega2026!"),
            "category": "Mercancía", "sku": "DEMO-WHS-001", "product": "Caja de guantes de nitrilo", "price": 45000, "cost": 31000, "stock": 60, "min_stock": 12,
            "supplier": "Logística y Equipos Norte", "features": {"inventory": True, "pos": False, "reservations": False, "tables": False, "rooms": False, "warehouse": True, "services": False, "delivery": False},
            "theme": {"primary": "#34495E", "secondary": "#6F8797", "accent": "#94AAB7", "background": "#F3F6F8", "surface": "#FFFFFF", "lightBackground": "#F3F6F8", "lightSurface": "#FFFFFF", "darkBackground": "#111A22", "darkSurface": "#1C2933", "mode": "light", "customized": False},
        },
        {
            "slug": "services", "id": "DEMO-SERVICES-001", "name": "Estudio Nube (Demo)", "db_type": "services", "type": "services",
            "owner": ("owner.servicios@managerstock.test", "Propietario Servicios Demo", "ServiciosDemo2026!"),
            "employee": ("empleado.servicios@managerstock.test", "Profesional Demo", "EmpleadoServicios2026!"),
            "category": "Servicios principales", "sku": "DEMO-SVC-001", "product": "Servicio de corte", "price": 25000, "cost": 5000, "stock": 999, "min_stock": 0,
            "supplier": "Insumos Estudio Nube", "features": {"inventory": False, "pos": True, "reservations": True, "tables": False, "rooms": False, "warehouse": False, "services": True, "delivery": False},
            "theme": {"primary": "#315F68", "secondary": "#729B93", "accent": "#A4C4B9", "background": "#F4F8F7", "surface": "#FFFFFF", "lightBackground": "#F4F8F7", "lightSurface": "#FFFFFF", "darkBackground": "#101D20", "darkSurface": "#1A2A2E", "mode": "light", "customized": False},
        },
    ]

    created_users: dict[str, str] = {}
    with connection() as conn:
        conn.executescript(schema)
        # SUPERADMIN is a development-only sample and is never auto-created at app startup.
        super_email = "superadmin@managerstock.test"
        super_id = "DEMO-SUPERADMIN-001"
        existing_super = conn.execute("SELECT id,role FROM auth_users WHERE email=?", (super_email,)).fetchone()
        if existing_super:
            if existing_super["role"] != "superadmin":
                raise RuntimeError(f"El correo {super_email} ya existe con otro rol; no se modificó.")
            created_users["SUPERADMIN"] = super_email
        else:
            conn.execute("INSERT INTO auth_users (id,business_id,full_name,email,password_hash,role,active) VALUES (?,NULL,?,?,?,?,1)", (super_id, "SUPERADMIN de demostración", super_email, hash_password("SuperAdminDemo2026!"), "superadmin"))
            created_users["SUPERADMIN"] = super_email

        for biz in businesses:
            settings = {"type": biz["type"], "name": biz["name"], "currency": "COP", "taxRate": 0.19, "features": biz["features"], "theme": biz["theme"]}
            if "foodConfig" in biz:
                settings["foodConfig"] = biz["foodConfig"]
            conn.execute("INSERT OR IGNORE INTO businesses (id,name,business_type,currency,tax_rate,settings_json,active) VALUES (?,?,?,?,?,?,1)", (biz["id"], biz["name"], biz["db_type"], "COP", 0.19, json.dumps(settings, ensure_ascii=False)))
            actual_business = conn.execute("SELECT name,business_type FROM businesses WHERE id=?", (biz["id"],)).fetchone()
            if actual_business["business_type"] != biz["db_type"]:
                raise RuntimeError(f"El identificador {biz['id']} ya existe con otro tipo de negocio. No se sobrescribieron sus datos.")

            for account_role, account in (("owner", biz["owner"]), ("cashier", biz["employee"])):
                email, full_name, password = account
                existing = conn.execute("SELECT id,business_id,role FROM auth_users WHERE email=?", (email,)).fetchone()
                if existing:
                    if existing["business_id"] != biz["id"] or existing["role"] != account_role:
                        raise RuntimeError(f"El correo {email} ya pertenece a otra cuenta. No se modificó.")
                    user_id = existing["id"]
                else:
                    user_id = f"DEMO-{biz['slug'].upper()}-{account_role.upper()}-{uuid.uuid4().hex[:6].upper()}"
                    conn.execute("INSERT INTO auth_users (id,business_id,full_name,email,password_hash,role,active) VALUES (?,?,?,?,?,?,1)", (user_id, biz["id"], full_name, email, hash_password(password), account_role))
                created_users[f"{biz['slug']}:{account_role}"] = email

            owner_id = conn.execute("SELECT id FROM auth_users WHERE email=?", (biz["owner"][0],)).fetchone()["id"]
            product_id = f"DEMO-PRD-{biz['slug'].upper()}-001"
            conn.execute("INSERT OR IGNORE INTO products (id,business_id,name,sku,category,price,cost,stock,min_stock,description,image,product_type,unit,active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)", (product_id, biz["id"], biz["product"], biz["sku"], biz["category"], biz["price"], biz["cost"], biz["stock"], biz["min_stock"], "Registro ficticio para verificar funciones de demostración.", "", "sale_item", "servicio" if biz["slug"] == "services" else "unidad"))
            supplier_id = f"DEMO-SUP-{biz['slug'].upper()}-001"
            conn.execute("INSERT OR IGNORE INTO suppliers (id,business_id,name,company,phone,email,address,notes,active) VALUES (?,?,?,?,?,?,?,?,1)", (supplier_id, biz["id"], biz["supplier"], biz["supplier"], "3000000000", f"contacto-{biz['slug']}@example.test", "Dirección ficticia de demostración", "Proveedor ficticio para pruebas."))
            conn.execute("INSERT OR IGNORE INTO supplier_products (supplier_id,product_id) VALUES (?,?)", (supplier_id, product_id))

            sale_id = f"DEMO-SALE-{biz['slug'].upper()}-001"
            key = f"demo-seed-{biz['slug']}-sale-001"
            already = conn.execute("SELECT id FROM sales WHERE business_id=? AND idempotency_key=?", (biz["id"], key)).fetchone()
            if not already:
                product = conn.execute("SELECT * FROM products WHERE id=? AND business_id=?", (product_id, biz["id"])).fetchone()
                quantity = 1 if biz["slug"] == "services" else 2
                if product and product["stock"] >= quantity:
                    subtotal = round(product["price"] * quantity, 2)
                    tax = round(subtotal * 0.19, 2)
                    total = round(subtotal + tax, 2)
                    conn.execute("INSERT INTO sales (id,business_id,idempotency_key,customer,payment_method,currency,subtotal,line_discount,global_discount,tax_rate,tax,total,status,created_by,cash_session_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)", (sale_id, biz["id"], key, "Cliente ficticio", "cash", "COP", subtotal, 0, 0, 0.19, tax, total, "completed", owner_id))
                    conn.execute("INSERT INTO sale_items (sale_id,product_id,product_name,sku_snapshot,quantity,unit_price,unit_cost_snapshot,discount_percent,line_total) VALUES (?,?,?,?,?,?,?,?,?)", (sale_id, product_id, product["name"], product["sku"], quantity, product["price"], product["cost"], 0, subtotal))
                    conn.execute("INSERT INTO sale_payments (sale_id,method,amount) VALUES (?,?,?)", (sale_id, "cash", total))
                    stock_before = product["stock"]
                    stock_after = stock_before - quantity
                    conn.execute("UPDATE products SET stock=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND business_id=?", (stock_after, product_id, biz["id"]))
                    conn.execute("INSERT INTO inventory_movements (business_id,product_id,sale_id,movement_type,quantity_delta,stock_before,stock_after,note) VALUES (?,?,?,?,?,?,?,?)", (biz["id"], product_id, sale_id, "sale", -quantity, stock_before, stock_after, "Venta ficticia de inicialización de demostración"))
            # Tenant-isolated operational demo data for modules backed by SQLite.
            if biz["slug"] == "hotel":
                rooms = [
                    ("DEMO-HOTEL-ROOM-101", "101", "simple", 1, 1, 85000, "available", ["WiFi", "TV"]),
                    ("DEMO-HOTEL-ROOM-202", "202", "suite", 2, 4, 185000, "reserved", ["WiFi", "TV", "Minibar"]),
                ]
                for room_id, number, room_type, floor, capacity, price, status, amenities in rooms:
                    conn.execute("INSERT OR IGNORE INTO hotel_rooms (id,business_id,room_number,room_type,floor,capacity,price_per_night,status,amenities_json) VALUES (?,?,?,?,?,?,?,?,?)",
                                 (room_id,biz["id"],number,room_type,floor,capacity,price,status,json.dumps(amenities,ensure_ascii=False)))
                start = date.today() + timedelta(days=2)
                end = start + timedelta(days=2)
                room = conn.execute("SELECT id,price_per_night FROM hotel_rooms WHERE business_id=? AND room_number='202'", (biz["id"],)).fetchone()
                reservation_id = "DEMO-HOTEL-RES-001"
                conn.execute("INSERT OR IGNORE INTO hotel_reservations (id,business_id,room_id,guest_name,guest_email,guest_phone,check_in,check_out,status,advance,total_charges) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                             (reservation_id,biz["id"],room["id"],"Huésped Ficticio", "huesped.hotel@managerstock.test", "3000000001", start.isoformat(), end.isoformat(), "confirmed", 50000, float(room["price_per_night"])*2))
            elif biz["slug"] == "services":
                services = [
                    ("DEMO-SVC-CORTE", "Corte de cabello", 45, 25000, "Cabello", "#315F68"),
                    ("DEMO-SVC-MANICURE", "Manicure", 60, 30000, "Uñas", "#9B6B87"),
                ]
                for service_id, name, duration, price, category, color in services:
                    conn.execute("INSERT OR IGNORE INTO service_catalog (id,business_id,name,duration_minutes,price,category,color,active) VALUES (?,?,?,?,?,?,?,1)",
                                 (service_id,biz["id"],name,duration,price,category,color))
                professionals = [
                    ("DEMO-PRO-ANDREA", "Andrea Demo", "Estilista", "#315F68", [{"dia":1,"inicio":"09:00","fin":"18:00"},{"dia":2,"inicio":"09:00","fin":"18:00"}]),
                    ("DEMO-PRO-KARLA", "Karla Demo", "Manicurista", "#9B6B87", [{"dia":1,"inicio":"10:00","fin":"19:00"},{"dia":3,"inicio":"10:00","fin":"19:00"}]),
                ]
                for professional_id, name, specialty, color, availability in professionals:
                    conn.execute("INSERT OR IGNORE INTO service_professionals (id,business_id,name,specialty,color,availability_json,active) VALUES (?,?,?,?,?,?,1)",
                                 (professional_id,biz["id"],name,specialty,color,json.dumps(availability,ensure_ascii=False)))
                service = conn.execute("SELECT id,name,duration_minutes,price FROM service_catalog WHERE id='DEMO-SVC-CORTE' AND business_id=?", (biz["id"],)).fetchone()
                professional = conn.execute("SELECT id,name FROM service_professionals WHERE id='DEMO-PRO-ANDREA' AND business_id=?", (biz["id"],)).fetchone()
                appt_date = (date.today() + timedelta(days=1)).isoformat()
                conn.execute("INSERT OR IGNORE INTO service_appointments (id,business_id,service_id,professional_id,client_name,client_email,client_phone,service_name_snapshot,professional_name_snapshot,duration_minutes,price_snapshot,appointment_date,start_time,end_time,status,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                             ("DEMO-APT-001",biz["id"],service["id"],professional["id"],"Cliente Ficticio", "cliente.servicios@managerstock.test", "3000000002", service["name"], professional["name"], service["duration_minutes"], service["price"], appt_date, "10:00", (datetime.combine(date.today(), datetime.strptime("10:00", "%H:%M").time()) + timedelta(minutes=service["duration_minutes"])).strftime("%H:%M"), "confirmed", "Cita de demostración ficticia"))
            print(f"Preparado: {biz['name']} · {biz['type']}")

    docs = ROOT / "docs" / "USUARIOS_DE_PRUEBA.md"
    docs.parent.mkdir(parents=True, exist_ok=True)
    content = [
        "# Usuarios y negocios de prueba de MANAGER STOCK", "",
        "Estas cuentas son datos ficticios para desarrollo local. El script nunca se ejecuta automáticamente y está bloqueado cuando `APP_ENV` o `MANAGER_STOCK_ENV` indican producción.", "",
        "Ejecuta `python scripts/seed_demo_data.py --allow-demo-data` para crear de forma idempotente los usuarios, negocios, productos, proveedores y una venta de ejemplo en la base SQLite configurada. No se eliminan datos preexistentes.", "",
        "## Credenciales iniciales", "", "| Tipo | Rol | Correo | Contraseña inicial |", "|---|---|---|---|",
        "| Plataforma | SUPERADMIN | `superadmin@managerstock.test` | `SuperAdminDemo2026!` |",
    ]
    for biz in businesses:
        content.append(f"| {biz['name']} | PROPIETARIO | `{biz['owner'][0]}` | `{biz['owner'][2]}` |")
        content.append(f"| {biz['name']} | EMPLEADO (cajero de prueba) | `{biz['employee'][0]}` | `{biz['employee'][2]}` |")
    content += ["", "Si una cuenta ya existía, el seed conserva su contraseña actual; en ese caso, la contraseña de la tabla solo corresponde a la creación inicial. Cambia todas las contraseñas si los datos salen del entorno local.", "", "## Alcance de los datos", "", "El seed crea negocios y registros ficticios por tenant: productos, proveedores, ventas, líneas de venta, movimientos de inventario y, en los tipos hotel y servicios, habitaciones, reservas, servicios, profesionales y citas en SQLite. Los módulos que no dispongan de persistencia backend en esta versión no deben considerarse operativos para producción. No se cargan datos reales.", ""]
    docs.write_text("\n".join(content), encoding="utf-8")
    print("\nUsuarios de prueba listos. Consulta docs/USUARIOS_DE_PRUEBA.md.")
    print(f"Base de datos: {os.getenv('MANAGER_STOCK_DB', str(ROOT / 'backend' / 'data' / 'manager_stock.db'))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
