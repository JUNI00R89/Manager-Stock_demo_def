# Importar productos desde Excel: diseño

## Para qué y por qué

Un negocio nuevo no va a escribir 500 productos a mano. Si puede subir el Excel que ya tiene, empieza a usar Manager Stock el mismo día. Esta función quita la mayor barrera de entrada del SaaS. Su usuario es el dueño o administrador de una tienda o restaurante que está empezando en la app.

**El éxito se ve así:** el cliente descarga la plantilla, la llena o pega sus datos, la sube y ve una vista previa clara. Al confirmar, sus productos quedan creados, con stock, categorías y movimiento de apertura.

## Objetivos

- Subir un archivo `.xlsx` o `.csv` y crear productos nuevos en bloque.
- Mostrar una vista previa antes de guardar. La vista previa dice:
  - cuántos productos se crearán;
  - qué filas se saltan porque su código (SKU) ya existe;
  - qué filas tienen error, con el número de fila y el motivo;
  - qué categorías nuevas se crearán.
- Descargar una plantilla de Excel con las columnas correctas y una fila de ejemplo.

## Lo que no se hará (por ahora)

- **No actualiza productos que ya existen.** Si el SKU ya existe, la fila se salta y se informa. La actualización masiva de precios queda para después (decisión del usuario: opción A).
- No importa fotos, proveedores, ubicaciones de bodega ni lotes.
- No importa recetas.

## Lo que sería un fracaso aunque funcione

- Que un archivo con errores deje datos a medias sin que el usuario lo sepa. Todo lo que se guarda se ve antes en la vista previa.
- Que un negocio pueda crear productos en otro negocio, o saltarse los permisos de catálogo.
- Que la app web crezca de tamaño por esta función. La app ya pesa 2,3 MB.

## Decisiones tomadas

| Tema | Decisión | Quién |
|---|---|---|
| SKU repetido (en la base o dentro del mismo archivo) | Se salta la fila y se informa | Usuario (A) |
| Dónde se lee el Excel | En el servidor, con `openpyxl` | Usuario (opción 1) |
| Categorías que no existen | Se crean automáticamente; la vista previa las lista | Usuario (A) |
| Filas con error | Se importan las buenas; las malas van al reporte | Mi propuesta, no corregida |
| Stock inicial | Se registra como movimiento `opening`, igual que el formulario | Mi propuesta, no corregida |
| Límite | 2.000 filas por archivo | Mi propuesta, no corregida |

## Enfoques considerados

1. **El servidor lee el Excel (elegido).** El archivo va al backend, que lo lee con `openpyxl` y valida con las mismas reglas que el formulario. La app no crece y la validación vive en un solo sitio. Costo: una dependencia nueva en Python.
2. **El navegador lee el Excel.** Requiere una librería de JavaScript de 400 KB a 1 MB, y la app ya es pesada. Descartado.
3. **Solo CSV, sin librerías.** Excel en español guarda los CSV con `;` y a veces daña las tildes. Generaría soporte. Descartado como formato único, aunque `.csv` sí se acepta además de `.xlsx`.

## Cómo funciona

### Flujo del usuario

En **Productos**, junto a "Nuevo producto", aparece el botón **"Importar desde Excel"**. Solo se ve si el usuario puede crear productos. El botón abre un diálogo:

```
┌ Importar productos ───────────────────────────────┐
│ 1. [Descargar plantilla]                          │
│ 2. [Elegir archivo .xlsx o .csv]   productos.xlsx │
│                                                   │
│ Vista previa                                      │
│  ✓ 47 productos se crearán                        │
│  ↷ 3 ya existen (se saltan): AG1, CF2, PN9        │
│  ✗ 2 filas con error:                             │
│     Fila 8: falta el precio                       │
│     Fila 15: el precio no es un número            │
│  + Categorías nuevas: Lácteos, Aseo               │
│                                                   │
│           [Cancelar]   [Importar 47 productos]    │
└───────────────────────────────────────────────────┘
```

Al confirmar, aparece el mensaje "47 productos importados" y la lista de productos se recarga.

### Columnas de la plantilla

Los encabezados van en la fila 1 y en español. Al leerlos, el sistema ignora mayúsculas, tildes y espacios extra.

