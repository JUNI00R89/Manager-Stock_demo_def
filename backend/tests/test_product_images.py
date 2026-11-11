"""Product photos: upload (validated by content), replace/remove without orphans, serve safely."""
from __future__ import annotations

import base64
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-images-test-")
os.environ["MANAGER_STOCK_DB"] = str(Path(TEMP.name) / "manager_stock_test.db")
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402
from backend.core.config import UPLOADS_DIR  # noqa: E402
from backend.main import app  # noqa: E402

PNG_1X1 = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
RETAIL = {"type": "retail", "name": "Tienda Fotos", "currency": "COP", "taxRate": 0,
          "features": {"inventory": True, "pos": True, "reservations": False, "tables": False, "rooms": False,
                       "warehouse": False, "services": False, "delivery": False}}


def data_url(raw: bytes, mime: str = "image/png") -> str:
    return f"data:{mime};base64,{base64.b64encode(raw).decode()}"


def owner(client: TestClient, email: str) -> dict:
    token = client.post("/api/auth/register", json={"name": "Dueña Fotos", "email": email, "password": "PruebaSegura123!"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.put("/api/business/config", headers=headers, json=RETAIL).status_code == 200
    return headers


def run() -> None:
    with TestClient(app) as client:
        h = owner(client, "fotos@test.local")
        product = client.post("/api/products", headers=h, json={"name": "Agua", "sku": "AG1", "category": "Bebidas", "price": 2000, "cost": 1000, "stock": 5, "minStock": 1}).json()
        url = f"/api/products/{product['id']}/image"

        first = client.put(url, headers=h, json={"dataUrl": data_url(PNG_1X1)})
        assert first.status_code == 200, first.text
        path = first.json()["image"]
        assert path.startswith("/uploads/products/") and path.endswith(".png"), path
        served = client.get(path)
        assert served.status_code == 200 and served.content == PNG_1X1

        assert client.put(url, headers=h, json={"dataUrl": data_url(b"<html>hola</html>", "text/html")}).status_code == 422
        assert client.put(url, headers=h, json={"dataUrl": data_url(b"no soy una imagen")}).status_code == 422, "type is checked by content"
        assert client.put(url, headers=h, json={"dataUrl": data_url(b"\x89PNG" + b"0" * 520_000)}).status_code == 422, "max 500 KB"

        edit = {"name": "Agua grande", "sku": "AG1", "category": "Bebidas", "price": 2500, "cost": 1000, "stock": 5, "minStock": 1, "image": "food"}
        edited = client.put(f"/api/products/{product['id']}", headers=h, json=edit)
        assert edited.status_code == 200 and edited.json()["image"] == path, "editing other fields keeps the uploaded photo"

        old_file = UPLOADS_DIR / "products" / path.rsplit("/", 1)[1]
        second = client.put(url, headers=h, json={"dataUrl": data_url(PNG_1X1)}).json()["image"]
        assert second != path and not old_file.exists(), "replacing removes the previous file"

        other = owner(client, "otra@test.local")
        assert client.put(url, headers=other, json={"dataUrl": data_url(PNG_1X1)}).status_code == 404
        assert client.delete(url, headers=other).status_code == 404

        # A client cannot point a product at a stored photo through the normal save, then delete it.
        victim_file = UPLOADS_DIR / "products" / second.rsplit("/", 1)[1]
        hijack = client.post("/api/products", headers=other, json={"name": "Robo", "sku": "RB1", "category": "Bebidas", "price": 1, "cost": 0, "stock": 1, "minStock": 0, "image": second})
        assert hijack.status_code == 201 and hijack.json()["image"] == "", "create ignores client-sent upload paths"
        plain = client.post("/api/products", headers=other, json={"name": "Otro", "sku": "OT1", "category": "Bebidas", "price": 1, "cost": 0, "stock": 1, "minStock": 0}).json()
        edited_other = client.put(f"/api/products/{plain['id']}", headers=other, json={"name": "Otro", "sku": "OT1", "category": "Bebidas", "price": 1, "cost": 0, "stock": 1, "minStock": 0, "image": second})
        assert edited_other.json()["image"] == "", "update ignores client-sent upload paths"
        for hijacked_id in (hijack.json()["id"], plain["id"]):
            client.delete(f"/api/products/{hijacked_id}/image", headers=other)
        assert victim_file.exists(), "another business's photo survives"

        removed = client.delete(url, headers=h)
        assert removed.status_code == 200 and removed.json()["image"] == ""
        assert not (UPLOADS_DIR / "products" / second.rsplit("/", 1)[1]).exists(), "removing deletes the file"

        assert client.get("/uploads/products/..%2F..%2Fmanager_stock_test.db").status_code == 404
        assert client.get("/uploads/products/no-existe.jpg").status_code == 404

    print("OK: product photos validated by content, replaced/removed without orphans, served safely.")
    TEMP.cleanup()


if __name__ == "__main__":
    run()
