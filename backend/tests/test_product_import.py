"""Product import API: preview saves nothing, import creates only new products, honours plan limit and permissions."""
from __future__ import annotations

import base64
import os
import sqlite3
import sys
import tempfile
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMP = tempfile.TemporaryDirectory(prefix="manager-stock-import-test-")
DB = Path(TEMP.name) / "manager_stock_test.db"
os.environ["MANAGER_STOCK_DB"] = str(DB)
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402
from openpyxl import Workbook  # noqa: E402

from backend.main import app  # noqa: E402
from backend.services.product_import import read_rows  # noqa: E402

RETAIL = {"type": "retail", "name": "Tienda Import", "currency": "COP", "taxRate": 0,
          "features": {"inventory": True, "pos": True, "reservations": False, "tables": False, "rooms": False,
                       "warehouse": False, "services": False, "delivery": False}}
HEADER = ["Nombre", "Código (SKU)", "Categoría", "Precio", "Stock"]


def xlsx_body(rows: list[list], name: str = "productos.xlsx") -> dict:
    book = Workbook()
    for row in [HEADER, *rows]:
        book.active.append(row)
    out = BytesIO()
    book.save(out)
    return {"fileName": name, "dataUrl": "data:application/octet-stream;base64," + base64.b64encode(out.getvalue()).decode()}


