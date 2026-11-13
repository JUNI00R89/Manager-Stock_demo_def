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
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.core.config import CORS_EXTRA_ORIGINS, CORS_ORIGIN_REGEX, SCHEMA_PATH
from backend.core.db import connection, timestamp_iso
from backend.core.middleware import authenticate_and_authorize
from backend.core.schema import init_database
from backend.core.security import hash_password, purge_expired_sessions
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
from backend.services.business_types import process_due_type_transitions

# Re-exportados para scripts y pruebas que importan desde backend.main.
__all__ = ["app", "connection", "hash_password", "prepare_database", "timestamp_iso", "SCHEMA_PATH"]

logger = logging.getLogger("manager_stock")
MAINTENANCE_INTERVAL_SECONDS = 60


def run_maintenance() -> None:
    """Tareas periódicas; un fallo en una no impide la otra ni detiene la API (se reintenta en el siguiente ciclo)."""
    for name, task in (("cambios de tipo de negocio", process_due_type_transitions), ("sesiones vencidas", purge_expired_sessions)):
        try:
            task()
        except Exception:
            logger.exception("Falló la limpieza de %s", name)


def prepare_database() -> None:
    """Crea/migra el esquema y ejecuta una limpieza inicial. Síncrono: lo usan también los scripts."""
    from pathlib import Path
    import os
    from backend.core.config import DB_PATH
    from backend.backups import create_backup
    from backend.core.db import table_exists
    with connection() as conn:
        if table_exists(conn, 'businesses'):
            applied = {r[0] for r in conn.execute('SELECT version FROM schema_migrations')} if table_exists(conn, 'schema_migrations') else set()
            if any(p.name not in applied for p in (SCHEMA_PATH.parent / 'migrations').glob('*.sql')):
                create_backup(DB_PATH, Path(os.getenv('MANAGER_STOCK_BACKUP_DIR', str(DB_PATH.parent / 'backups'))))
    init_database()
    from backend.migrations import migrate
    with connection() as conn:
        migrate(conn)
    run_maintenance()


async def maintenance_worker() -> None:
    while True:
        await asyncio.sleep(MAINTENANCE_INTERVAL_SECONDS)
        run_maintenance()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    prepare_database()
    import os
    from backend.backups import backup_worker
    backup_task = asyncio.create_task(backup_worker(DB_PATH)) if os.getenv('MANAGER_STOCK_AUTO_BACKUP', '1') != '0' else None
    task = asyncio.create_task(maintenance_worker())
    try:
        yield
    finally:
        if backup_task:
            backup_task.cancel()
            try: await backup_task
            except asyncio.CancelledError: pass
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Manager Stock API", version="1.0.0", description="API local para inventario, ventas, proveedores y pedidos.", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    # Orígenes: ver CORS_* en backend/core/config.py (loopback siempre; LAN solo con
    # MANAGER_STOCK_ALLOW_LAN=1; dominios extra con MANAGER_STOCK_CORS_ORIGINS).
    allow_origins=CORS_EXTRA_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    # La sesión viaja en el encabezado Authorization, no en cookies.
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Retry-After"],
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

from backend.core.config import DB_PATH
from backend.core.context import current_business_id, current_identity
from backend.core.db import audit
from backend.services.inventory import current_operator
from backend.core.security import has_permission
from backend.schemas import SalePayload, SaleItemPayload, PaymentPartPayload
from backend.services.inventory import add_product_stock, consume_product_stock, fetch_inventory_product, new_inventory_operation, validate_product_quantity
from backend.services.sales import get_sale
from backend.services.cash import cash_session_out
from backend.services.business_types import delete_business_type_data
from backend.routers.sales import create_sale
from backend.routers.services import appointment_out, professional_out
from backend.routers.inventory_counts import physical_count_out
from backend import commerce, returns, scheduling, service_checkout, count_reviews
for domain in (commerce, returns, scheduling, service_checkout, count_reviews):
    app.include_router(domain.router)
app.include_router(scheduling.appointment_router)
