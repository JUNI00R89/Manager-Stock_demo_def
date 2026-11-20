"""Auth/permission errors must carry CORS headers, or the browser hides the 401/403 behind a network error."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-cors-")
os.environ["MANAGER_STOCK_DB"] = str(Path(TEMP.name) / "manager_stock_test.db")
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402

ORIGIN = {"Origin": "http://127.0.0.1:5173"}


def run() -> None:
    with TestClient(app) as client:
        unauthenticated = client.get("/api/products", headers=ORIGIN)
        assert unauthenticated.status_code == 401
        assert unauthenticated.headers.get("access-control-allow-origin") == ORIGIN["Origin"], unauthenticated.headers

        token = client.post("/api/auth/register", json={"name": "Dueña CORS", "email": "cors@test.local", "password": "PruebaSegura123!"}).json()["access_token"]
        forbidden = client.get("/api/platform/stats", headers={**ORIGIN, "Authorization": f"Bearer {token}"})
        assert forbidden.status_code == 403
        assert forbidden.headers.get("access-control-allow-origin") == ORIGIN["Origin"], forbidden.headers

    print("OK: 401 and 403 from the auth middleware are readable by the web app (CORS headers present).")
    TEMP.cleanup()


if __name__ == "__main__":
    run()
