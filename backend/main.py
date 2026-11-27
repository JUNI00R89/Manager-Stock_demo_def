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

from backend.core.config import CORS_EXTRA_ORIGINS, CORS_ORIGIN_REGEX, DB_PATH, SCHEMA_PATH
from backend.core.db import connection, timestamp_iso
from backend.core.middleware import authenticate_and_authorize
from backend.core.schema import init_database
from backend.core.security import hash_password, purge_expired_sessions
from backend.routers import (
    auth,
    business,
    cash,
    catalog,
    commerce,
    count_reviews,
    customer_credit,
    hotel,
    inventory,
    inventory_counts,
    inventory_reports,
    inventory_transfers,
    orders,
    platform,
    product_options,
    purchase_orders,
    recipes,
    returns,
    sales,
    scheduling,
    service_checkout,
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
    ensure_env_superadmin()
    run_maintenance()


def ensure_env_superadmin() -> None:
    """En la nube no hay terminal para scripts/create_superadmin.py: si existen
    MANAGER_STOCK_SUPERADMIN_EMAIL y _PASSWORD, crea esa cuenta al arrancar.
    Nunca la duplica ni cambia la contraseña de una cuenta que ya existe."""
    import os
    import secrets
    email = os.getenv("MANAGER_STOCK_SUPERADMIN_EMAIL", "").strip().lower()
    password = os.getenv("MANAGER_STOCK_SUPERADMIN_PASSWORD", "")
    if not email or not password:
        return
    with connection() as conn:
        if conn.execute("SELECT 1 FROM auth_users WHERE email=?", (email,)).fetchone():
            return
        conn.execute(
            "INSERT INTO auth_users (id,business_id,full_name,email,password_hash,role,active) VALUES (?,NULL,?,?,?,'superadmin',1)",
            ("SA-" + secrets.token_hex(8).upper(), os.getenv("MANAGER_STOCK_SUPERADMIN_NAME", "").strip() or "Plataforma", email, hash_password(password)),
        )
    logger.info("SUPERADMIN creado desde variables de entorno: %s", email)


async def maintenance_worker() -> None:
    while True:
        await asyncio.sleep(MAINTENANCE_INTERVAL_SECONDS)
        await asyncio.to_thread(run_maintenance)  # SQLite may wait up to 10 s for the lock; never block every request


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

# The last middleware added is the outermost. CORS goes last so its headers also reach the
# 401/403 answered by the auth middleware; otherwise the browser reports them as "Failed to fetch".
app.middleware("http")(authenticate_and_authorize)
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

# The registration order matters when two paths overlap: keep it as it has always been.
for module in (
    auth, business, subscriptions, platform, support, system, catalog, sales, suppliers,
    inventory, purchase_orders, inventory_counts, inventory_transfers, inventory_reports,
    cash, hotel, services, orders, tables, recipes, product_options,
    commerce, customer_credit, returns, scheduling, service_checkout, count_reviews,
):
    app.include_router(module.router)
app.include_router(scheduling.appointment_router)
