"""Manager Stock API — punto de entrada.

Este módulo solo crea la aplicación FastAPI, registra los middlewares y los
routers de cada módulo, y gestiona el ciclo de vida (migraciones al arrancar y
el worker de limpieza de transiciones de tipo de negocio).

La lógica vive en:
  backend/core/      configuración, base de datos, identidad, seguridad, middleware y migraciones
  backend/services/  helpers de dominio compartidos entre routers
  backend/schemas.py modelos Pydantic compartidos
  backend/routers/   un router por módulo funcional
"""
from __future__ import annotations

import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.core.config import SCHEMA_PATH
from backend.core.db import connection, timestamp_iso
from backend.core.middleware import authenticate_and_authorize
from backend.core.schema import init_database
from backend.core.security import hash_password
from backend.routers import (
    auth,
    business,
    cash,
    catalog,
    hotel,
    inventory,
    inventory_counts,
    inventory_reports,
    inventory_transfers,
    orders,
    platform,
    purchase_orders,
    recipes,
    sales,
    services,
    subscriptions,
    suppliers,
    support,
    system,
    tables,
)
from backend.services.business_types import process_due_type_transitions, transition_cleanup_worker

# Re-exportados para scripts y pruebas que importan desde backend.main.
__all__ = ["app", "connection", "hash_password", "startup", "timestamp_iso", "SCHEMA_PATH"]

app = FastAPI(title="Manager Stock API", version="1.0.0", description="API local para inventario, ventas, proveedores y pedidos.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173"],
    # Permite el acceso desde el celular/PC en la misma red al levantar el
    # backend en 0.0.0.0 y la app frontend con Vite en 0.0.0.0.
    allow_origin_regex=r"^https?://([0-9]{1,3}\.){3}[0-9]{1,3}(:[0-9]+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Registrado después de CORS para que quede como capa externa (mismo orden que antes).
app.middleware("http")(authenticate_and_authorize)

# El orden de registro se conserva respecto al main.py original.
for module in (
    auth, business, subscriptions, platform, support, system, catalog, sales, suppliers,
    inventory, purchase_orders, inventory_counts, inventory_transfers, inventory_reports,
    cash, hotel, services, orders, tables, recipes,
):
    app.include_router(module.router)


@app.on_event("startup")
async def startup():
    init_database()
    process_due_type_transitions()
    app.state.transition_cleanup_task = asyncio.create_task(transition_cleanup_worker())


@app.on_event("shutdown")
async def shutdown():
    task = getattr(app.state, "transition_cleanup_task", None)
    if task is not None:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
