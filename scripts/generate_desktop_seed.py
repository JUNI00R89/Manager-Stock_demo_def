"""Genera el paquete de datos para la app de escritorio (modo 100 % local).

Lee la API local en funcionamiento y guarda un snapshot con los mismos formatos
que consume el frontend: productos, ventas, proveedores, movimientos, hotel,
servicios y configuración de cada negocio demo. También incluye las credenciales
demo en texto plano porque la app de escritorio autentica sin backend.

Uso:
    .venv\\Scripts\\python.exe scripts\\generate_desktop_seed.py
"""

from __future__ import annotations

import json
import sqlite3
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = "http://127.0.0.1:8000/api"
ROOT = Path(__file__).resolve().parent.parent
SEED_PATH = ROOT / "public" / "desktop-seed.json"
DB_PATH = ROOT / "backend" / "data" / "manager_stock.db"

OWNER_PASSWORDS = {
    "owner.hotel@managerstock.test": "HotelDemo2026!",
    "owner.comidas@managerstock.test": "ComidasDemo2026!",
    "owner.retail@managerstock.test": "TiendaDemo2026!",
    "owner.bodega@managerstock.test": "BodegaDemo2026!",
    "owner.servicios@managerstock.test": "ServiciosDemo2026!",
    "superadmin@managerstock.test": "SuperAdminDemo2026!",
}
CASHIER_PASSWORD = "EmpleadoDemo2026!"

# El snapshot de escritorio se genera desde la base web, que conserva el resultado
# de pruebas antiguas de cambio de tipo. Para la demo instalable normalizamos estos
# dos negocios al vertical que anuncia su cuenta. No se modifica la base web.
DEMO_PROFILE_FIXES: dict[str, dict] = {
    "DEMO-FOOD-001": {
        "type": "restaurant",
        "features": {
            "inventory": True,
            "pos": True,
            "reservations": False,
            "tables": False,
            "rooms": False,
            "warehouse": False,
            "services": False,
            "delivery": False,
        },
        "foodConfig": {
            "serviceModes": ["mostrador", "para_llevar"],
            "foodTypes": ["hamburguesas", "salchipapas", "empanadas", "bebidas", "postres"],
            "activeModules": ["menu", "caja", "inventario"],
            "displayLabel": "Negocio de comidas",
        },
    },
    "DEMO-RETAIL-001": {
        "type": "retail",
        "features": {
            "inventory": True,
            "pos": True,
            "reservations": False,
            "tables": False,
            "rooms": False,
            "warehouse": False,
            "services": False,
            "delivery": False,
        },
        "foodConfig": None,
    },
}


def apply_demo_profile_fixes(seed: dict) -> None:
    """Alinea los negocios demo de escritorio con el vertical de su cuenta."""
    businesses = seed.get("businesses")
    if not isinstance(businesses, dict):
        return
    for business_id, fix in DEMO_PROFILE_FIXES.items():
        business = businesses.get(business_id)
        if not isinstance(business, dict):
            continue
        business["type"] = fix["type"]
        for key in ("settings", "config"):
            target = business.get(key)
            if not isinstance(target, dict):
                continue
            target["type"] = fix["type"]
            target["features"] = {**target.get("features", {}), **fix["features"]}
            target["foodConfig"] = fix["foodConfig"]


