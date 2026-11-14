# Importar productos desde Excel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a business upload an `.xlsx`/`.csv`, see a preview, and create only new products in one go.

**Architecture:** Parsing lives in a pure backend service (`backend/services/product_import.py`): file bytes → numbered rows → validated rows. The catalog router exposes template/preview/import endpoints. Import reuses the single-product insert logic, now extracted to `backend/services/catalog.py`. The frontend sends the file as a base64 data URL through the existing `api()` helper and shows the report in a dialog.

**Tech Stack:** FastAPI + SQLite, `openpyxl` (new), React + TypeScript + Vite, Vitest. Backend tests are plain scripts run with `.venv/Scripts/python.exe -W ignore backend/tests/<file>.py`, which print `OK: ...`.

**Spec:** `docs/superpowers/specs/2026-11-11-importar-productos-excel-design.md`

## Global Constraints

- Only new products are created. A SKU that exists in the business (active or not, because the table has `UNIQUE(business_id, sku)`) or that repeats inside the file is skipped and reported, never updated.
- Files: `.xlsx` or `.csv`, at most 2 MB decoded, at most 2.000 data rows. Anything else → 422 with a Spanish message.
- Unknown categories are created automatically. They are compared with `normalize_category_name`, so "lácteos" and "Lácteos" are the same category.
- Valid rows are imported; invalid rows are reported as `{ row, message }`, where `row` is the spreadsheet row number (header = row 1).
- Initial stock creates an `opening` movement exactly like `create_product`.
- Permissions: `POST /api/products/import*` → `catalog.create`; `GET /api/products/import/template` → `catalog.view`.
- No new frontend dependency. All user-facing copy is in Spanish.
- *Ruling:* the template endpoint returns JSON `{fileName, dataUrl}` instead of raw `.xlsx` bytes, so the frontend can reuse the authenticated `api()` helper (it only parses JSON) without a second fetch path.

## Review Focus

1. **Plan limit:** a business near `plan.maxProducts` imports 100 rows. Rows past the limit must be reported as errors ("El plan … permite hasta N productos activos"), never silently created over the limit. Test in Task 2. *(Ruling: the spec did not mention the plan limit; `create_product` enforces it, so import must too.)*
2. **Excel numbers with a Colombian format:** cells typed as text such as "$ 1.500" or "2,5", and real numeric cells (1500.0). Both must parse. Test in Task 1.
3. **CSV saved by Excel in Spanish:** separated by `;`, encoded cp1252, with accents. Test in Task 1.
4. **Preview, then the catalog changes, then confirm:** import re-validates from scratch, so a SKU created in between is skipped, not a 500 error. Test in Task 2.
5. **Header with accents or different case** ("CÓDIGO (SKU)", "stock minimo"): it must still map to the right column. Test in Task 1.

---

### Task 1: Parser and template (pure backend service)

**Files:**
- Modify: `requirements.txt` (add `openpyxl>=3.1,<4`, then run `.venv/Scripts/python.exe -m pip install openpyxl`)
- Create: `backend/services/product_import.py`
- Test: `backend/tests/test_product_import_parse.py`

**Interfaces:**
- Produces:
  - `MAX_IMPORT_ROWS = 2000`
  - `MAX_IMPORT_BYTES = 2 * 1024 * 1024`
  - `class ImportFileError(ValueError)`: a whole-file problem, carrying a Spanish message.
  - `decode_data_url(data_url: str) -> bytes`: raises `ImportFileError` on bad base64 or more than `MAX_IMPORT_BYTES`.
  - `read_rows(file_name: str, raw: bytes) -> list[tuple[int, dict[str, str]]]`:
    - returns `(spreadsheet_row_number, {field: raw_text})` for non-empty data rows;
    - fields are `name, sku, category, price, cost, stock, minStock, unit, barcode, description, productType`, keyed via the header map;
    - raises `ImportFileError` on an unknown extension, missing required headers (the message names them), or more than `MAX_IMPORT_ROWS`.
  - `parse_number(text: str) -> float | None`: `None` when empty; raises `ValueError` when it is not a number.
  - `row_to_payload(fields: dict[str, str]) -> ProductPayload`: raises `ValueError` with a Spanish message.
  - `build_template() -> bytes`: the `.xlsx` with Spanish headers in bold and one example row.

- [ ] **Step 1: Write the failing test** `backend/tests/test_product_import_parse.py`, with a `run()` and `print("OK: ...")` like the other scripts. Assertions:

