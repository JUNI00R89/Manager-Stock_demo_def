from __future__ import annotations

import json
import sqlite3

from backend.core.config import SCHEMA_PATH
from backend.core.db import connection, table_has_column


INVENTORY_MOVEMENTS_V2 = """
CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  sale_id TEXT REFERENCES sales(id),
  order_id TEXT REFERENCES orders(id),
  operation_id TEXT REFERENCES inventory_operations(id),
  lot_id TEXT REFERENCES product_lots(id),
  location_id TEXT REFERENCES warehouse_locations(id),
  movement_type TEXT NOT NULL CHECK(movement_type IN ('opening','purchase','customer_return','donation','sale','sale_cancelled','recipe_consumption','consumption','adjustment','transfer_in','transfer_out','waste','count_adjustment','production')),
  quantity_delta REAL NOT NULL,
  stock_before REAL NOT NULL,
  stock_after REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_by_name TEXT NOT NULL DEFAULT '',
  reference_type TEXT NOT NULL DEFAULT '',
  reference_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_date ON inventory_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_business_date ON inventory_movements(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_type ON inventory_movements(business_id, movement_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_sale ON inventory_movements(sale_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_reference ON inventory_movements(business_id, reference_type, reference_id);
"""


def migrate_inventory_schema(conn: sqlite3.Connection) -> None:
    """Non-destructive migration for local databases created by earlier versions."""
    for column, definition in {
        "supplier_id": "TEXT REFERENCES suppliers(id)",
        "barcode": "TEXT NOT NULL DEFAULT ''",
        "track_lots": "INTEGER NOT NULL DEFAULT 0 CHECK(track_lots IN (0,1))",
        "default_location_id": "TEXT REFERENCES warehouse_locations(id)",
    }.items():
        if not table_has_column(conn, "products", column):
            conn.execute(f"ALTER TABLE products ADD COLUMN {column} {definition}")
    if not table_has_column(conn, "orders", "stock_consumed"):
        conn.execute("ALTER TABLE orders ADD COLUMN stock_consumed INTEGER NOT NULL DEFAULT 0")
    if not table_has_column(conn, "recipe_items", "unit"):
        conn.execute("ALTER TABLE recipe_items ADD COLUMN unit TEXT NOT NULL DEFAULT ''")
    products_sql_row = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='products'").fetchone()
    if products_sql_row and "CHECK(stock >= 0)" in (products_sql_row["sql"] or ""):
        # Negative stock is a tenant-configurable policy; remove the old hard check.
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute("""CREATE TABLE products_new (
            id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), name TEXT NOT NULL,
            sku TEXT NOT NULL, category TEXT NOT NULL, price REAL NOT NULL CHECK(price >= 0),
            cost REAL NOT NULL DEFAULT 0 CHECK(cost >= 0), stock REAL NOT NULL DEFAULT 0,
            min_stock REAL NOT NULL DEFAULT 0 CHECK(min_stock >= 0), description TEXT NOT NULL DEFAULT '',
            image TEXT NOT NULL DEFAULT '', product_type TEXT NOT NULL DEFAULT 'sale_item' CHECK(product_type IN ('sale_item','ingredient','supplies')),
            unit TEXT NOT NULL DEFAULT 'unidad', supplier_id TEXT REFERENCES suppliers(id), barcode TEXT NOT NULL DEFAULT '',
            track_lots INTEGER NOT NULL DEFAULT 0 CHECK(track_lots IN (0,1)), default_location_id TEXT REFERENCES warehouse_locations(id),
            active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(business_id, sku))""")
        conn.execute("""INSERT INTO products_new
            (id,business_id,name,sku,category,price,cost,stock,min_stock,description,image,product_type,unit,
             supplier_id,barcode,track_lots,default_location_id,active,created_at,updated_at)
            SELECT id,business_id,name,sku,category,price,cost,stock,min_stock,description,image,product_type,unit,
             supplier_id,barcode,track_lots,default_location_id,active,created_at,updated_at FROM products""")
        conn.execute("DROP TABLE products")
        conn.execute("ALTER TABLE products_new RENAME TO products")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_products_business_active ON products(business_id, active)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(business_id,barcode)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(business_id,supplier_id)")
        conn.execute("PRAGMA foreign_keys = ON")
    movement_sql = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='inventory_movements'").fetchone()
    needs_rebuild = bool(movement_sql) and ("operation_id" not in (movement_sql["sql"] or "") or "customer_return" not in (movement_sql["sql"] or ""))
    if needs_rebuild:
        # SQLite cannot alter a CHECK constraint, so rebuild the movement journal while
        # preserving every historical row. No table references inventory_movements.
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute("DROP INDEX IF EXISTS idx_inventory_movements_product_date")
        conn.execute("ALTER TABLE inventory_movements RENAME TO inventory_movements_legacy")
        conn.executescript(INVENTORY_MOVEMENTS_V2)
        conn.execute("""INSERT INTO inventory_movements
            (id,business_id,product_id,sale_id,movement_type,quantity_delta,stock_before,stock_after,note,created_at)
            SELECT id,business_id,product_id,sale_id,movement_type,quantity_delta,stock_before,stock_after,note,created_at
            FROM inventory_movements_legacy""")
        conn.execute("DROP TABLE inventory_movements_legacy")
        conn.execute("PRAGMA foreign_keys = ON")