def call(path: str, token: str | None = None, method: str = "GET", payload=None):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(API + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        print(f"  ! {method} {path} -> HTTP {error.code}: {detail[:160]}")
        return None


def paged(path: str, token: str, page_size: int = 500) -> list:
    rows: list = []
    offset = 0
    while True:
        separator = "&" if "?" in path else "?"
        page = call(f"{path}{separator}limit={page_size}&offset={offset}", token)
        if not isinstance(page, list):
            break
        rows.extend(page)
        if len(page) < page_size:
            break
        offset += len(page)
    return rows


def main() -> int:
    if not DB_PATH.exists():
        print(f"No existe la base de datos: {DB_PATH}")
        return 1
    try:
        health = call("/health")
    except Exception as error:  # noqa: BLE001 - mensaje claro para el operador
        print(f"No se pudo contactar la API en {API}: {error}")
        print("Inicia el backend con INICIAR_MANAGER_STOCK.bat antes de generar el paquete.")
        return 1
    if not health:
        print("La API no respondió correctamente.")
        return 1

    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    businesses = [dict(row) for row in connection.execute(
        "SELECT id, name, business_type, settings_json FROM businesses ORDER BY name"
    )]
    user_rows = [dict(row) for row in connection.execute(
        "SELECT id, business_id, full_name, email, role, active, created_at FROM auth_users ORDER BY email"
    )]

    users = []
    for row in user_rows:
        email = row["email"]
        password = OWNER_PASSWORDS.get(email)
        if not password:
            if row["role"] == "cashier":
                password = CASHIER_PASSWORD
            else:
                password = "Demo2026!"
        users.append({
            "id": row["id"],
            "businessId": row["business_id"],
            "name": row["full_name"],
            "email": email,
            "password": password,
            "role": row["role"],
            "active": bool(row["active"]),
            "subscription": "premium",
        })

    business_seed: dict[str, dict] = {}
    for business in businesses:
        business_id = business["id"]
        print(f"Negocio {business_id} · {business['name']}")
        owner = next((u for u in users if u["businessId"] == business_id and u["role"] == "owner"), None)
        if not owner:
            print("  ! Sin propietario demo; se omite.")
            continue
        login = call("/auth/login", method="POST", payload={"email": owner["email"], "password": owner["password"]})
        if not login or not login.get("access_token"):
            print("  ! No se pudo autenticar; se omite.")
            continue
        token = login["access_token"]

        settings_raw = business["settings_json"] or "{}"
        try:
            settings = json.loads(settings_raw)
        except json.JSONDecodeError:
            settings = {}

        config = call("/business/config", token)
        products = call("/products", token) or []
        sales = paged("/sales", token)
        suppliers = call("/suppliers", token) or []
        movements = paged("/inventory/movements", token)
        orders = call("/orders", token) or []
        recipes = call("/recipes", token) or []
        categories = call("/product-categories", token) or []
        business_users = call("/users", token) or []
        custom_roles = call("/custom-roles", token) or []
        subscription = call("/subscription", token)
        rooms = call("/hotel/rooms", token) or []
        reservations = call("/hotel/reservations", token) or []
        services_catalog = call("/services/catalog", token) or []
        services_professionals = call("/services/professionals", token) or []
        services_appointments = call("/services/appointments", token) or []

        normalized_movements = [
            {
                "id": row.get("id"),
                "productId": row.get("product_id"),
                "productName": row.get("product_name"),
                "saleId": row.get("sale_id"),
                "movementType": row.get("movement_type"),
                "quantityDelta": row.get("quantity_delta"),
                "stockBefore": row.get("stock_before"),
                "stockAfter": row.get("stock_after"),
                "note": row.get("note") or "",
                "createdAt": row.get("created_at"),
            }
            for row in movements
        ]

        business_seed[business_id] = {
            "id": business_id,
            "name": business["name"],
            "type": settings.get("type") or business["business_type"],
            "settings": settings,
            "config": config,
            "products": products,
            "sales": sales,
            "suppliers": suppliers,
            "movements": normalized_movements,
            "orders": orders,
            "recipes": recipes,
            "categories": categories,
            "users": business_users,
            "customRoles": custom_roles,
            "subscription": subscription,
            "rooms": rooms,
            "reservations": reservations,
            "services": {
                "catalog": services_catalog,
                "professionals": services_professionals,
                "appointments": services_appointments,
            },
        }
        print(
            f"  ok: {len(products)} productos · {len(sales)} ventas · "
            f"{len(normalized_movements)} movimientos · {len(rooms)} habitaciones"
        )

    seed = {
        "version": 1,
        "kind": "manager-stock-desktop-demo",
        "generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "users": users,
        "businesses": business_seed,
    }
    apply_demo_profile_fixes(seed)
    SEED_PATH.parent.mkdir(parents=True, exist_ok=True)
    SEED_PATH.write_text(json.dumps(seed, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    size_mb = SEED_PATH.stat().st_size / (1024 * 1024)
    print(f"\nPaquete creado: {SEED_PATH} ({size_mb:.2f} MB)")
    print(f"Usuarios: {len(users)} · Negocios: {len(business_seed)}")
    return 0


def normalize_existing_seed() -> int:
    """Aplica las correcciones de perfil al snapshot ya generado, sin consultar la API."""
    if not SEED_PATH.exists():
        print(f"No existe el snapshot: {SEED_PATH}")
        return 1
    seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    apply_demo_profile_fixes(seed)
    SEED_PATH.write_text(json.dumps(seed, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Snapshot normalizado: {SEED_PATH}")
    return 0


if __name__ == "__main__":
    if "--normalize-existing" in sys.argv:
        sys.exit(normalize_existing_seed())
    sys.exit(main())