```python
assert parse_number("$ 1.500") == 1500 and parse_number("2,5") == 2.5 and parse_number("1.234,5") == 1234.5
assert parse_number("1500.0") == 1500 and parse_number("") is None
try: parse_number("abc"); raise AssertionError
except ValueError: pass
csv = "Nombre;CÓDIGO (SKU);categoria;Precio;Stock minimo\nCafé;cf1;Bebidas;$ 2.500;3\n;;;;\n".encode("cp1252")
rows = read_rows("lista.csv", csv)
assert rows == [(2, {"name": "Café", "sku": "cf1", "category": "Bebidas", "price": "$ 2.500", "minStock": "3"})]
# an xlsx built with openpyxl, a numeric price cell 1500 (float) and a header "Codigo de barras" → barcode
# missing "Precio" header → ImportFileError mentioning "Precio"
# 2001 data rows → ImportFileError; "x.pdf" → ImportFileError
payload = row_to_payload({"name": "Café", "sku": "cf1", "category": "Bebidas", "price": "2500", "productType": "insumo"})
assert payload.sku == "CF1" and payload.productType == "ingredient" and payload.stock == 0
# row_to_payload without a price → ValueError whose message contains "precio"
assert read_rows("t.xlsx", build_template())[0][1]["sku"]  # the template's example row reads back
```

- [ ] **Step 2: Run it and watch it fail.** `.venv/Scripts/python.exe -W ignore backend/tests/test_product_import_parse.py` → `ModuleNotFoundError: backend.services.product_import`.
- [ ] **Step 3: Implement `backend/services/product_import.py`.**
  - Normalize headers by stripping accents, lowercasing and collapsing spaces. Map aliases to fields: `nombre`, `codigo (sku)`/`codigo`/`sku`, `categoria`, `precio`, `costo`, `stock`, `stock minimo`, `unidad`, `codigo de barras`, `descripcion`, `tipo`.
  - xlsx: `openpyxl.load_workbook(BytesIO(raw), read_only=True, data_only=True)`, first sheet. Turn a float that is a whole number into an integer string.
  - csv: try `utf-8-sig`, then `cp1252`. Pick the delimiter with `csv.Sniffer` limited to `;,`, falling back to `;`.
  - `parse_number`:
    - strip `$`, spaces and non-breaking spaces;
    - if both `.` and `,` appear, `.` is the thousands separator;
    - if only `,` appears, it is the decimal mark;
    - if only `.` appears followed by exactly 3 digits, it is thousands, otherwise decimal.
  - `row_to_payload`: map tipo `venta`/`insumo`/`suministro` (accent-insensitive) to `sale_item`/`ingredient`/`supplies`. Build a `ProductPayload` and translate `pydantic.ValidationError` into a short Spanish message naming the column.
- [ ] **Step 4: Run it and watch it pass.** Same command → `OK: ...`.
- [ ] **Step 5: Commit** `feat(catalogo): leer productos desde Excel o CSV`.

### Task 2: Endpoints, permissions and shared insert

**Files:**
- Modify: `backend/services/catalog.py` (add `insert_product`)
- Modify: `backend/routers/catalog.py` (`create_product` calls `insert_product`; three new endpoints, declared **before** any `/api/products/{product_id}` route)
- Modify: `backend/schemas.py` (`ProductImportPayload`)
- Modify: `backend/core/middleware.py` (`required_permission_for_request`)
- Test: `backend/tests/test_product_import.py`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces:
  - `insert_product(conn, payload: ProductPayload, product_id: str) -> None` in `backend/services/catalog.py`. It runs the INSERT + opening movement (+ lot when `trackLots`) + `audit`, without commit or `BEGIN`.
  - `ProductImportPayload(BaseModel)`: `fileName: str = Field(min_length=5, max_length=200)`, `dataUrl: str = Field(min_length=20, max_length=2_900_000)`.
  - `GET /api/products/import/template` → `{ "fileName": "plantilla-productos.xlsx", "dataUrl": "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,..." }`.
  - `POST /api/products/import/preview` and `POST /api/products/import` → `ImportReport`:
    `{ "toCreate": [{"row", "sku", "name", "category"}], "skipped": [{"row", "sku"}], "errors": [{"row", "message"}], "newCategories": [str], "created": int }` (`created` is 0 in the preview).

- [ ] **Step 1: Write the failing test** `backend/tests/test_product_import.py`. Use a temp DB and `TestClient`, like `test_product_images.py`. Build files in memory with `openpyxl`/`csv`. Assertions:
  - The preview of 3 valid rows, 1 existing SKU, 1 duplicated-in-file SKU, 1 row without price and the category "Lácteos" (new) returns `len(toCreate)==3`, both skips with their row numbers, `errors[0]["row"]==<n>`, `newCategories==["Lácteos"]`, and the product count is unchanged.
  - The import of the same file gives `created==3`. Products exist with the stock from the file. Each product with stock>0 has one `opening` movement. The category exists. A second import of the same file gives `created==0` and 5 skipped.
  - Review Focus 4: preview, then create `NEW1` via `POST /api/products`, then import a file containing `NEW1` → skipped, status 200.
  - Review Focus 1: set the business plan's `maxProducts` to current+1 (update the plan row in the test DB) and import 3 rows → `created==1`, 2 errors whose message contains "plan".
  - Another business's preview does not see these SKUs as existing; its import creates them in its own business.
  - A cashier (`role="cashier"`, created via the existing users endpoint) gets 403 on both POST endpoints.
  - A non-xlsx/csv name, a broken base64 and a file over 2 MB → 422.
  - The template endpoint returns a `dataUrl` that `read_rows` reads back.