def owner(client: TestClient, email: str) -> dict:
    token = client.post("/api/auth/register", json={"name": "Dueño Import", "email": email, "password": "PruebaSegura123!"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.put("/api/business/config", headers=headers, json=RETAIL).status_code == 200
    return headers


def business_id(client: TestClient, headers: dict) -> str:
    return client.get("/api/auth/me", headers=headers).json()["businessId"]


def sql(query: str, params: tuple = ()) -> list:
    conn = sqlite3.connect(DB)
    try:
        rows = conn.execute(query, params).fetchall()
        conn.commit()
        return rows
    finally:
        conn.close()  # Windows cannot delete the temp DB while a connection is open


def run() -> None:
    with TestClient(app) as client:
        h = owner(client, "import@test.local")
        assert client.post("/api/product-categories", headers=h, json={"name": "Bebidas"}).status_code in (201, 409)  # 409: default category
        assert client.post("/api/products", headers=h, json={"name": "Agua", "sku": "AG1", "category": "Bebidas", "price": 2000, "cost": 900, "stock": 5, "minStock": 1}).status_code == 201

        rows = [
            ["Leche", "LE1", "Lácteos", "$ 4.200", 12],     # row 2: new category
            ["Queso", "QU1", "lacteos", 9000, 0],          # row 3: same category, other spelling
            ["Jabón", "JA1", "Aseo", "3.500", 4],          # row 4
            ["Agua otra", "ag1", "Bebidas", 2100, 1],      # row 5: SKU already in the business
            ["Leche 2", "LE1", "Lácteos", 4300, 1],        # row 6: SKU repeated in the file
            ["Sin precio", "SP1", "Aseo", None, 1],        # row 7: error
        ]
        before = len(client.get("/api/products", headers=h).json())
        preview = client.post("/api/products/import/preview", headers=h, json=xlsx_body(rows))
        assert preview.status_code == 200, preview.text
        report = preview.json()
        assert [p["sku"] for p in report["toCreate"]] == ["LE1", "QU1", "JA1"]
        assert report["skipped"] == [{"row": 5, "sku": "AG1", "name": "Agua otra"}]
        assert [e["row"] for e in report["errors"]] == [6, 7], report["errors"]
        assert "repetido en el archivo" in report["errors"][0]["message"] and "precio" in report["errors"][1]["message"].lower()
        assert report["newCategories"] == ["Lácteos"] and report["created"] == 0, "Aseo is a retail default category"
        assert len(client.get("/api/products", headers=h).json()) == before, "preview saves nothing"

        done = client.post("/api/products/import", headers=h, json=xlsx_body(rows)).json()
        assert done["created"] == 3, done
        products = {p["sku"]: p for p in client.get("/api/products", headers=h).json()}
        assert products["LE1"]["stock"] == 12 and products["LE1"]["price"] == 4200 and products["QU1"]["category"] == "Lácteos"
        openings = sql("SELECT p.sku FROM inventory_movements m JOIN products p ON p.id=m.product_id WHERE m.movement_type='opening' AND p.sku IN ('LE1','QU1','JA1')")
        assert sorted(r[0] for r in openings) == ["JA1", "LE1"], "opening movement only when stock > 0"
        names = [c["name"] for c in client.get("/api/product-categories", headers=h).json()]
        assert "Lácteos" in names and "Aseo" in names

        again = client.post("/api/products/import", headers=h, json=xlsx_body(rows)).json()
        assert again["created"] == 0 and len(again["skipped"]) == 4 and 6 in [e["row"] for e in again["errors"]]

        # A deactivated category with the same name is reactivated, not a 500 from the unique index.
        assert client.post("/api/product-categories", headers=h, json={"name": "Congelados", "active": False}).status_code == 201
        frozen = [["Helado", "HE1", "congelados", 7000, 2]]
        frozen_preview = client.post("/api/products/import/preview", headers=h, json=xlsx_body(frozen)).json()
        assert frozen_preview["newCategories"] == ["Congelados"], frozen_preview
        frozen_import = client.post("/api/products/import", headers=h, json=xlsx_body(frozen))
        assert frozen_import.status_code == 200 and frozen_import.json()["created"] == 1, frozen_import.text
        assert "Congelados" in [c["name"] for c in client.get("/api/product-categories", headers=h).json()]
        assert client.get("/api/products", headers=h).json() and next(p for p in client.get("/api/products", headers=h).json() if p["sku"] == "HE1")["category"] == "Congelados"

        # A legacy lowercase code and an archived product are both "already exists"; the archived one says so.
        bid_codes = business_id(client, h)
        sql("INSERT INTO products (id,business_id,name,sku,category,price,cost,stock,min_stock) VALUES (?,?,?,?,?,?,?,?,?)",
            ("PRD-LEGACY01", bid_codes, "Legado", "leg1", "Bebidas", 1, 0, 0, 0))
        archived = client.post("/api/products", headers=h, json={"name": "Archivado", "sku": "ARCH1", "category": "Bebidas", "price": 1, "cost": 0, "stock": 0, "minStock": 0}).json()
        assert client.delete(f"/api/products/{archived['id']}", headers=h).status_code in (200, 204)
        codes_report = client.post("/api/products/import/preview", headers=h, json=xlsx_body([["Legado", "LEG1", "Bebidas", 1, 0], ["Archivado", "ARCH1", "Bebidas", 1, 0]])).json()
        assert codes_report["toCreate"] == [] and [s.get("archived", False) for s in codes_report["skipped"]] == [False, True], codes_report

        # Rows without a code get a generated SKU; without a code, duplicates are detected by name.
        bread = [["Pan blanco", None, "Panadería", 500, 10], ["Pan integral", "PAN-0009", "Panadería", 700, 5], ["pan BLANCO", None, "Panadería", 500, 1]]
        bread_preview = client.post("/api/products/import/preview", headers=h, json=xlsx_body(bread)).json()
        assert [p["sku"] for p in bread_preview["toCreate"]] == ["", "PAN-0009"], bread_preview
        assert bread_preview["skipped"] == [] and "repetido" in bread_preview["errors"][0]["message"], bread_preview
        assert client.post("/api/products/import", headers=h, json=xlsx_body(bread)).json()["created"] == 2
        skus = {p["name"]: p["sku"] for p in client.get("/api/products", headers=h).json()}
        assert skus["Pan blanco"] == "PAN-0010", "generated code avoids the typed PAN-0009 from the same file"
        assert client.post("/api/products/import", headers=h, json=xlsx_body(bread)).json()["created"] == 0

        # An archived product's name does not block importing it again without a code.
        old_bread = client.post("/api/products", headers=h, json={"name": "Pan viejo", "category": "Panadería", "price": 400, "cost": 0, "stock": 0, "minStock": 0}).json()
        assert client.delete(f"/api/products/{old_bread['id']}", headers=h).status_code in (200, 204)
        revived = client.post("/api/products/import", headers=h, json=xlsx_body([["Pan viejo", None, "Panadería", 450, 3]])).json()
        assert revived["created"] == 1 and revived["skipped"] == [], revived

        # Catalog changes between preview and confirm: the new SKU is skipped, not a server error.
        late = [["Nuevo", "NEW1", "Bebidas", 1000, 0]]
        assert len(client.post("/api/products/import/preview", headers=h, json=xlsx_body(late)).json()["toCreate"]) == 1
        assert client.post("/api/products", headers=h, json={"name": "Nuevo", "sku": "NEW1", "category": "Bebidas", "price": 1000, "cost": 0, "stock": 0, "minStock": 0}).status_code == 201
        raced = client.post("/api/products/import", headers=h, json=xlsx_body(late))
        assert raced.status_code == 200 and raced.json()["created"] == 0 and raced.json()["skipped"] == [{"row": 2, "sku": "NEW1", "name": "Nuevo"}]

        # Plan limit (free plan: 100 active products). Fill up to 98, then import 3.
        bid = business_id(client, h)
        active = sql("SELECT count(*) FROM products WHERE business_id=? AND active=1", (bid,))[0][0]
        for i in range(98 - active):
            sql("INSERT INTO products (id,business_id,name,sku,category,price,cost,stock,min_stock) VALUES (?,?,?,?,?,?,?,?,?)",
                (f"PRD-FILL{i:04d}", bid, f"Relleno {i}", f"FILL{i}", "Bebidas", 1, 0, 0, 0))
        limited = client.post("/api/products/import", headers=h, json=xlsx_body([["L1", "LIM1", "Bebidas", 1, 0], ["L2", "LIM2", "Bebidas", 1, 0], ["L3", "LIM3", "Bebidas", 1, 0]])).json()
        assert limited["created"] == 2 and len(limited["errors"]) == 1 and "plan" in limited["errors"][0]["message"].lower(), limited

        # Another business sees nothing of these SKUs and imports them into its own catalog.
        other = owner(client, "otro-import@test.local")
        other_preview = client.post("/api/products/import/preview", headers=other, json=xlsx_body(rows)).json()
        assert [p["sku"] for p in other_preview["toCreate"]] == ["LE1", "QU1", "JA1", "AG1"]
        assert client.post("/api/products/import", headers=other, json=xlsx_body(rows)).json()["created"] == 4

        # A cashier cannot import.
        sql("UPDATE business_subscriptions SET plan_id='entrepreneur' WHERE business_id=?", (bid,))
        assert client.post("/api/users", headers=h, json={"name": "Caja", "email": "caja-import@test.local", "password": "PruebaSegura123!", "role": "cashier"}).status_code == 201
        cashier_token = client.post("/api/auth/login", json={"email": "caja-import@test.local", "password": "PruebaSegura123!"}).json()["access_token"]
        cashier = {"Authorization": f"Bearer {cashier_token}"}
        assert client.post("/api/products/import/preview", headers=cashier, json=xlsx_body(late)).status_code == 403
        assert client.post("/api/products/import", headers=cashier, json=xlsx_body(late)).status_code == 403

        # Bad files.
        assert client.post("/api/products/import/preview", headers=h, json={"fileName": "lista.pdf", "dataUrl": xlsx_body(late)["dataUrl"]}).status_code == 422
        assert client.post("/api/products/import/preview", headers=h, json={"fileName": "lista.csv", "dataUrl": "data:text/csv;base64,@@@@@@@@@@@@@@@@@@@@"}).status_code == 422
        big = "data:text/csv;base64," + base64.b64encode(b"a" * (2 * 1024 * 1024 + 10)).decode()
        assert client.post("/api/products/import/preview", headers=h, json={"fileName": "lista.csv", "dataUrl": big}).status_code == 422

        template = client.get("/api/products/import/template", headers=h).json()
        assert template["fileName"].endswith(".xlsx")
        assert read_rows(template["fileName"], base64.b64decode(template["dataUrl"].split(",", 1)[1]))

    print("OK: product import previews, creates only new products, respects plan, tenant and permissions.")
    TEMP.cleanup()


if __name__ == "__main__":
    run()
