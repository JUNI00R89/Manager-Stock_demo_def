# SKU automático Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a product is saved or imported without an internal code (SKU), the server generates one like `BEB-0001`.

**Architecture:** A pure service function `next_sku` in `backend/services/catalog.py` computes the next code from the category and the business's existing SKUs. `create_product` and the import call it inside their write transaction when the SKU is empty. The frontend just stops requiring the field.

**Tech Stack:** FastAPI + SQLite, React + TypeScript, Vitest. Backend tests run with `.venv/Scripts/python.exe -m pytest -q` (scripts collected by `backend/tests/conftest.py`); a single script still runs with `.venv/Scripts/python.exe -W ignore backend/tests/<file>.py`.

**Spec:** `docs/superpowers/specs/2026-11-12-sku-automatico-design.md`

## Global Constraints

- Format: `<PREFIX>-<NNNN>`. PREFIX is the first 3 ASCII letters of the category, without accents and in uppercase (fewer if the category has fewer letters, `PRD` if it has none). NNNN is the zero-padded max existing number for that prefix in the business, plus 1. Past 9999 it just grows (`BEB-10000`).
- Generation happens on the server, inside the same `BEGIN IMMEDIATE` transaction as the insert.
- A SKU the user types is kept exactly as today: stripped and uppercased, 2 to 60 characters.
- In the import, rows without a code are skipped when an existing product, or an earlier row in the same file, has the same name compared with `normalize_category_name` (accent-insensitive and case-insensitive).
- All user-facing copy is in Spanish.

## Review Focus

1. **Typed code that collides with the pattern** (the user typed `BEB-0050`): the next generated code must be `BEB-0051`, never a duplicate. Test in Task 1.
2. **Two businesses:** each one starts at `BEB-0001`. Test in Task 1.
3. **Edit a product and clear the SKU field:** the product keeps its current code; it must not raise 422 or save an empty code. Test in Task 1.
4. **Import with mixed rows** (some with code, some without, in the same category): the generated codes don't collide with the typed ones in the same file. Test in Task 2.
5. **Category "Té" or "123":** the prefix is `TE` or `PRD`, never empty. Test in Task 1.

---

### Task 1: Generate the SKU on create

**Files:**
- Modify: `backend/schemas.py` (`ProductPayload.sku`)
- Modify: `backend/services/catalog.py` (add `sku_prefix`, `next_sku`)
- Modify: `backend/routers/catalog.py` (`create_product`, `update_product`)
- Test: `backend/tests/test_sku_auto.py`

**Interfaces:**
- Produces:
  - `sku_prefix(category: str) -> str`
  - `next_sku(conn: sqlite3.Connection, business_id: str, category: str, reserved: set[str] = frozenset()) -> str`. `reserved` holds extra SKUs to avoid (codes typed or generated earlier in the same import).
  - `ProductPayload.sku: str = Field(default="", max_length=60)`. The validator strips and uppercases, then raises `ValueError("El código debe tener entre 2 y 60 caracteres.")` when the result has length 1.

- [ ] **Step 1: Write the failing test** `backend/tests/test_sku_auto.py`. Use a temp DB + `TestClient`, like `test_product_import.py` (register an owner and set the retail config). Assertions:

```python
assert sku_prefix("Bebidas") == "BEB" and sku_prefix("Té") == "TE" and sku_prefix("123") == "PRD" and sku_prefix("Lácteos") == "LAC"
p1 = post({"name": "Agua", "category": "Bebidas", ...no sku...}); assert p1["sku"] == "BEB-0001"
p2 = post({"name": "Jugo", "sku": "", "category": "Bebidas", ...}); assert p2["sku"] == "BEB-0002"
post({"name": "Malta", "sku": "beb-0050", "category": "Bebidas", ...})          # typed code is kept as BEB-0050
assert post({"name": "Soda", "category": "Bebidas", ...})["sku"] == "BEB-0051"
assert post({"name": "Té verde", "category": "Té", ...})["sku"] == "TE-0001"    # needs category "Té" created first
assert other_business_post({"name": "Agua", "category": "Bebidas", ...})["sku"] == "BEB-0001"
edited = put(p1_id, {...same fields, "sku": ""}); assert edited.status_code == 200 and edited.json()["sku"] == "BEB-0001"
assert post({..., "sku": "X"}).status_code == 422
```

- [ ] **Step 2: Run** `.venv/Scripts/python.exe -W ignore backend/tests/test_sku_auto.py`. Expected: ImportError (`sku_prefix`), or 422 for the missing sku.
- [ ] **Step 3: Implement.**
  - `sku_prefix`: NFD, keep ASCII letters only, uppercase, first 3; `"PRD"` if the result is empty.
  - `next_sku`:
    - read `SELECT sku FROM products WHERE business_id=? AND sku LIKE ?` with `f"{prefix}-%"`;
    - together with `reserved`, take the max integer suffix of codes that fully match `^{prefix}-(\d+)$`;
    - return `f"{prefix}-{n+1:04d}"`.
  - `create_product`: if `payload.sku` is empty, after `BEGIN IMMEDIATE` set `payload = payload.model_copy(update={"sku": next_sku(conn, current_business_id(), payload.category)})` before `insert_product`.
  - `update_product`: if `payload.sku` is empty, use the stored `sku` of the product.
