"""Product import parsing: Colombian numbers, Excel CSV in Spanish, flexible headers, template round-trip."""
from __future__ import annotations

import sys
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from openpyxl import Workbook  # noqa: E402

from backend.services.product_import import (  # noqa: E402
    ImportFileError, build_template, decode_data_url, parse_number, read_rows, row_to_payload,
)


def xlsx(rows: list[list]) -> bytes:
    book = Workbook()
    sheet = book.active
    for row in rows:
        sheet.append(row)
    out = BytesIO()
    book.save(out)
    return out.getvalue()


def raises(fn, *args, contains: str = "") -> str:
    try:
        fn(*args)
    except (ImportFileError, ValueError) as exc:
        assert contains.lower() in str(exc).lower(), str(exc)
        return str(exc)
    raise AssertionError(f"{fn.__name__} did not raise")


def run() -> None:
    assert parse_number("$ 1.500") == 1500 and parse_number("2,5") == 2.5 and parse_number("1.234,5") == 1234.5
    assert parse_number("1500.0") == 1500 and parse_number("") is None and parse_number("0.75") == 0.75
    raises(parse_number, "abc")

    csv = "Nombre;CÓDIGO (SKU);categoria;Precio;Stock minimo\nCafé;cf1;Bebidas;$ 2.500;3\n;;;;\n".encode("cp1252")
    assert read_rows("lista.csv", csv) == [(2, {"name": "Café", "sku": "cf1", "category": "Bebidas", "price": "$ 2.500", "minStock": "3"})]
    utf8_comma = "﻿nombre,sku,categoría,precio\nTé,t1,Bebidas,1200\n".encode("utf-8")
    assert read_rows("x.CSV", utf8_comma) == [(2, {"name": "Té", "sku": "t1", "category": "Bebidas", "price": "1200"})]

    book = xlsx([["Nombre", "Código", "Categoría", "Precio", "Codigo de barras"], ["Agua", "AG1", "Bebidas", 1500.0, 7701234], [None, None, None, None, None]])
    assert read_rows("p.xlsx", book) == [(2, {"name": "Agua", "sku": "AG1", "category": "Bebidas", "price": "1500", "barcode": "7701234"})]

    raises(read_rows, "p.xlsx", xlsx([["Nombre", "SKU", "Categoría"], ["A", "B", "C"]]), contains="Precio")
    raises(read_rows, "p.xlsx", xlsx([["Nombre", "SKU", "Categoría", "Precio"]] + [["A", f"S{i}", "C", 1] for i in range(2001)]), contains="2000")
    raises(read_rows, "p.pdf", b"%PDF", contains=".xlsx")

    payload = row_to_payload({"name": "Café", "sku": "cf1", "category": "Bebidas", "price": "2500", "productType": "Insumo"})
    assert payload.sku == "CF1" and payload.productType == "ingredient" and payload.stock == 0 and payload.price == 2500
    raises(row_to_payload, {"name": "Café", "sku": "cf1", "category": "Bebidas"}, contains="precio")
    raises(row_to_payload, {"name": "Café", "sku": "cf1", "category": "Bebidas", "price": "dos mil"}, contains="precio")
    raises(row_to_payload, {"name": "Café", "sku": "cf1", "category": "Bebidas", "price": "1", "productType": "regalo"}, contains="tipo")

    raises(decode_data_url, "data:text/csv;base64,@@@", contains="archivo")
    raises(decode_data_url, "data:text/csv;base64," + "A" * (3 * 1024 * 1024), contains="2 MB")

    template_rows = read_rows("t.xlsx", build_template())
    assert template_rows and template_rows[0][1]["sku"] and row_to_payload(template_rows[0][1])

    print("OK: import reads Excel/CSV in Spanish formats and validates each row.")


if __name__ == "__main__":
    run()
