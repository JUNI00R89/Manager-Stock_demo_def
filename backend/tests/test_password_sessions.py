"""Users change their own password, the owner resets an employee's, and anyone can sign out every other device."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-passwords-test-")
os.environ["MANAGER_STOCK_DB"] = str(Path(TEMP.name) / "manager_stock_test.db")
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402
from backend.core.db import connection  # noqa: E402
from backend.core.rate_limit import reset_all  # noqa: E402
from backend.main import app  # noqa: E402

RETAIL = {"type": "retail", "name": "Tienda Claves", "currency": "COP", "taxRate": 0,
          "features": {"inventory": True, "pos": True}}
OWNER_PASSWORD = "DuenaSegura123!"
CASHIER_PASSWORD = "CajeroSeguro123!"


def run() -> None:
    reset_all()
    with TestClient(app) as client:
        def login(email: str, password: str):
            return client.post("/api/auth/login", json={"email": email, "password": password})

        def bearer(response) -> dict:
            return {"Authorization": "Bearer " + response.json()["access_token"]}

        owner = client.post("/api/auth/register", json={"name": "Dueña", "email": "duena@claves.local", "password": OWNER_PASSWORD})
        laptop = bearer(owner)
        assert client.put("/api/business/config", headers=laptop, json=RETAIL).status_code == 200
        phone = bearer(login("duena@claves.local", OWNER_PASSWORD))

        # 1. Changing the own password needs the current one and a valid new one.
        wrong = client.post("/api/auth/me/password", headers=laptop, json={"currentPassword": "NoEsLaClave1", "newPassword": "NuevaClave456!"})
        assert wrong.status_code == 400, wrong.text
        short = client.post("/api/auth/me/password", headers=laptop, json={"currentPassword": OWNER_PASSWORD, "newPassword": "corta"})
        assert short.status_code == 422, short.text
        same = client.post("/api/auth/me/password", headers=laptop, json={"currentPassword": OWNER_PASSWORD, "newPassword": OWNER_PASSWORD})
        assert same.status_code == 422, same.text
        changed = client.post("/api/auth/me/password", headers=laptop, json={"currentPassword": OWNER_PASSWORD, "newPassword": "NuevaClave456!"})
        assert changed.status_code == 200, changed.text
        # ...keeps this device signed in, closes the others, and only the new password works.
        assert client.get("/api/auth/me", headers=laptop).status_code == 200
        assert client.get("/api/auth/me", headers=phone).status_code == 401
        assert login("duena@claves.local", OWNER_PASSWORD).status_code == 401
        assert login("duena@claves.local", "NuevaClave456!").status_code == 200

        # 2. Sign out every other device.
        tablet = bearer(login("duena@claves.local", "NuevaClave456!"))
        closed = client.post("/api/auth/logout-all", headers=laptop)
        assert closed.status_code == 200 and closed.json()["closedSessions"] >= 1, closed.text
        assert client.get("/api/auth/me", headers=tablet).status_code == 401
        assert client.get("/api/auth/me", headers=laptop).status_code == 200

        # 3. The owner resets an employee's password; the employee's sessions close.
        with connection() as conn:  # lift the free-plan user limit
            conn.execute("INSERT INTO business_subscriptions (business_id,plan_id,status) VALUES (?, 'enterprise','active') ON CONFLICT(business_id) DO UPDATE SET plan_id='enterprise',status='active'", (owner.json()["user"]["businessId"],))
        cashier = client.post("/api/users", headers=laptop, json={"name": "Cajero", "email": "cajero@claves.local", "password": CASHIER_PASSWORD, "role": "cashier"}).json()
        cashier_session = bearer(login("cajero@claves.local", CASHIER_PASSWORD))
        reset = client.post(f"/api/users/{cashier['id']}/password", headers=laptop, json={"newPassword": "Temporal789!"})
        assert reset.status_code == 200, reset.text
        assert client.get("/api/auth/me", headers=cashier_session).status_code == 401
        assert login("cajero@claves.local", CASHIER_PASSWORD).status_code == 401
        cashier_session = bearer(login("cajero@claves.local", "Temporal789!"))

        # 4. The cashier can change their own password but cannot reset anybody else's.
        own = client.post("/api/auth/me/password", headers=cashier_session, json={"currentPassword": "Temporal789!", "newPassword": "MiClaveCajero1!"})
        assert own.status_code == 200, own.text
        owner_id = owner.json()["user"]["id"]
        assert client.post(f"/api/users/{owner_id}/password", headers=cashier_session, json={"newPassword": "Hackeo12345!"}).status_code == 403
        # Nor can the owner reset their own password through employee management.
        assert client.post(f"/api/users/{owner_id}/password", headers=laptop, json={"newPassword": "OtraClave123!"}).status_code == 403
        # 5. The platform SUPERADMIN (no business) can change their password too.
        from backend.core.security import hash_password
        with connection() as conn:
            conn.execute("INSERT INTO auth_users (id,business_id,full_name,email,password_hash,role,active) VALUES ('SA-TEST',NULL,'Plataforma','sa@claves.local',?,'superadmin',1)", (hash_password("Plataforma123!"),))
        admin = bearer(login("sa@claves.local", "Plataforma123!"))
        sa = client.post("/api/auth/me/password", headers=admin, json={"currentPassword": "Plataforma123!", "newPassword": "Plataforma456!"})
        assert sa.status_code == 200, sa.text
        assert client.post("/api/auth/logout-all", headers=admin).status_code == 200
    print("OK: cambio de contraseña, restablecer empleado y cerrar sesiones")


def test_password_sessions() -> None:
    run()


if __name__ == "__main__":
    run()
