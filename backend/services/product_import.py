"""Read a product list from Excel (.xlsx) or CSV and turn each row into a ProductPayload."""
from __future__ import annotations

import base64
import binascii
import csv
import io
import re
import unicodedata
from collections.abc import Iterator

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font
from pydantic import ValidationError

from backend.schemas import ProductPayload

MAX_IMPORT_ROWS = 2000
MAX_IMPORT_BYTES = 2 * 1024 * 1024

# Template headers, in order; each maps to a ProductPayload field.
TEMPLATE_COLUMNS = [
    ("Nombre", "name"), ("Código (SKU)", "sku"), ("Categoría", "category"), ("Precio", "price"),
    ("Costo", "cost"), ("Stock", "stock"), ("Stock mínimo", "minStock"), ("Unidad", "unit"),
    ("Código de barras", "barcode"), ("Descripción", "description"), ("Tipo", "productType"),
]
REQUIRED = {"name": "Nombre", "sku": "Código (SKU)", "category": "Categoría", "price": "Precio"}
FIELD_LABELS = {field: header for header, field in TEMPLATE_COLUMNS}
NUMERIC = ("price", "cost", "stock", "minStock")
TYPES = {"venta": "sale_item", "insumo": "ingredient", "suministro": "supplies"}


class ImportFileError(ValueError):
    """The whole file cannot be read; the message is shown to the user as is."""


def _key(text: str) -> str:
    plain = unicodedata.normalize("NFD", str(text)).encode("ascii", "ignore").decode()
    return " ".join(plain.lower().split())


HEADER_ALIASES = {_key(header): field for header, field in TEMPLATE_COLUMNS} | {
    "codigo": "sku", "sku": "sku", "stock minimo": "minStock", "minimo": "minStock", "codigo barras": "barcode",
}


def decode_data_url(data_url: str) -> bytes:
    try:
        raw = base64.b64decode(data_url.split(",", 1)[-1], validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ImportFileError("No se pudo leer el archivo.") from exc
    if len(raw) > MAX_IMPORT_BYTES:
        raise ImportFileError("El archivo supera 2 MB.")
    return raw


def _cell_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        # Comma decimal, so parse_number never mistakes 0.125 for the Colombian "125".
        return str(int(value)) if value.is_integer() else repr(value).replace(".", ",")
    return str(value).strip()


def _table(file_name: str, raw: bytes) -> Iterator[list[str]]:
    """Rows are produced lazily, so a huge sheet is never read past the row limit."""
    name = file_name.lower()
    if name.endswith(".xlsx"):
        try:
            sheet = load_workbook(io.BytesIO(raw), read_only=True, data_only=True).worksheets[0]
        except Exception as exc:  # openpyxl raises many types for a damaged file
            raise ImportFileError("No se pudo abrir el Excel. Guárdalo de nuevo como .xlsx e inténtalo otra vez.") from exc
        return ([_cell_text(v) for v in row] for row in sheet.iter_rows(values_only=True))
    if name.endswith(".csv"):
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = raw.decode("cp1252", errors="replace")  # what Excel on Windows writes
        first_line = text.split("\n", 1)[0]
        delimiter = ";" if first_line.count(";") >= first_line.count(",") else ","
        return ([cell.strip() for cell in row] for row in csv.reader(io.StringIO(text), delimiter=delimiter))
    raise ImportFileError("El archivo debe ser .xlsx o .csv.")


def read_rows(file_name: str, raw: bytes) -> list[tuple[int, dict[str, str]]]:
    table = _table(file_name, raw)
    header = next(table, None)
    if header is None:
        raise ImportFileError("El archivo está vacío.")
    columns = [HEADER_ALIASES.get(_key(cell)) for cell in header]
    missing = [label for field, label in REQUIRED.items() if field not in columns]
    if missing:
        raise ImportFileError(f"Faltan columnas obligatorias: {', '.join(missing)}.")
    rows = []
    for number, cells in enumerate(table, start=2):
        fields = {field: cell for field, cell in zip(columns, cells) if field and cell}
        if fields:
            rows.append((number, fields))
            if len(rows) > MAX_IMPORT_ROWS:
                raise ImportFileError(f"El archivo tiene más de {MAX_IMPORT_ROWS} productos; el máximo por archivo es {MAX_IMPORT_ROWS}.")
    return rows


def parse_number(text: str) -> float | None:
    clean = re.sub(r"[$\s ]", "", str(text))
    if not clean:
        return None
    if "," in clean and "." in clean:
        clean = clean.replace(".", "").replace(",", ".")  # 1.234,5
    elif "," in clean:
        clean = clean.replace(",", ".")  # 2,5
    elif re.fullmatch(r"-?\d{1,3}(\.\d{3})+", clean):
        clean = clean.replace(".", "")  # 1.500 is thousands in Colombia
    try:
        return float(clean)
    except ValueError as exc:
        raise ValueError(f"'{text}' no es un número") from exc


def row_to_payload(fields: dict[str, str]) -> ProductPayload:
    data: dict = {k: v for k, v in fields.items() if k not in NUMERIC and k != "productType"}
    for field in NUMERIC:
        try:
            value = parse_number(fields.get(field, ""))
        except ValueError as exc:
            raise ValueError(f"{FIELD_LABELS[field]}: {exc}.") from exc
        if value is not None:
            data[field] = value
    if "price" not in data:
        raise ValueError("Falta el precio.")
    if fields.get("productType"):
        kind = TYPES.get(_key(fields["productType"]))
        if not kind:
            raise ValueError("Tipo debe ser venta, insumo o suministro.")
        data["productType"] = kind
    data.setdefault("stock", 0)
    data.setdefault("minStock", 0)
    try:
        return ProductPayload(**data)
    except ValidationError as exc:
        error = exc.errors()[0]
        field = str(error["loc"][0]) if error.get("loc") else ""
        label = FIELD_LABELS.get(field, field)
        if error["type"] == "missing":
            raise ValueError(f"Falta {label}.") from exc
        raise ValueError(f"{label}: valor no válido ({error['msg']}).") from exc


def build_template() -> bytes:
    book = Workbook()
    sheet = book.active
    sheet.title = "Productos"
    sheet.append([header for header, _ in TEMPLATE_COLUMNS])
    for cell in sheet[1]:
        cell.font = Font(bold=True)
    sheet.append(["Agua 600 ml", "AGUA600", "Bebidas", 2500, 1200, 24, 6, "unidad", "7701234567890", "Botella personal", "venta"])
    for column in sheet.columns:
        sheet.column_dimensions[column[0].column_letter].width = 18
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()
