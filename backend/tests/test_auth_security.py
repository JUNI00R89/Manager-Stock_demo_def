"""Login/register rate limiting and CORS origin policy on a disposable SQLite DB."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-auth-test-")
os.environ["MANAGER_STOCK_DB"] = str(Path(TEMP.name) / "manager_stock_test.db")
os.environ.pop("MANAGER_STOCK_ALLOW_LAN", None)
os.environ.pop("MANAGER_STOCK_CORS_ORIGINS", None)
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402
from backend.core import rate_limit  # noqa: E402
from backend.main import app  # noqa: E402

PASSWORD = "PruebaSegura123!"


def login(client: TestClient, email: str, password: str):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def check_login_limits(client: TestClient) -> None:
    rate_limit.reset_all()
    assert client.post("/api/auth/register", json={"name": "Dueña Uno", "email": "uno@test.local", "password": PASSWORD}).status_code == 201
    assert client.post("/api/auth/register", json={"name": "Dueño Dos", "email": "dos@test.local", "password": PASSWORD}).status_code == 201

    # Un login correcto limpia los fallos previos del correo.
    for _ in range(4):
        assert login(client, "uno@test.local", "mala").status_code == 401
    assert login(client, "uno@test.local", PASSWORD).status_code == 200
    for _ in range(4):
        assert login(client, "uno@test.local", "mala").status_code == 401
    assert login(client, "uno@test.local", PASSWORD).status_code == 200, "success must reset the per-email counter"

    # 5 fallos seguidos bloquean el correo, incluso con la contraseña correcta.
    for _ in range(5):
        assert login(client, "uno@test.local", "mala").status_code == 401
    blocked = login(client, "UNO@test.local", PASSWORD)  # el correo se normaliza
    assert blocked.status_code == 429, blocked.text
    assert int(blocked.headers["Retry-After"]) > 0
    assert "Intenta de nuevo" in blocked.json()["detail"]
    # El bloqueo es por correo: otra cuenta desde la misma IP sigue funcionando.
    assert login(client, "dos@test.local", PASSWORD).status_code == 200

    # Probar muchas cuentas distintas desde la misma IP termina bloqueando la IP.
    rate_limit.reset_all()
    for i in range(20):
        assert login(client, f"no-existe-{i}@test.local", "mala").status_code == 401
    assert login(client, "dos@test.local", PASSWORD).status_code == 429, "per-IP limit must apply"

    # Al vencer la ventana (aquí: reinicio de contadores) vuelve a funcionar.
    rate_limit.reset_all()
    assert login(client, "uno@test.local", PASSWORD).status_code == 200


def check_concurrent_logins(client: TestClient) -> None:
    from concurrent.futures import ThreadPoolExecutor

    rate_limit.reset_all()
    with ThreadPoolExecutor(30) as pool:
        codes = list(pool.map(lambda _: login(client, "dos@test.local", "mala").status_code, range(30)))
    assert codes.count(401) == 5, f"only 5 passwords may be checked, got {codes.count(401)}"
    assert codes.count(429) == 25, codes
    rate_limit.reset_all()


def check_key_sweep() -> None:
    limiter = rate_limit.SlidingWindowLimiter(max_events=1, window_seconds=1)
    limiter.MAX_KEYS = 100
    for i in range(150):
        limiter.acquire(f"correo-{i}@test.local")
    limiter._last_sweep -= 120  # que el próximo acquire pueda barrer
    limiter.window_seconds = 0  # todas las claves anteriores quedan vencidas
    limiter.acquire("nuevo@test.local")
    assert len(limiter._events) <= 1, len(limiter._events)


def check_register_limit(client: TestClient) -> None:
    rate_limit.reset_all()
    for i in range(10):
        response = client.post("/api/auth/register", json={"name": f"Persona {i}", "email": f"masivo-{i}@test.local", "password": PASSWORD})
        assert response.status_code == 201, response.text
    blocked = client.post("/api/auth/register", json={"name": "Persona extra", "email": "masivo-extra@test.local", "password": PASSWORD})
    assert blocked.status_code == 429, blocked.text
    rate_limit.reset_all()


def check_cors(client: TestClient) -> None:
    def preflight(origin: str):
        return client.options("/api/auth/login", headers={
            "Origin": origin, "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,authorization",
        })

    for allowed in ("http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:4173", "http://127.0.0.1:53817", "http://[::1]:5173"):
        response = preflight(allowed)
        assert response.status_code == 200, (allowed, response.status_code)
        assert response.headers.get("access-control-allow-origin") == allowed, allowed
        assert "access-control-allow-credentials" not in response.headers

    for denied in ("http://192.168.1.20:5173", "http://10.0.0.5:5173", "http://8.8.8.8", "https://evil.example.com", "http://127.0.0.1.evil.com", "null"):
        response = preflight(denied)
        assert response.headers.get("access-control-allow-origin") is None, denied

    simple = client.get("/api/health", headers={"Origin": "https://evil.example.com"})
    assert simple.status_code == 200 and "access-control-allow-origin" not in simple.headers


def check_lan_regex() -> None:
    import re
    from backend.core import config

    lan = re.compile("^(" + config._LOOPBACK_ORIGIN + "|" + config._PRIVATE_LAN_ORIGIN + ")$")
    for ok in ("http://192.168.1.20:5173", "http://10.1.2.3:5173", "http://172.16.0.4:5173", "http://172.31.9.9"):
        assert lan.match(ok), ok
    for bad in ("http://172.32.0.1:5173", "http://8.8.8.8", "http://192.168.1.20.evil.com"):
        assert not lan.match(bad), bad


def run() -> None:
    with TestClient(app) as client:
        check_login_limits(client)
        check_concurrent_logins(client)
        check_register_limit(client)
        check_cors(client)
    check_lan_regex()
    check_key_sweep()
    print("OK: login rate limit (email/IP, reset on success, 429 + Retry-After, atomic under concurrency), key sweep, register limit, CORS loopback-only and LAN opt-in.")
    TEMP.cleanup()


if __name__ == "__main__":
    run()
