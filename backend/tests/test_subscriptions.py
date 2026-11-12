"""Suscripciones: solicitudes, renovaciones mensuales, vencimientos y pagos duplicados."""
from __future__ import annotations

import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-subscriptions-test-")
os.environ["MANAGER_STOCK_DB"] = str(Path(TEMP.name) / "manager_stock_test.db")
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402
from backend.core import rate_limit  # noqa: E402
from backend.main import app, connection, hash_password  # noqa: E402

PASSWORD = "PruebaSegura123!"


def parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def close_to(actual: str, expected: datetime, seconds: int = 120) -> bool:
    return abs((parse(actual) - expected).total_seconds()) <= seconds


class World:
    def __init__(self, client: TestClient):
        self.client = client
        with connection() as conn:
            conn.execute("INSERT INTO auth_users (id,business_id,full_name,email,password_hash,role) VALUES ('SA-SUBS',NULL,'Plataforma','sa@subs.local',?,'superadmin')", (hash_password(PASSWORD),))
        self.sa = self.login("sa@subs.local")

    def login(self, email: str) -> dict:
        response = self.client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
        assert response.status_code == 200, response.text
        return {"Authorization": f"Bearer {response.json()['access_token']}"}

    def new_owner(self, email: str) -> tuple[dict, str]:
        rate_limit.reset_all()
        response = self.client.post("/api/auth/register", json={"name": "Dueña", "email": email, "password": PASSWORD})
        assert response.status_code == 201, response.text
        return {"Authorization": f"Bearer {response.json()['access_token']}"}, response.json()["user"]["businessId"]

    def request(self, owner: dict, plan_id: str) -> dict:
        response = self.client.put("/api/subscription", headers=owner, json={"planId": plan_id})
        assert response.status_code == 200, response.text
        return response.json()

    def platform(self, business_id: str, **body):
        return self.client.patch(f"/api/platform/subscriptions/{business_id}", headers=self.sa, json=body)

    def current(self, owner: dict) -> dict:
        return self.client.get("/api/subscription", headers=owner).json()

    @staticmethod
    def set_expiry(business_id: str, when: datetime) -> None:
        with connection() as conn:
            conn.execute("UPDATE business_subscriptions SET expires_at=? WHERE business_id=?", (when.isoformat(timespec="seconds"), business_id))


def check_first_payment(world: World) -> None:
    owner, business = world.new_owner("primero@subs.local")
    pending = world.request(owner, "business")
    assert pending["status"] == "pending_payment" and pending["plan"]["id"] == "free", "a first request must not unlock the paid plan"
    response = world.platform(business, action="confirm_payment", paymentReference="MP-0001")
    assert response.status_code == 200, response.text
    active = response.json()
    assert active["plan"]["id"] == "business" and active["status"] == "active"
    assert close_to(active["expiresAt"], datetime.now(timezone.utc) + timedelta(days=30))


def check_early_renewal_keeps_plan_and_days(world: World) -> None:
    owner, business = world.new_owner("renueva@subs.local")
    world.request(owner, "business")
    assert world.platform(business, action="confirm_payment", paymentReference="MP-0101").status_code == 200
    expiry = datetime.now(timezone.utc) + timedelta(days=10)
    world.set_expiry(business, expiry)

    pending = world.request(owner, "business")
    assert pending["status"] == "pending_payment"
    assert pending["plan"]["id"] == "business" and pending["plan"]["maxProducts"] == 5000, "requesting a renewal must not downgrade the plan in force"

    renewed = world.platform(business, action="confirm_payment", paymentReference="MP-0102").json()
    assert renewed["plan"]["id"] == "business" and renewed["status"] == "active"
    assert close_to(renewed["expiresAt"], expiry + timedelta(days=30)), f"early renewal must add 30 days to the current expiry: {renewed['expiresAt']}"


def check_monthly_renew_and_duplicates(world: World) -> None:
    owner, business = world.new_owner("mensual@subs.local")
    world.request(owner, "entrepreneur")
    assert world.platform(business, action="confirm_payment", paymentReference="MP-0201").status_code == 200
    expiry = datetime.now(timezone.utc) + timedelta(days=3)
    world.set_expiry(business, expiry)

    # El cobro automático del mes se registra sin que el propietario lo pida.
    response = world.platform(business, action="renew", paymentReference="MP-0202")
    assert response.status_code == 200, response.text
    assert response.json()["plan"]["id"] == "entrepreneur"
    assert close_to(response.json()["expiresAt"], expiry + timedelta(days=30))

    # La misma referencia no puede sumar otro mes, ni en este negocio ni en otro.
    duplicate = world.platform(business, action="renew", paymentReference="MP-0202")
    assert duplicate.status_code == 409, duplicate.text
    assert close_to(world.current(owner)["expiresAt"], expiry + timedelta(days=30)), "a rejected duplicate must not change the expiry"
    _, other_business = world.new_owner("otro@subs.local")
    assert world.platform(other_business, action="renew", planId="business", paymentReference="MP-0202").status_code == 409

    listed = {item["businessId"]: item for item in world.client.get("/api/platform/subscriptions", headers=world.sa).json()}
    assert listed[business]["lastPayment"]["paymentReference"] == "MP-0202"
    assert listed[business]["lastPayment"]["amountCOP"] == 39900


