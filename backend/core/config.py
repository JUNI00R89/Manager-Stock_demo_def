from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # raíz del repositorio (backend/core/config.py)


DB_PATH = Path(os.getenv("MANAGER_STOCK_DB", str(ROOT / "backend" / "data" / "manager_stock.db")))
# Uploaded files live next to the database, so tests and backups follow MANAGER_STOCK_DB.
UPLOADS_DIR = DB_PATH.parent / "uploads"


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


# --- Links de pago de las suscripciones (Mercado Pago) ----------------------
# PENDIENTE: pega aquí el link de suscripción de cada plan cuando lo tengas,
# entre las comillas. Mientras un link esté vacío, la app no muestra el botón de
# pago de ese plan y el propietario solo registra la solicitud.
# Solo se aceptan links https://; cualquier otro valor se ignora.
# También se pueden definir sin tocar el código con las variables de entorno
# MANAGER_STOCK_PAYMENT_LINK_ENTREPRENEUR / _BUSINESS / _ENTERPRISE.
SUBSCRIPTION_PAYMENT_LINKS = {
    "entrepreneur": os.getenv("MANAGER_STOCK_PAYMENT_LINK_ENTREPRENEUR", ""),  # Manager Stock · Emprendedor ($39.900)
    "business": os.getenv("MANAGER_STOCK_PAYMENT_LINK_BUSINESS", ""),          # Manager Stock · Negocio ($79.900)
    "enterprise": os.getenv("MANAGER_STOCK_PAYMENT_LINK_ENTERPRISE", ""),      # Manager Stock · Empresarial ($149.900)
}


DEFAULT_CATEGORY_PRESETS: dict[str, list[str]] = {
    "retail": ["Bebidas", "Alimentos", "Aseo", "Accesorios", "Tecnología", "Ropa", "Otros"],
    "food": ["Comidas rápidas", "Hamburguesas", "Salchipapas", "Empanadas", "Almuerzos", "Bebidas", "Postres", "Adicionales", "Otros"],
    "hotel": ["Minibar", "Bebidas", "Artículos de aseo", "Productos complementarios", "Otros"],
    "warehouse": ["Materias primas", "Mercancía", "Empaques", "Herramientas", "Repuestos", "Otros"],
    "services": ["Servicios principales", "Servicios complementarios", "Productos relacionados", "Otros"],
}


DISCRETE_UNITS = {"unidad", "porcion", "porción", "paquete", "tajada", "caja", "pieza", "par", "botella", "lata", "servicio"}


# --- CORS -------------------------------------------------------------------
# Siempre se permite loopback (127.0.0.1 / localhost / [::1]) en cualquier
# puerto: lo usan Vite (5173/4173) y la app de escritorio, que sirve el
# frontend en un puerto aleatorio de 127.0.0.1. Solo procesos del mismo equipo
# pueden usar esos orígenes.
_LOOPBACK_ORIGIN = r"http://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?"
# Redes privadas (192.168.x.x, 10.x.x.x, 172.16-31.x.x): solo si se activa
# MANAGER_STOCK_ALLOW_LAN=1, para probar desde el celular en la misma red.
_PRIVATE_LAN_ORIGIN = (
    r"http://(192\.168\.[0-9]{1,3}\.[0-9]{1,3}"
    r"|10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}"
    r"|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3})(:[0-9]{1,5})?"
)
CORS_ALLOW_LAN = os.getenv("MANAGER_STOCK_ALLOW_LAN", "").strip().lower() in {"1", "true", "yes", "si", "sí"}
CORS_ORIGIN_REGEX = "^(" + _LOOPBACK_ORIGIN + ("|" + _PRIVATE_LAN_ORIGIN if CORS_ALLOW_LAN else "") + ")$"
# Orígenes adicionales exactos, separados por coma (p. ej. un dominio propio).
CORS_EXTRA_ORIGINS = [o.strip().rstrip("/") for o in os.getenv("MANAGER_STOCK_CORS_ORIGINS", "").split(",") if o.strip()]
