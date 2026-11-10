# Fotos de producto y notas de comanda — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fotos opcionales por producto (con interruptor general) visibles en POS/Mesero/Mesas, y notas por plato desde Mesas que lleguen a cocina.

**Architecture:** El backend guarda la foto como archivo en `backend/data/uploads/products/` y expone subir/quitar bajo `/api/products/{id}/image` y servir bajo `/uploads/products/{archivo}` (fuera de `/api`, sin sesión). El frontend reduce la foto en el navegador y la sube como `dataUrl` JSON. Las notas ya viajan en `items[].notes`; Mesas agrega el campo y ambos carritos pasan a identificar líneas por `lineId`.

**Tech Stack:** FastAPI + SQLite (sin dependencias nuevas), React + TypeScript + Vitest.

**Spec:** `docs/superpowers/specs/2026-11-10-imagenes-y-notas-design.md`

## Global Constraints

- Sin dependencias nuevas (nada de `python-multipart`); subida en JSON `{ "dataUrl": "data:image/...;base64,..." }`.
- Tipos aceptados: JPEG, PNG, WebP. Máximo 500 KB tras decodificar.
- Reducción en navegador: lado mayor máx. 400 px, JPEG calidad 0.8.
- Archivos: `backend/data/uploads/products/<uuid32>.jpg|png|webp`; `products.image` = `/uploads/products/<archivo>`.
- Valores viejos de `image` (`food`, `fries`, `ingredient`…) = sin foto.
- Interruptor: `features.productImages`, ausente o `true` = mostrar; `false` = ocultar.
- Textos en español.

## Review Focus

1. `dataUrl` con tipo falso (p. ej. `text/html` o bytes que no son imagen) → 422, no se guarda nada.
2. Nombre de archivo malicioso en `/uploads/products/../../manager_stock.db` → 404, nunca sale un archivo fuera de la carpeta.
3. Reemplazar o quitar la foto borra el archivo anterior (no se acumulan huérfanos).
4. Producto de otro negocio → 404 al subir/quitar.
5. Pedir "1 hamburguesa con nota + 1 sin nota" desde Mesas → dos líneas en `order_items` con su nota cada una; el stock se valida sobre el total de líneas del producto.

---

### Task 1: Backend — subir, quitar y servir fotos

**Files:**
- Modify: `backend/routers/catalog.py` (endpoints), `backend/core/config.py` (`UPLOADS_DIR`), `backend/schemas.py` (`ProductImagePayload`), `scripts/backup_database.py`
- Test: `backend/tests/test_product_images.py`

**Interfaces:**
- Produces: `PUT /api/products/{product_id}/image` body `{"dataUrl": str}` → producto (`product_out`) con `image="/uploads/products/<archivo>"`; `DELETE /api/products/{product_id}/image` → producto con `image=""`; `GET /uploads/products/{filename}` → archivo; `UPLOADS_DIR: Path` = `DB_PATH.parent / "uploads"` (sigue a `MANAGER_STOCK_DB`, así las pruebas usan carpeta temporal).

- [ ] **Step 1: Escribir la prueba** `run()` en `test_product_images.py` (estilo de los demás scripts) con negocio retail y un producto, que verifique:
  - PNG 1×1 válido (base64 fijo en la prueba) → 200, `image` empieza por `/uploads/products/`, `GET` de esa ruta → 200 y mismos bytes.
  - `data:text/html;base64,...` → 422; `data:image/png;base64,` con bytes no-PNG → 422; > 500 KB → 422.
  - Subir otra foto → el archivo anterior ya no existe en `UPLOADS_DIR/products`.
  - `DELETE` → `image == ""` y archivo borrado.
  - Otro negocio con el `product_id` → 404.
  - `GET /uploads/products/..%2F..%2Fmanager_stock_test.db` y `/uploads/products/no-existe.jpg` → 404.
- [ ] **Step 2:** Correr `.venv/Scripts/python.exe backend/tests/test_product_images.py` → falla (ruta inexistente).
- [ ] **Step 3: Implementar.** Detectar el tipo por los bytes mágicos (`\xff\xd8\xff` JPEG, `\x89PNG` PNG, `RIFF....WEBP` WebP), no por el prefijo del `dataUrl`. Servir solo si `filename` cumple `^[0-9a-f]{32}\.(jpg|png|webp)$`. Borrar el archivo anterior solo si el valor viejo empieza por `/uploads/products/`. `ProductImagePayload.dataUrl` máx. ~700 000 caracteres. El backup copia `UPLOADS_DIR` con `shutil.copytree` junto a la copia de la base, si existe.
- [ ] **Step 4:** Correr la prueba → `OK`; correr `test_sales_api.py` → `OK`.
- [ ] **Step 5: Commit** `feat(catalogo): subir, quitar y servir fotos de producto`.

### Task 2: Frontend — elegir foto e interruptor

