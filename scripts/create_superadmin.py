"""Create the first MANAGER STOCK platform SUPERADMIN interactively.
Run from the project root: python scripts/create_superadmin.py
"""
from __future__ import annotations

import getpass
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.main import connection, hash_password, prepare_database  # noqa: E402


def main() -> int:
    print("\nMANAGER STOCK · Creación inicial de SUPERADMIN")
    print("Este procedimiento no está disponible desde el registro público.\n")
    name = input("Nombre del propietario de la plataforma: ").strip()
    email = input("Correo de SUPERADMIN: ").strip().lower()
    password = getpass.getpass("Contraseña (mínimo 8 caracteres): ")
    confirm = getpass.getpass("Confirmar contraseña: ")
    if len(name) < 2 or "@" not in email:
        print("ERROR: revisa el nombre y el correo.")
        return 1
    if password != confirm:
        print("ERROR: las contraseñas no coinciden.")
        return 1
    try:
        password_hash = hash_password(password)
    except ValueError as exc:
        print(f"ERROR: {exc}")
        return 1

    prepare_database()  # Crea el esquema y las migraciones antes de insertar la cuenta de plataforma.
    user_id = "SA-" + __import__("secrets").token_hex(8).upper()
    try:
        with connection() as conn:
            conn.execute(
                "INSERT INTO auth_users (id,business_id,full_name,email,password_hash,role,active) VALUES (?,NULL,?,?,?,'superadmin',1)",
                (user_id, name, email, password_hash),
            )
    except sqlite3.IntegrityError:
        print("ERROR: ese correo ya está registrado. No se creó otra cuenta.")
        return 1

    print("\nSUPERADMIN creado correctamente.")
    print(f"Correo: {email}")
    print("Inicia sesión en http://127.0.0.1:5173/ para abrir el panel global.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
