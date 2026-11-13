#!/usr/bin/env python3
"""Agrega datos ficticios de hotel al tenant de demostración.

Este script ejecuta únicamente la sección de hotel del seed principal, por lo que
sirve para completar una base existente sin volver a procesar los demás negocios.

Uso:
    python scripts/seed_hotel_demo_data.py --allow-demo-data
    python scripts/seed_hotel_demo_data.py --allow-demo-data --db ruta/manager_stock.db
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    parser = argparse.ArgumentParser(description="Carga habitaciones, reservas, consumos y cobros ficticios del hotel demo.")
    parser.add_argument("--allow-demo-data", action="store_true", help="Confirma explícitamente que deseas añadir datos ficticios.")
    parser.add_argument("--db", type=str, default=None, help="Ruta a una base SQLite de desarrollo.")
    parser.add_argument("--business-id", type=str, default="DEMO-HOTEL-001", help="Negocio de hotel a completar.")
    args = parser.parse_args()
    env_name = os.getenv("MANAGER_STOCK_ENV", os.getenv("APP_ENV", "development")).lower()
    if env_name in {"prod", "production"}:
        print("ERROR: el seed de demostración está bloqueado en producción.", file=sys.stderr)
        return 2
    if not args.allow_demo_data:
        parser.error("Debes incluir --allow-demo-data para confirmar la creación de registros ficticios.")
    if args.db:
        db_path = Path(args.db).expanduser().resolve()
        os.environ["MANAGER_STOCK_DB"] = str(db_path)

    sys.path.insert(0, str(ROOT))
    sys.path.insert(0, str(ROOT / "scripts"))
    from backend.main import connection  # noqa: PLC0415
    from seed_demo_data import seed_hotel_demo  # noqa: PLC0415

    schema = (ROOT / "database" / "schema.sql").read_text(encoding="utf-8")
    with connection() as conn:
        conn.executescript(schema)
        business = conn.execute("SELECT id,name,business_type FROM businesses WHERE id=?", (args.business_id,)).fetchone()
        if not business:
            print(f"ERROR: no existe el negocio {args.business_id}.", file=sys.stderr)
            return 1
        if business["business_type"] != "hotel":
            print(f"ERROR: el negocio {args.business_id} no es de tipo hotel (tipo actual: {business['business_type']}).", file=sys.stderr)
            return 1
        owner = conn.execute("SELECT id FROM auth_users WHERE business_id=? AND role='owner' AND active=1 ORDER BY created_at LIMIT 1", (args.business_id,)).fetchone()
        if not owner:
            print(f"ERROR: el negocio {args.business_id} no tiene un propietario activo.", file=sys.stderr)
            return 1
        seed_hotel_demo(conn, {"id": business["id"], "name": business["name"]}, owner["id"])
        rooms = conn.execute("SELECT COUNT(*) FROM hotel_rooms WHERE business_id=?", (args.business_id,)).fetchone()[0]
        reservations = conn.execute("SELECT COUNT(*) FROM hotel_reservations WHERE business_id=?", (args.business_id,)).fetchone()[0]
        charges = conn.execute("SELECT COUNT(*) FROM hotel_charges WHERE business_id=?", (args.business_id,)).fetchone()[0]
        payments = conn.execute("SELECT COUNT(*) FROM hotel_payments WHERE business_id=?", (args.business_id,)).fetchone()[0]
        refunds = conn.execute("SELECT COUNT(*) FROM hotel_refunds WHERE business_id=?", (args.business_id,)).fetchone()[0]
        closures = conn.execute("SELECT COUNT(*) FROM hotel_account_closures WHERE business_id=?", (args.business_id,)).fetchone()[0]
    print(f"Datos de hotel listos en {args.business_id}: {rooms} habitaciones, {reservations} reservas, {charges} consumos, {payments} pagos, {refunds} devoluciones, {closures} cierres de cuenta.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