- [ ] **Step 4: Run** the test (`OK`), then `.venv/Scripts/python.exe -m pytest -q`: all pass (2 skipped).
- [ ] **Step 5: Commit** `feat(catalogo): generar el SKU cuando viene vacío`.

### Task 2: Import without codes

**Files:**
- Modify: `backend/services/product_import.py` (`REQUIRED` drops `sku`; template header becomes `"Código (SKU, opcional)"` and its alias is mapped)
- Modify: `backend/routers/catalog.py` (`build_import_report`, `import_products`)
- Modify: `backend/tests/test_product_import.py`, `backend/tests/test_product_import_parse.py`

**Interfaces:**
- Consumes: `next_sku` and `sku_prefix` from Task 1.
- Produces:
  - The `ImportReport.skipped` items become `{row, sku, name}`. `sku` is `""` when the row had no code and was skipped by name.
  - `ImportReport.toCreate[].sku` is `""` for rows that will get a generated code (the preview generates nothing).

- [ ] **Step 1: Write the failing tests.**
  - **Parse:** a file whose headers lack the SKU column reads fine (no `ImportFileError`). `row_to_payload` without `sku` returns `payload.sku == ""`.
  - **API**, in a new block of `test_product_import.py`, using the category "Panadería" (new, so the prefix `PAN` is free):
    - File rows `["Pan blanco", None, "Panadería", 500, 10]`, `["Pan integral", "PAN-0009", "Panadería", 700, 5]`, `["pan BLANCO", None, "Panadería", 500, 1]` (the same name as row 2, so it is skipped).
    - Preview: `toCreate` skus are `["", "PAN-0009"]`, and `skipped == [{"row": 4, "sku": "", "name": "pan BLANCO"}]`.
    - Import: `created == 2`. The product "Pan blanco" has sku `"PAN-0010"`: it avoids the typed `PAN-0009` from the same file (Review Focus 4).
    - Importing the same file again gives `created == 0`: "Pan blanco" is skipped by name and `PAN-0009` by code.
- [ ] **Step 2: Run** both scripts. Expected: parse fails on the missing header, and the API test fails on the 422.
- [ ] **Step 3: Implement.**
  - In `build_import_report`:
    - keep `names = {normalize_category_name(name) for name in existing product names}`;
    - a row without a code whose normalized name is in `names` goes to `skipped` with `sku: ""`;
    - otherwise add its name to `names`, and add typed codes to `taken`;
    - add `"name"` to every skipped item.
  - In `import_products`, before `insert_product`, give each payload with an empty sku `next_sku(conn, business_id, product.category, reserved=taken_in_file)`, and add each generated code to `taken_in_file`.
- [ ] **Step 4: Run** both scripts (`OK`), then the full pytest.
- [ ] **Step 5: Commit** `feat(importar): productos sin código reciben uno generado`.

### Task 3: Frontend

**Files:**
- Modify: `src/app/pages/NewProduct.tsx`: label `"SKU / código interno"` without `*`; drop `required`; placeholder `"Vacío = se genera solo (ej. BEB-0001)"`; the validation at line ~136 no longer needs `formData.sku`.
- Modify: `src/app/services/dataService.ts`: `ImportReport.skipped` item gets `name: string`.
- Modify: `src/app/components/ImportProductsDialog.tsx`: the skipped list shows `item.sku || item.name`.
- Modify: `src/app/components/ImportProductsDialog.test.tsx`: the mock's skipped item becomes `{ row: 5, sku: 'AG1', name: 'Agua' }`, plus a new assertion that a skipped item `{ row: 6, sku: '', name: 'Pan blanco' }` renders "Pan blanco".

- [ ] **Step 1: Update the dialog test** (the new assertion). Run `npx vitest run src/app/components/ImportProductsDialog.test.tsx` → FAIL ("Pan blanco" not found).
- [ ] **Step 2: Implement** the 3 files above.
- [ ] **Step 3: Run** `npx tsc --noEmit -p .`, `npx vitest run` and `npm run build`: all green.
- [ ] **Step 4: Browser check** (scratch DB via the `backend-test` launch config):
  - create a product leaving the SKU empty → it shows `BEB-0001` (or the category's prefix) in the list;
  - import a CSV without a code column → the codes are generated.
- [ ] **Step 5: Commit** `feat(productos): SKU opcional en el formulario`.