| Columna | Obligatoria | Regla (la misma de `ProductPayload`) |
|---|---|---|
| Nombre | sí | 2 a 120 caracteres |
| Código (SKU) | sí | 2 a 60 caracteres; se guarda en mayúsculas |
| Categoría | sí | 2 a 80 caracteres; si no existe, se crea |
| Precio | sí | número ≥ 0 |
| Costo | no | número ≥ 0; por defecto 0 |
| Stock | no | número ≥ 0; por defecto 0 |
| Stock mínimo | no | número ≥ 0; por defecto 0 |
| Unidad | no | por defecto "unidad" |
| Código de barras | no | hasta 120 caracteres |
| Descripción | no | hasta 1.000 caracteres |
| Tipo | no | "venta" (por defecto), "insumo" o "suministro" → `sale_item`, `ingredient` o `supplies` |

- Las filas totalmente vacías se ignoran.
- Las columnas desconocidas se ignoran.
- Si faltan columnas obligatorias en el encabezado, todo el archivo se rechaza con un mensaje que nombra las que faltan.

### Backend

- **Dependencia:** `openpyxl` en `requirements.txt`.
- **Endpoints**, en un router o en `catalog.py`:
  - `GET /api/products/import/template` devuelve el `.xlsx` de la plantilla, generado con `openpyxl`.
  - `POST /api/products/import/preview` recibe `{ fileName, dataUrl }` (base64, como las fotos, sin `python-multipart`). Devuelve el resultado fila por fila y no guarda nada.
  - `POST /api/products/import` recibe el mismo cuerpo, vuelve a leer y validar todo (el servidor no guarda estado entre la vista previa y la confirmación) y crea los productos válidos en **una sola transacción**. Devuelve el mismo reporte, con lo que se creó.
- **Permisos:** `required_permission_for_request` en `backend/core/middleware.py` debe mapear `/api/products/import*`:
  - `POST` a `catalog.create`. Hoy, por el prefijo `/api/products/`, caería en `catalog.edit`.
  - `GET` de la plantilla a `catalog.view`.
- **Reutilizar lo que ya existe:**
  - validar cada fila construyendo un `ProductPayload` (los errores de Pydantic se traducen a un mensaje en español por fila);
  - comparar categorías con `normalize_category_name`;
  - insertar el producto y su movimiento `opening` con la misma lógica de `create_product`, extrayendo lo común a una función de servicio en vez de copiarlo;
  - registrar `audit` por producto y un `audit` de la importación con el resumen.
- **Límites:**
  - archivo de 2 MB como máximo (el `dataUrl` limitado en el schema);
  - 2.000 filas de datos;
  - extensiones `.xlsx` y `.csv`;
  - el `.xlsx` se abre con `read_only=True, data_only=True`, así que las fórmulas se leen como su valor calculado.
- **CSV:** se detecta el separador (`;` o `,`). Se decodifica como UTF-8 con BOM y, si falla, como `cp1252`, que es lo que usa Excel en Windows.
- **Números:** se aceptan como número de Excel o como texto con formato colombiano. "1.500" y "$ 1.500" son 1500; "2,5" es 2.5.

### Frontend

- Un componente `ImportProductsDialog`, que se abre desde `Products.tsx`.
- `dataService.downloadProductTemplate()`, `previewProductImport(file)` e `importProducts(file)`.
- El archivo se lee con `FileReader.readAsDataURL`. No se agrega ninguna librería al frontend.

## Pruebas

- **Backend:** un script `backend/tests/test_product_import.py`, al estilo de los demás. Debe cubrir:
  - la vista previa no guarda nada;
  - la importación crea productos, el movimiento `opening` y las categorías nuevas;
  - un SKU repetido en la base o en el archivo se salta;
  - las filas inválidas se reportan con su número de fila;
  - el CSV con `;` y tildes se lee bien;
  - otro negocio no ve ni toca esos productos;
  - un cajero sin `catalog.create` recibe 403.
- **Frontend:** una prueba de que el diálogo muestra el resumen de la vista previa.

## Lo que queda a criterio de quien construye

- El texto exacto de los mensajes de error por fila (en español y concretos).
- Si la tabla de vista previa muestra todas las filas válidas o solo el resumen más los errores. Mínimo: el resumen y todos los errores.
- El estilo de la plantilla (encabezados en negrita, una fila de ejemplo).