def check_expiry_while_renewal_pending(world: World) -> None:
    owner, business = world.new_owner("vencida@subs.local")
    world.request(owner, "business")
    assert world.platform(business, action="confirm_payment", paymentReference="MP-0301").status_code == 200
    world.request(owner, "business")
    world.set_expiry(business, datetime.now(timezone.utc) - timedelta(minutes=1))

    lapsed = world.current(owner)
    assert lapsed["plan"]["id"] == "free", "an expired plan must not stay in force while the renewal is pending"
    assert lapsed["status"] == "pending_payment" and lapsed["pendingPlan"]["id"] == "business", "the renewal request must survive expiry"

    renewed = world.platform(business, action="confirm_payment", paymentReference="MP-0302").json()
    assert renewed["plan"]["id"] == "business"
    assert close_to(renewed["expiresAt"], datetime.now(timezone.utc) + timedelta(days=30)), "a lapsed plan restarts from today"


def check_renew_after_expiry_uses_last_plan(world: World) -> None:
    owner, business = world.new_owner("tarde@subs.local")
    world.request(owner, "enterprise")
    assert world.platform(business, action="confirm_payment", paymentReference="MP-0401").status_code == 200
    world.set_expiry(business, datetime.now(timezone.utc) - timedelta(days=2))
    assert world.current(owner)["status"] == "expired"

    renewed = world.platform(business, action="renew", paymentReference="MP-0402")
    assert renewed.status_code == 200, renewed.text
    assert renewed.json()["plan"]["id"] == "enterprise" and renewed.json()["status"] == "active"


def check_renew_validation_and_cancel(world: World) -> None:
    owner, business = world.new_owner("validar@subs.local")
    assert world.platform(business, action="renew", paymentReference="MP-0501").status_code == 422, "a never-paid free business needs an explicit plan"
    assert world.platform(business, action="renew", planId="business", paymentReference="abc").status_code == 422, "short references are rejected"
    assert world.platform(business, action="renew", planId="business", paymentReference="MP-0502").status_code == 200

    before = world.current(owner)
    world.request(owner, "enterprise")
    cancelled = world.platform(business, action="cancel_request").json()
    assert cancelled["plan"]["id"] == "business" and cancelled["status"] == "active" and cancelled["pendingPlan"] is None
    assert cancelled["expiresAt"] == before["expiresAt"], "cancelling a request must keep the plan and expiry in force"
    assert world.platform(business, action="cancel_request").status_code == 409

    # Un plan distinto empieza hoy; no se arrastran días de otro plan.
    upgraded_owner_request = world.request(owner, "enterprise")
    assert upgraded_owner_request["plan"]["id"] == "business"
    upgraded = world.platform(business, action="confirm_payment", paymentReference="MP-0503").json()
    assert upgraded["plan"]["id"] == "enterprise"
    assert close_to(upgraded["expiresAt"], datetime.now(timezone.utc) + timedelta(days=30))

    assert world.client.patch(f"/api/platform/subscriptions/{business}", headers=owner, json={"action": "renew", "planId": "business", "paymentReference": "MP-0504"}).status_code == 403


def check_payment_links(world: World) -> None:
    from backend.core import config

    original = dict(config.SUBSCRIPTION_PAYMENT_LINKS)
    try:
        def links() -> dict:
            return {plan["id"]: plan["paymentUrl"] for plan in world.client.get("/api/subscription/plans").json()}

        config.SUBSCRIPTION_PAYMENT_LINKS.update({"entrepreneur": "", "business": "", "enterprise": ""})
        assert links() == {"free": None, "entrepreneur": None, "business": None, "enterprise": None}, "empty links must not show a pay button"

        config.SUBSCRIPTION_PAYMENT_LINKS.update({
            "entrepreneur": "  https://www.mercadopago.com.co/subscriptions/checkout?preapproval_plan_id=abc  ",
            "business": "javascript:alert(1)",
            "enterprise": "http://inseguro.example/plan",
        })
        result = links()
        assert result["entrepreneur"] == "https://www.mercadopago.com.co/subscriptions/checkout?preapproval_plan_id=abc"
        assert result["business"] is None and result["enterprise"] is None, "only https links are exposed"
        assert result["free"] is None
    finally:
        config.SUBSCRIPTION_PAYMENT_LINKS.clear()
        config.SUBSCRIPTION_PAYMENT_LINKS.update(original)


def run() -> None:
    with TestClient(app) as client:
        world = World(client)
        check_payment_links(world)
        check_first_payment(world)
        check_early_renewal_keeps_plan_and_days(world)
        check_monthly_renew_and_duplicates(world)
        check_expiry_while_renewal_pending(world)
        check_renew_after_expiry_uses_last_plan(world)
        check_renew_validation_and_cancel(world)
    print("OK: first payment, early renewal keeps plan and days, monthly renew, duplicate references, expiry with pending renewal, late renewal, validation and cancel.")
    TEMP.cleanup()


if __name__ == "__main__":
    run()