def init_database() -> None:
    """Create the schema and apply idempotent in-place migrations."""
    with connection() as conn:
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        migrate_inventory_schema(conn)
        if not table_has_column(conn, "orders", "restaurant_metadata"):
            conn.execute("ALTER TABLE orders ADD COLUMN restaurant_metadata TEXT NOT NULL DEFAULT '{}'")
        for column, definition in [("cleaning_status", "TEXT NOT NULL DEFAULT 'inspeccionada'"), ("cleaning_assignee", "TEXT NOT NULL DEFAULT ''")]:
            if not table_has_column(conn, "hotel_rooms", column):
                conn.execute(f"ALTER TABLE hotel_rooms ADD COLUMN {column} {definition}")
        conn.execute("UPDATE hotel_rooms SET cleaning_status='sucia' WHERE status='cleaning' AND cleaning_status='inspeccionada'")
        if not table_has_column(conn, "orders", "sale_id"):
            conn.execute("ALTER TABLE orders ADD COLUMN sale_id TEXT REFERENCES sales(id)")
        business_columns = {row["name"] for row in conn.execute("PRAGMA table_info(businesses)").fetchall()}
        if "settings_json" not in business_columns:
            conn.execute("ALTER TABLE businesses ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}' ")
        if "active" not in business_columns:
            conn.execute("ALTER TABLE businesses ADD COLUMN active INTEGER NOT NULL DEFAULT 1")
        if "suspension_reason" not in business_columns:
            conn.execute("ALTER TABLE businesses ADD COLUMN suspension_reason TEXT NOT NULL DEFAULT ''")
        if "suspension_description" not in business_columns:
            conn.execute("ALTER TABLE businesses ADD COLUMN suspension_description TEXT NOT NULL DEFAULT ''")
        if "suspended_at" not in business_columns:
            conn.execute("ALTER TABLE businesses ADD COLUMN suspended_at TEXT")
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS auth_users (
                id TEXT PRIMARY KEY,
                business_id TEXT REFERENCES businesses(id),
                full_name TEXT NOT NULL,
                email TEXT NOT NULL COLLATE NOCASE UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('superadmin','owner','business_admin','cashier')),
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS auth_sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_auth_users_business ON auth_users(business_id,role,active);
            CREATE TABLE IF NOT EXISTS platform_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                actor_id TEXT NOT NULL REFERENCES auth_users(id),
                action TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                details TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS custom_roles (
                id TEXT PRIMARY KEY,
                business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                permissions_json TEXT NOT NULL DEFAULT '[]',
                created_by TEXT NOT NULL REFERENCES auth_users(id),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(business_id,name)
            );
            CREATE TABLE IF NOT EXISTS support_cases (
                id TEXT PRIMARY KEY,
                business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
                reason TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_review','awaiting_business','resolved','closed')),
                created_by TEXT REFERENCES auth_users(id),
                updated_by TEXT REFERENCES auth_users(id),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS support_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                case_id TEXT NOT NULL REFERENCES support_cases(id) ON DELETE CASCADE,
                business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
                sender_id TEXT NOT NULL REFERENCES auth_users(id),
                sender_role TEXT NOT NULL,
                message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 4000),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                read_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_support_cases_business_status ON support_cases(business_id,status,updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_support_messages_case ON support_messages(case_id,id);
            CREATE TABLE IF NOT EXISTS business_subscriptions (
                business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
                plan_id TEXT NOT NULL DEFAULT 'free',
                status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','pending_payment','expired','cancelled')),
                pending_plan_id TEXT,
                started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                expires_at TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        """)
        user_columns = {row["name"] for row in conn.execute("PRAGMA table_info(auth_users)").fetchall()}
        if "custom_role_id" not in user_columns:
            conn.execute("ALTER TABLE auth_users ADD COLUMN custom_role_id TEXT")
        # Lightweight migration for databases created by earlier local versions.
        sale_columns = {row["name"] for row in conn.execute("PRAGMA table_info(sales)").fetchall()}
        if "cash_session_id" not in sale_columns:
            conn.execute("ALTER TABLE sales ADD COLUMN cash_session_id TEXT REFERENCES cash_sessions(id)")
        cash_columns = {row["name"] for row in conn.execute("PRAGMA table_info(cash_sessions)").fetchall()}
        if "opened_by_user_id" not in cash_columns:
            conn.execute("ALTER TABLE cash_sessions ADD COLUMN opened_by_user_id TEXT REFERENCES auth_users(id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_cash_sessions_user_status ON cash_sessions(business_id,opened_by_user_id,status,opened_at DESC)")
        item_columns = {row["name"] for row in conn.execute("PRAGMA table_info(sale_items)").fetchall()}
        if "unit_cost_snapshot" not in item_columns:
            conn.execute("ALTER TABLE sale_items ADD COLUMN unit_cost_snapshot REAL NOT NULL DEFAULT 0")
        if any(row["name"] == "product_id" and row["notnull"] for row in conn.execute("PRAGMA table_info(sale_items)")):
            # Service lines (charged appointments) have no product. SQLite cannot drop NOT NULL,
            # so rebuild keeping every row; no table references sale_items.
            conn.execute("PRAGMA foreign_keys = OFF")
            conn.execute("BEGIN IMMEDIATE")  # all-or-nothing: a crash mid-rebuild must not lose sale lines
            conn.execute("ALTER TABLE sale_items RENAME TO sale_items_legacy")
            conn.execute("""CREATE TABLE sale_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id TEXT NOT NULL REFERENCES sales(id),
                product_id TEXT REFERENCES products(id), product_name TEXT NOT NULL, sku_snapshot TEXT NOT NULL DEFAULT '',
                quantity REAL NOT NULL CHECK(quantity > 0), unit_price REAL NOT NULL CHECK(unit_price >= 0),
                unit_cost_snapshot REAL NOT NULL DEFAULT 0 CHECK(unit_cost_snapshot >= 0),
                discount_percent REAL NOT NULL DEFAULT 0, line_total REAL NOT NULL CHECK(line_total >= 0))""")
            conn.execute("""INSERT INTO sale_items (id,sale_id,product_id,product_name,sku_snapshot,quantity,unit_price,unit_cost_snapshot,discount_percent,line_total)
                SELECT id,sale_id,product_id,product_name,sku_snapshot,quantity,unit_price,unit_cost_snapshot,discount_percent,line_total FROM sale_items_legacy""")
            conn.execute("DROP TABLE sale_items_legacy")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id)")
            conn.execute("COMMIT")
            conn.execute("PRAGMA foreign_keys = ON")
        if not table_has_column(conn, "service_appointments", "sale_id"):
            conn.execute("ALTER TABLE service_appointments ADD COLUMN sale_id TEXT REFERENCES sales(id)")
        # Mesas del salón: columnas añadidas por versiones anteriores de Manager Stock.
        order_columns = {row["name"] for row in conn.execute("PRAGMA table_info(orders)").fetchall()}
        if "table_number" not in order_columns:
            conn.execute("ALTER TABLE orders ADD COLUMN table_number INTEGER")
        if "waiter" not in order_columns:
            conn.execute("ALTER TABLE orders ADD COLUMN waiter TEXT NOT NULL DEFAULT ''")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(business_id, table_number)")
        # Si un negocio de comidas ya tiene mesas guardadas, el módulo de mesas
        # debe quedar habilitado aunque su configuración sea anterior a la fusión.
        try:
            food_businesses = conn.execute("SELECT id, settings_json FROM businesses WHERE business_type='food'").fetchall()
            for business in food_businesses:
                has_table = conn.execute("SELECT 1 FROM restaurant_tables WHERE business_id=? LIMIT 1", (business["id"],)).fetchone()
                if not has_table:
                    continue
                try:
                    settings = json.loads(business["settings_json"] or "{}")
                except json.JSONDecodeError:
                    settings = {}
                if not isinstance(settings, dict):
                    settings = {}
                features = settings.get("features") if isinstance(settings.get("features"), dict) else {}
                food_config = settings.get("foodConfig") if isinstance(settings.get("foodConfig"), dict) else {}
                active_modules = food_config.get("activeModules") if isinstance(food_config.get("activeModules"), list) else []
                changed = False
                if features.get("tables") is not True:
                    features["tables"] = True
                    changed = True
                if "mesas" not in active_modules:
                    active_modules.append("mesas")
                    changed = True
                if changed:
                    settings["features"] = features
                    food_config["activeModules"] = active_modules
                    settings["foodConfig"] = food_config
                    conn.execute("UPDATE businesses SET settings_json=? WHERE id=?", (json.dumps(settings, ensure_ascii=False), business["id"]))
        except sqlite3.OperationalError:
            pass
        # New installations no longer receive a fake demo business or pretend sales stock.
        # Historical databases are left intact; no user data is removed during startup.
