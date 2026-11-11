"""Create a consistent SQLite backup of Manager Stock's local database."""
from __future__ import annotations

import os
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
source = Path(os.getenv("MANAGER_STOCK_DB", str(ROOT / "backend" / "data" / "manager_stock.db")))
backup_dir = ROOT / "backups"

if not source.exists():
    raise SystemExit(f"No existe la base de datos: {source}\nInicia la API al menos una vez antes de generar la copia.")

backup_dir.mkdir(parents=True, exist_ok=True)
target = backup_dir / f"manager_stock_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
with sqlite3.connect(source) as src, sqlite3.connect(target) as dst:
    src.backup(dst)
print(f"Copia de seguridad creada: {target}")
uploads = source.parent / "uploads"  # product photos live next to the database
if uploads.is_dir():
    photos_target = target.with_name(f"{target.stem}_uploads")
    shutil.copytree(uploads, photos_target)
    print(f"Fotos copiadas: {photos_target}")
