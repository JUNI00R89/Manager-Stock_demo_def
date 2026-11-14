"""Rooms, services, professionals and suppliers can be edited, only inside their own business."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-edit-catalogs-")
os.environ["MANAGER_STOCK_DB"] = str(Path(TEMP.name) / "manager_stock_test.db")
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from backend.main import app  # noqa: E402

FEATURES = {"inventory": True, "pos": True, "reservations": True, "tables": False, "rooms": True,
            "warehouse": False, "services": True, "delivery": False}


def owner(client: TestClient, email: str, kind: str) -> dict:
    token = client.post("/api/auth/register", json={"name": "Dueño Editar", "email": email, "password": "PruebaSegura123!"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    config = {"type": kind, "name": f"Negocio {kind}", "currency": "COP", "taxRate": 0, "features": FEATURES}
    assert client.put("/api/business/config", headers=headers, json=config).status_code == 200
    return headers


def run() -> None:
    with TestClient(app) as client:
        hotel = owner(client, "hotel@editar.local", "hotel")
        other_hotel = owner(client, "hotel2@editar.local", "hotel")
        room = client.post("/api/hotel/rooms", headers=hotel, json={"roomNumber": "101", "roomType": "double", "pricePerNight": 120000, "status": "occupied"}).json()
        client.post("/api/hotel/rooms", headers=hotel, json={"roomNumber": "102"})
        edited = client.put(f"/api/hotel/rooms/{room['id']}", headers=hotel, json={"roomNumber": "101A", "roomType": "suite", "floor": 2, "capacity": 3, "pricePerNight": 180000, "status": "available", "amenities": ["TV"]})
        assert edited.status_code == 200, edited.text
        body = edited.json()
        assert (body["numero"] if "numero" in body else body.get("roomNumber")) in ("101A",), body
        assert body.get("status", body.get("estado")) in ("occupied", "ocupada"), "editing never changes the occupancy state"
        assert client.put(f"/api/hotel/rooms/{room['id']}", headers=hotel, json={"roomNumber": "102"}).status_code == 409
        assert client.put(f"/api/hotel/rooms/{room['id']}", headers=other_hotel, json={"roomNumber": "999"}).status_code == 404

        spa = owner(client, "spa@editar.local", "services")
        other_spa = owner(client, "spa2@editar.local", "services")
        service = client.post("/api/services/catalog", headers=spa, json={"name": "Corte", "durationMinutes": 30, "price": 25000}).json()
        changed = client.put(f"/api/services/catalog/{service['id']}", headers=spa, json={"name": "Corte clásico", "durationMinutes": 45, "price": 30000, "category": "Cabello", "color": "#112233"})
        assert changed.status_code == 200, changed.text
        assert client.put(f"/api/services/catalog/{service['id']}", headers=other_spa, json={"name": "Robo"}).status_code == 404
        pro = client.post("/api/services/professionals", headers=spa, json={"name": "Andrea", "availability": [{"dia": 1, "inicio": "09:00", "fin": "12:00"}]}).json()
        renamed = client.put(f"/api/services/professionals/{pro['id']}", headers=spa, json={"name": "Andrea López", "specialty": "Color", "color": "#445566"})
        assert renamed.status_code == 200, renamed.text
        listed = {p["id"]: p for p in client.get("/api/services/professionals", headers=spa).json()}[pro["id"]]
        assert "López" in str(listed) and "09:00" in str(listed), "editing keeps the schedule"
        assert client.put(f"/api/services/professionals/{pro['id']}", headers=other_spa, json={"name": "Robo"}).status_code == 404

        shop = owner(client, "tienda@editar.local", "retail")
        other_shop = owner(client, "tienda2@editar.local", "retail")
        supplier = client.post("/api/suppliers", headers=shop, json={"name": "Juan", "company": "Lácteos SA"}).json()
        updated = client.put(f"/api/suppliers/{supplier['id']}", headers=shop, json={"name": "Juan Pérez", "company": "Lácteos del Valle", "phone": "3001112233"})
        assert updated.status_code == 200 and updated.json()["company"] == "Lácteos del Valle", updated.text
        assert client.put(f"/api/suppliers/{supplier['id']}", headers=other_shop, json={"name": "Robo", "company": "Robo SA"}).status_code == 404

    print("OK: rooms, services, professionals and suppliers can be edited within their own business.")
    TEMP.cleanup()


if __name__ == "__main__":
    run()