- [ ] **Step 2: Run it and watch it fail** (404 on `/api/products/import/preview`).
- [ ] **Step 3: Extract `insert_product`** from `create_product`. `create_product` keeps its checks (category, plan, supplier, location), its `BEGIN IMMEDIATE`, commit and `IntegrityError → 409`. Run `test_sales_api.py` and `test_product_images.py`: both still `OK`.
- [ ] **Step 4: Implement the endpoints.** Shared `build_report(conn, payload) -> tuple[report, list[ProductPayload]]`:
  - decode and read rows (`ImportFileError` → 422);
  - load all business SKUs with `SELECT sku FROM products WHERE business_id=?` (no active filter);
  - per row, `row_to_payload` (ValueError → error) and the skip rules;
  - collect new category names by `normalize_category_name` against `product_category_options`, keeping the first spelling seen;
  - apply the plan limit: the remaining slots are `maxProducts - active count`; rows beyond them move to `errors` with the same plan message as `create_product`.
  - `import`: `BEGIN IMMEDIATE`, insert the new categories (same INSERT as the category endpoint), then `insert_product` per payload with `PRD-` ids, `audit(conn, "import", "product", "-", {"created": n, "file": fileName})`, commit.
- [ ] **Step 5: Permissions.** In `required_permission_for_request`, before the generic `/api/products/` branch:
  - `path == "/api/products/import/template"` → `"catalog.view"`;
  - `path.startswith("/api/products/import")` → `"catalog.create"`.
- [ ] **Step 6: Run** the new test (`OK`), then every `backend/tests/test_*.py` except the two Playwright browser tests: all `OK`.
- [ ] **Step 7: Commit** `feat(catalogo): importar productos nuevos con vista previa`.

### Task 3: Import dialog in Productos

**Files:**
- Modify: `src/app/services/dataService.ts` (types + 3 methods next to `uploadProductImage`)
- Create: `src/app/components/ImportProductsDialog.tsx`
- Modify: `src/app/pages/Products.tsx` (an outline button "Importar desde Excel" next to "Nuevo producto", shown only when `canCreateProduct`; reload the product list after a successful import)
- Test: `src/app/components/ImportProductsDialog.test.tsx`

**Interfaces:**
- Consumes: the Task 2 endpoints and the `ImportReport` shape.
- Produces:
  - `export type ImportReport = { toCreate: { row: number; sku: string; name: string; category: string }[]; skipped: { row: number; sku: string }[]; errors: { row: number; message: string }[]; newCategories: string[]; created: number }`
  - `dataService.getProductImportTemplate(): Promise<{ fileName: string; dataUrl: string }>`
  - `dataService.previewProductImport(fileName: string, dataUrl: string): Promise<ImportReport>`
  - `dataService.importProducts(fileName: string, dataUrl: string): Promise<ImportReport>`
  - `ImportProductsDialog({ open, onOpenChange, onImported }: { open: boolean; onOpenChange: (open: boolean) => void; onImported: () => void })`

- [ ] **Step 1: Write the failing test.** Mock `dataService.previewProductImport` to return 2 toCreate, 1 skipped (`AG1`), 1 error (row 8, "falta el precio") and newCategories `["Aseo"]`. Pick a file in the input (`userEvent.upload`). Expect the texts "2 productos se crearán", "AG1", "Fila 8: falta el precio" and "Aseo", and the button "Importar 2 productos" enabled. With `toCreate: []`, the import button is disabled.
- [ ] **Step 2: Run** `npx vitest run src/app/components/ImportProductsDialog.test.tsx` → fails (no module).
- [ ] **Step 3: Implement.**
  - Use the house `Dialog`, `Button` and `Input`.
  - Read the file with `FileReader.readAsDataURL`. Accept `.xlsx,.csv`.
  - Run the preview on file pick. Show the spec's layout: summary lines, then all errors.
  - "Descargar plantilla" turns the returned `dataUrl` into an `<a download>`.
  - On confirm, call `importProducts`, show the toast "N productos importados", call `onImported` and close.
  - Errors go through `toastError`. Reset the input value so the same file can be picked again.
- [ ] **Step 4: Run** the test (PASS), then `npx tsc --noEmit -p .`, `npx vitest run` and `npm run build`: all green.
- [ ] **Step 5: Browser check.** Use the scratch DB (`backend-test` launch config) and the frontend:
  - download the template;
  - upload it with 2 extra rows, one bad;
  - see the preview, import, and see the products in the list.
- [ ] **Step 6: Commit** `feat(productos): diálogo para importar desde Excel`.
