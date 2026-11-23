"""In the cloud the superadmin comes from environment variables: created on startup, never duplicated, password kept."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-bootstrap-")
os.environ["MANAGER_STOCK_DB"] = str(Path(TEMP.name) / "manager_stock_test.db")
os.environ["MANAGER_STOCK_SUPERADMIN_EMAIL"] = "Plataforma@Nube.local"
os.environ["MANAGER_STOCK_SUPERADMIN_PASSWORD"] = "ClaveDePrueba123!"
os.environ["MANAGER_STOCK_SUPERADMIN_NAME"] = "Plataforma"
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app, connection  # noqa: E402


def login(client: TestClient, password: str) -> int:
    return client.post("/api/auth/login", json={"email": "plataforma@nube.local", "password": password}).status_code


def run() -> None:
    with TestClient(app) as client:
        assert login(client, "ClaveDePrueba123!") == 200, "the superadmin from the environment can sign in"
        me = client.post("/api/auth/login", json={"email": "plataforma@nube.local", "password": "ClaveDePrueba123!"}).json()
        assert me["user"]["role"] == "superadmin", me

    # A restart with a different password in the environment does not overwrite the stored one.
    os.environ["MANAGER_STOCK_SUPERADMIN_PASSWORD"] = "OtraClave456!"
    with TestClient(app) as client:
        assert login(client, "ClaveDePrueba123!") == 200
    with connection() as conn:
        count = conn.execute("SELECT COUNT(*) FROM auth_users WHERE role='superadmin'").fetchone()[0]
    assert count == 1, f"never duplicated, found {count}"

    # A password that is too weak is rejected loudly instead of creating an insecure account.
    os.environ["MANAGER_STOCK_SUPERADMIN_EMAIL"] = "otro@nube.local"
    os.environ["MANAGER_STOCK_SUPERADMIN_PASSWORD"] = "123"
    try:
        with TestClient(app):
            raise AssertionError("startup must fail with a weak superadmin password")
    except ValueError:
        pass
    print("OK: superadmin desde variables de entorno")


def test_superadmin_bootstrap() -> None:
    run()


if __name__ == "__main__":
    run()
