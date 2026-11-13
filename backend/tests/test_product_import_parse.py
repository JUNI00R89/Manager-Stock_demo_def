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

    # Numeric cells with decimals keep their value (0.125 kg is not 125).
    decimals = xlsx([["Nombre", "SKU", "Categoría", "Precio", "Stock", "Costo"], ["Queso", "QS1", "Lácteos", 1.25, 0.125, 1250.5]])
    fields = read_rows("d.xlsx", decimals)[0][1]
    payload = row_to_payload({**fields, "unit": "kg"})
    assert (payload.price, payload.stock, payload.cost) == (1.25, 0.125, 1250.5), (payload.price, payload.stock, payload.cost)

    # A huge sheet stops at the row limit instead of reading everything first.
    from openpyxl import Workbook as _Workbook
    import time
    book = _Workbook(write_only=True)
    sheet = book.create_sheet()
    sheet.append(["Nombre", "SKU", "Categoría", "Precio"])
    for i in range(150_000):
        sheet.append([f"P{i}", f"S{i}", "C", 1])
    big = BytesIO()
    book.save(big)
    from openpyxl import load_workbook
    started = time.perf_counter()
    load_workbook(BytesIO(big.getvalue()), read_only=True, data_only=True).worksheets[0]
    opening = time.perf_counter() - started  # bounded by the 2 MB file limit; reading every row costs ~5x more
    started = time.perf_counter()
    raises(read_rows, "big.xlsx", big.getvalue(), contains="2000")
    elapsed = time.perf_counter() - started
    assert elapsed < opening * 2 + 1, f"read_rows took {elapsed:.1f}s vs {opening:.1f}s to open: it should stop after 2001 rows"

    template_rows = read_rows("t.xlsx", build_template())
    assert template_rows and template_rows[0][1]["sku"] and row_to_payload(template_rows[0][1])

    print("OK: import reads Excel/CSV in Spanish formats and validates each row.")


if __name__ == "__main__":
    run()
