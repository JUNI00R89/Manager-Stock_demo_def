from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # raíz del repositorio (backend/core/config.py)


DB_PATH = Path(os.getenv("MANAGER_STOCK_DB", str(ROOT / "backend" / "data" / "manager_stock.db")))


SCHEMA_PATH = ROOT / "database" / "schema.sql"


BUSINESS_ID = os.getenv("MANAGER_STOCK_BUSINESS_ID", "negocio-demo")


BUSINESS_NAME = os.getenv("MANAGER_STOCK_BUSINESS_NAME", "Mi negocio de comidas")


CURRENCY = "COP"


DEFAULT_TAX_RATE = 0.19


SUBSCRIPTION_PLANS = {
    "free": {"id": "free", "name": "Gratis", "priceCOP": 0, "maxUsers": 1, "maxProducts": 100},
    "entrepreneur": {"id": "entrepreneur", "name": "Emprendedor", "priceCOP": 39900, "maxUsers": 3, "maxProducts": 1000},
    "business": {"id": "business", "name": "Negocio", "priceCOP": 79900, "maxUsers": 10, "maxProducts": 5000},
    "enterprise": {"id": "enterprise", "name": "Empresarial", "priceCOP": 149900, "maxUsers": 25, "maxProducts": 20000},
}


DEFAULT_CATEGORY_PRESETS: dict[str, list[str]] = {
    "retail": ["Bebidas", "Alimentos", "Aseo", "Accesorios", "Tecnología", "Ropa", "Otros"],
    "food": ["Comidas rápidas", "Hamburguesas", "Salchipapas", "Empanadas", "Almuerzos", "Bebidas", "Postres", "Adicionales", "Otros"],
    "hotel": ["Minibar", "Bebidas", "Artículos de aseo", "Productos complementarios", "Otros"],
    "warehouse": ["Materias primas", "Mercancía", "Empaques", "Herramientas", "Repuestos", "Otros"],
    "services": ["Servicios principales", "Servicios complementarios", "Productos relacionados", "Otros"],
}


DISCRETE_UNITS = {"unidad", "porcion", "porción", "paquete", "tajada", "caja", "pieza", "par", "botella", "lata", "servicio"}
