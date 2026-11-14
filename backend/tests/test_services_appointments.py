"""Service appointments: professional schedule validation (and charging, added later)."""
from __future__ import annotations

import os
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-services-test-")
os.environ["MANAGER_STOCK_DB"] = str(Path(TEMP.name) / "manager_stock_test.db")
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402
from backend.main import app  # noqa: E402

SERVICES_CONFIG = {"type": "services", "name": "Estudio Pruebas", "currency": "COP", "taxRate": 0,
                   "features": {"inventory": False, "pos": True, "reservations": True, "tables": False, "rooms": False,
                                "warehouse": False, "services": True, "delivery": False}}


def next_weekday(js_day: int) -> str:
    """Next date (from tomorrow) whose JavaScript getDay() equals js_day (0=domingo, 1=lunes)."""
    day = date.today() + timedelta(days=1)
    while day.isoweekday() % 7 != js_day:
        day += timedelta(days=1)
    return day.isoformat()


def setup_business(client: TestClient) -> tuple[dict, str, str, str]:
    token = client.post("/api/auth/register", json={"name": "Dueña Servicios", "email": "servicios@test.local", "password": "PruebaSegura123!"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.put("/api/business/config", headers=headers, json=SERVICES_CONFIG).status_code == 200
    service = client.post("/api/services/catalog", headers=headers, json={"name": "Corte", "durationMinutes": 30, "price": 25000}).json()
    scheduled = client.post("/api/services/professionals", headers=headers, json={
        "name": "Andrea Horario", "availability": [{"dia": 1, "inicio": "09:00", "fin": "12:00"}]}).json()
    free = client.post("/api/services/professionals", headers=headers, json={"name": "Sin Horario"}).json()
    return headers, service["id"], scheduled["id"], free["id"]


def book(client, headers, service_id, professional_id, day, start):
    return client.post("/api/services/appointments", headers=headers, json={
        "serviceId": service_id, "professionalId": professional_id, "clientName": "Cliente Prueba",
        "appointmentDate": day, "startTime": start})


def check_schedule(client: TestClient) -> None:
    headers, service_id, scheduled_id, free_id = setup_business(client)
    monday, tuesday = next_weekday(1), next_weekday(2)

    ok = book(client, headers, service_id, scheduled_id, monday, "10:00")
    assert ok.status_code == 201, ok.text
    assert book(client, headers, service_id, scheduled_id, monday, "11:45").status_code == 422, "ends 12:15, after the block"
    assert book(client, headers, service_id, scheduled_id, monday, "08:30").status_code == 422, "starts before the block"
    assert book(client, headers, service_id, scheduled_id, tuesday, "10:00").status_code == 422, "no block on tuesday"
    assert book(client, headers, service_id, free_id, tuesday, "03:00").status_code == 201, "no schedule = no restriction"

    moved = client.put(f"/api/services/appointments/{ok.json()['id']}", headers=headers, json={
        "serviceId": service_id, "professionalId": scheduled_id, "clientName": "Cliente Prueba",
        "appointmentDate": tuesday, "startTime": "10:00"})
    assert moved.status_code == 422, "editing must apply the same schedule rule"

    # Back-to-back bookings, then a 15-minute break is added: confirming an existing appointment still works.
    first = book(client, headers, service_id, scheduled_id, monday, "09:00")
    assert first.status_code == 201 and book(client, headers, service_id, scheduled_id, monday, "09:30").status_code == 201
    schedule = {"availability": [{"dia": 1, "inicio": "09:00", "fin": "12:00"}], "bufferMinutes": 15, "revision": 1}
    assert client.put(f"/api/services/professionals/{scheduled_id}/schedule", headers=headers, json=schedule).status_code == 200
    confirmed = client.patch(f"/api/services/appointments/{first.json()['id']}/status", headers=headers, json={"status": "confirmed"})
    assert confirmed.status_code == 200, confirmed.text


def check_charge(client: TestClient) -> None:
    token = client.post("/api/auth/login", json={"email": "servicios@test.local", "password": "PruebaSegura123!"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    service_id = client.get("/api/services/catalog", headers=headers).json()[0]["id"]
    free_id = next(p["id"] for p in client.get("/api/services/professionals", headers=headers).json() if p["name"] == "Sin Horario")
    day = next_weekday(4)
    first = book(client, headers, service_id, free_id, day, "15:00").json()
    second = book(client, headers, service_id, free_id, day, "16:00").json()

    def charge(appointment_id, method="card", session=None):
        return client.post("/api/sales", headers=headers, json={
            "idempotencyKey": f"cobro-{appointment_id}-{method}-{session}", "items": [], "appointmentIds": [appointment_id],
            "customer": "Cliente Prueba", "paymentMethod": method, "cashSessionId": session})

    assert charge(first["id"]).status_code == 409, "an appointment must be attended before charging"
    for appointment in (first, second):
        assert client.patch(f"/api/services/appointments/{appointment['id']}/status", headers=headers, json={"status": "attended"}).status_code == 200

    sale = charge(first["id"])
    assert sale.status_code == 201, sale.text
    sale = sale.json()
    assert sale["totalPrice"] == 25000 and sale["payments"] == [{"method": "card", "amount": 25000}]
    assert sale["items"][0]["productName"] == "Corte" and sale["items"][0]["productId"] is None
    assert charge(first["id"], method="cash").status_code == 409, "an appointment cannot be charged twice"
    listed = {a["id"]: a for a in client.get("/api/services/appointments", headers=headers).json()}
    assert listed[first["id"]]["saleId"] == sale["id"] and listed[second["id"]]["saleId"] is None
    assert any(s["id"] == sale["id"] for s in client.get("/api/sales", headers=headers).json())

    session = client.post("/api/cash/sessions", headers=headers, json={"openingAmount": 10000}).json()
    assert charge(second["id"], method="cash", session=session["id"]).status_code == 201
    assert client.get("/api/cash/sessions/current", headers=headers).json()["expectedAmount"] == 35000

    assert client.post(f"/api/sales/{sale['id']}/cancel", headers=headers).status_code == 200
    freed = {a["id"]: a for a in client.get("/api/services/appointments", headers=headers).json()}[first["id"]]
    assert freed["saleId"] is None, "cancelling the sale must free the appointment"
    assert charge(first["id"], method="digital").status_code == 201, "a cancelled charge frees the appointment"


def run() -> None:
    with TestClient(app) as client:
        check_schedule(client)
        check_charge(client)
    print("OK: professional schedule is enforced on create and edit; attended appointments are charged once as real sales (cash, reports, cancel).")
    TEMP.cleanup()


if __name__ == "__main__":
    run()
