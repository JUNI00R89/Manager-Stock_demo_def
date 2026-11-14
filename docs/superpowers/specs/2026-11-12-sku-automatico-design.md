# Código interno (SKU) automático: diseño corto

## Para qué

Muchos clientes, sobre todo restaurantes y servicios, no saben qué poner como código interno de cada producto. Si el campo queda vacío, el sistema genera uno. Así crear productos es más rápido y el cliente no se traba en un dato que no entiende.

## Decisiones

| Tema | Decisión | Quién |
|---|---|---|
| Alcance | Todos los tipos de negocio | Usuario (dejó la elección a mi criterio) |
| Campo SKU | Opcional: vacío = se genera; escrito = se respeta | Mi propuesta, aprobada |
| Formato | 3 primeras letras de la categoría sin tildes, en mayúsculas, guion y consecutivo de 4 dígitos (`BEB-0001`). Menos de 3 letras: las que haya (`TE-0001`). Sin letras: `PRD-0001` | Mi propuesta, aprobada |
| Consecutivo | Por negocio y prefijo; sigue al número más alto existente con ese prefijo (`BEB-0007` → `BEB-0008`), aunque lo haya escrito el cliente | Mi propuesta, aprobada |
| Dónde se genera | En el servidor, dentro de la misma transacción que guarda el producto | Única forma sensata |
| Importar sin código | La columna "Código (SKU)" es opcional. Las filas sin código reciben uno generado. Si ya existe un producto con el mismo nombre (sin tildes ni mayúsculas), la fila se salta | Usuario (opción A) |
| Editar producto | El código se conserva; el cliente puede cambiarlo, como hoy | Mi propuesta, aprobada |

## Enfoques considerados

- **En el servidor, al guardar (elegido).** El código es único aunque dos personas creen productos a la vez, porque se calcula bajo el mismo bloqueo de escritura y la base ya tiene `UNIQUE(business_id, sku)`.
- **En el navegador:** dos equipos podrían generar el mismo código al mismo tiempo. Descartado.
- **Regla dentro de la base (trigger):** es más complejo de lo necesario para SQLite. Descartado.

## Qué cambia

- **Backend:**
  - `ProductPayload.sku` pasa a ser opcional (vacío permitido; si se escribe, 2 a 60 caracteres, en mayúsculas como hoy).
  - Una función `next_sku(conn, business_id, category)` genera el código.
  - `create_product` y la importación la usan cuando el SKU viene vacío.
  - `update_product` sigue exigiendo un código: si llega vacío, conserva el actual.
- **Importación:**
  - "Código (SKU)" deja de ser columna obligatoria.
  - Las filas sin código se comparan por nombre normalizado contra los productos existentes y contra las filas anteriores del mismo archivo. Si coinciden, la fila se salta y se reporta con el nombre.
  - La vista previa muestra "(se generará)" en lugar del código.
- **Frontend:**
  - En el formulario de producto, el campo SKU deja de estar marcado como obligatorio.
  - La ayuda dice "Vacío = se genera solo (ej. BEB-0001)".
  - La validación del formulario ya no exige SKU.
  - La plantilla de Excel marca la columna como opcional.

## Pruebas

- Crear sin SKU en "Bebidas" da `BEB-0001`; el siguiente da `BEB-0002`. Si existe `BEB-0007`, el siguiente da `BEB-0008`.
- Crear con SKU escrito lo respeta.
- Prefijos de categorías cortas o sin letras.
- Dos negocios distintos pueden tener `BEB-0001` cada uno.
- Importar un archivo sin códigos crea los productos con códigos generados. Importarlo de nuevo salta todas las filas por nombre.

## Lo que queda a criterio de quien construye

- El texto exacto de la ayuda y del aviso de fila saltada por nombre.