**Files:**
- Create: `src/app/utils/productImage.ts`, `src/app/utils/productImage.test.ts`
- Modify: `src/app/services/dataService.ts` (`uploadProductImage`, `removeProductImage`, exportar origen de la API), `src/app/pages/NewProduct.tsx`, `src/app/pages/Settings.tsx`, `src/app/context/BusinessContext.tsx` (`features.productImages?: boolean`)

**Interfaces:**
- Consumes: endpoints de Task 1.
- Produces: `productImageUrl(image: string | undefined | null, enabled: boolean): string | null` (URL absoluta si `image` empieza por `/uploads/` y `enabled`; si no `null`); `imagesEnabled(config: BusinessConfig | null): boolean` (`config?.features.productImages !== false`); `resizeImage(file: File): Promise<string>` (dataUrl JPEG ≤400 px); `dataService.uploadProductImage(id: string, dataUrl: string): Promise<Product>`; `dataService.removeProductImage(id: string): Promise<Product>`.

- [ ] **Step 1: Prueba** `productImage.test.ts`: `productImageUrl('/uploads/products/a.jpg', true)` termina en `/uploads/products/a.jpg` y empieza por `http`; `productImageUrl('food', true) === null`; `productImageUrl('/uploads/products/a.jpg', false) === null`; `imagesEnabled(null) === true`; `imagesEnabled({...features:{productImages:false}}) === false`.
- [ ] **Step 2:** `npx vitest run src/app/utils/productImage.test.ts` → falla (módulo no existe).
- [ ] **Step 3:** Implementar helpers (`resizeImage` con `<canvas>`, sin prueba unitaria: jsdom no dibuja). En `NewProduct`: sección "Foto (opcional)" con elegir/vista previa/quitar; tras guardar, si hay foto nueva → `uploadProductImage`, si se quitó → `removeProductImage`. En `Settings` → Configuración general: interruptor "Mostrar fotos en el punto de venta" que guarda `features.productImages`.
- [ ] **Step 4:** Prueba pasa; `npx tsc --noEmit -p .` limpio.
- [ ] **Step 5: Commit** `feat(catalogo): elegir foto del producto e interruptor de fotos`.

### Task 3: Fotos en las tarjetas de POS, Mesero y Mesas

**Files:** Modify `src/app/pages/POS.tsx`, `src/app/pages/restaurant/Waiter.tsx`, `src/app/pages/restaurant/Tables.tsx`

**Interfaces:** Consumes `productImageUrl`, `imagesEnabled` (Task 2).

- [ ] **Step 1:** En cada tarjeta de producto, si `productImageUrl(product.image, imagesEnabled(config))` no es `null`, mostrar `<img loading="lazy" alt={product.name} className="h-24 w-full rounded-lg object-cover">` arriba del nombre; si no, la tarjeta queda como hoy.
- [ ] **Step 2:** `npx tsc --noEmit -p .` limpio; verificación visual en Task 5.
- [ ] **Step 3: Commit** `feat(pos): mostrar foto del producto en las tarjetas`.

### Task 4: Notas por plato en Mesas y líneas separadas

**Files:**
- Create: `src/app/utils/orderCart.ts`, `src/app/utils/orderCart.test.ts`
- Modify: `src/app/pages/restaurant/Tables.tsx`, `src/app/pages/restaurant/Waiter.tsx`

**Interfaces:**
- Produces: `mergeableLine<T extends { productId: string }>(lines: T[], productId: string, noteOf: (line: T) => string): T | undefined` — la línea de ese producto **sin nota** (`noteOf(line).trim() === ''`), o `undefined`.
- Ambos carritos agregan `lineId: string` (`crypto.randomUUID()`); cambiar cantidad, quitar y editar nota usan `lineId`.

- [ ] **Step 1: Prueba** `orderCart.test.ts`: sin líneas → `undefined`; línea del producto sin nota → esa línea; única línea con nota `"sin cebolla"` → `undefined`; línea con nota y otra sin nota → la sin nota; nota solo espacios cuenta como sin nota.
- [ ] **Step 2:** `npx vitest run src/app/utils/orderCart.test.ts` → falla.
- [ ] **Step 3:** Implementar `mergeableLine`. Tables: `CartItem` gana `lineId` y `notes`; `addToCart` usa `mergeableLine` (incrementa o crea línea) y valida stock con la **suma** de cantidades de ese producto; campo "Nota para cocina" (máx. 300) por línea; `saveTableOrder` envía `notes` por ítem; "Consumo actual" muestra `· nota` si existe. Waiter: misma regla y `lineId`.
- [ ] **Step 4:** Pruebas pasan; `npx tsc --noEmit -p .` limpio.
- [ ] **Step 5: Commit** `feat(restaurante): notas por plato en Mesas y lineas separadas por nota`.

### Task 5: Verificación completa

- [ ] Suites: `npx vitest run`, `npm run build`, todos los `backend/tests/test_*.py` → OK.
- [ ] Navegador (base de prueba): subir foto a un producto y verla en POS; apagar el interruptor y comprobar que desaparece; en Mesas pedir "Hamburguesa · sin cebolla" + otra sin nota → dos líneas; en Cocina se ve "Nota: sin cebolla".
