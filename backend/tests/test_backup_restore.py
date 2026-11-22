"""Restore drill: a backup taken from a running business can be restored and the app works on it, photos included."""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EMAIL, PASSWORD = "dueno@respaldo.local", "PruebaSegura123!"
PHOTO = "0123456789abcdef0123456789abcdef.webp"


def verify_restored() -> None:
    """Runs in a fresh process whose MANAGER_STOCK_DB points at the restored copy."""
    from fastapi.testclient import TestClient
    from backend.main import app

    with TestClient(app) as client:
        login = client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
        assert login.status_code == 200, login.text
        headers = {"Authorization": "Bearer " + login.json()["access_token"]}
        names = {p["name"] for p in client.get("/api/products", headers=headers).json()}
        assert "Café de respaldo" in names, names
        created = client.post("/api/products", headers=headers, json={"name": "Después de restaurar", "category": "Otros", "price": 1000, "cost": 500, "stock": 1, "minStock": 0})
        assert created.status_code in (200, 201), created.text
        assert client.get(f"/uploads/products/{PHOTO}").status_code == 200, "the product photo came back with the data"


def run() -> None:
    with tempfile.TemporaryDirectory(prefix="manager-stock-restore-") as folder:
        live = Path(folder) / "negocio" / "manager_stock.db"
        live.parent.mkdir()
        env = {**os.environ, "MANAGER_STOCK_DB": str(live), "MANAGER_STOCK_AUTO_BACKUP": "0"}
        # Populate the live database through the real API, in its own process (DB_PATH is fixed at import).
        populate = (
            "from fastapi.testclient import TestClient\n"
            "from backend.main import app\n"
            "with TestClient(app) as c:\n"
            f"    t = c.post('/api/auth/register', json={{'name': 'Dueño', 'email': '{EMAIL}', 'password': '{PASSWORD}'}}).json()['access_token']\n"
            "    h = {'Authorization': 'Bearer ' + t}\n"
            "    retail = {'type': 'retail', 'name': 'Tienda Respaldo', 'currency': 'COP', 'taxRate': 0, 'features': {'inventory': True, 'pos': True}}\n"
            "    assert c.put('/api/business/config', headers=h, json=retail).status_code == 200\n"
            "    r = c.post('/api/products', headers=h, json={'name': 'Café de respaldo', 'category': 'Bebidas', 'price': 3000, 'cost': 1000, 'stock': 10, 'minStock': 1})\n"
            "    assert r.status_code in (200, 201), r.text\n"
        )
        subprocess.run([sys.executable, "-c", populate], cwd=ROOT, env=env, check=True)
        photos = live.parent / "uploads" / "products"
        photos.mkdir(parents=True)
        (photos / PHOTO).write_bytes(b"RIFF\x00\x00\x00\x00WEBPfoto")

        sys.path.insert(0, str(ROOT))
        from backend.backups import create_backup, restore_backup

        copy = create_backup(live, Path(folder) / "backups", automatic=True)
        assert (copy.with_name(copy.stem + "_uploads") / "products" / PHOTO).exists(), "every backup also keeps the photos"

        restored = Path(folder) / "restaurado" / "manager_stock.db"
        restore_backup(copy, restored)
        assert (restored.parent / "uploads" / "products" / PHOTO).exists(), "restore brings the photos back"

        try:
            restore_backup(copy, restored)
            raise AssertionError("restoring onto an existing database must be refused")
        except FileExistsError:
            pass

        tampered = Path(folder) / "alterada.db"
        tampered.write_bytes(copy.read_bytes()[:-1] + b"\x01")
        copy.with_suffix(".json").replace(tampered.with_suffix(".json"))
        try:
            restore_backup(tampered, Path(folder) / "otra" / "manager_stock.db")
            raise AssertionError("a copy that does not match its SHA-256 manifest must be refused")
        except ValueError:
            pass

        verify_env = {**env, "MANAGER_STOCK_DB": str(restored)}
        subprocess.run([sys.executable, __file__, "--verify"], cwd=ROOT, env=verify_env, check=True)
    print("OK: a backup restores into a working business, photos included; altered copies and overwrites are refused.")


if __name__ == "__main__":
    if sys.argv[1:] == ["--verify"]:
        sys.path.insert(0, str(ROOT))
        verify_restored()
    else:
        run()
