# Fotos de producto y notas de comanda — diseño

Fecha: 2026-11-10 · Estado: pendiente de aprobación

## Intención

1. **Fotos de producto:** que el negocio pueda poner una foto a sus productos y que se vea en la
   tarjeta del producto al vender, para reconocerlos más rápido. Es **opcional**: cada producto
   puede tener o no foto, y además hay un **interruptor general** para mostrar u ocultar las fotos.
2. **Notas de comanda:** que el mesero escriba al pedir un detalle por plato ("sin cebolla") y que
   llegue a cocina.

## Objetivos / no-objetivos

- Objetivo: subir, cambiar y quitar la foto desde el formulario del producto; verla en las
  tarjetas de **POS**, **Mesero** y **Mesas**.
- Objetivo: nota por plato desde **Mesas** (en **Mesero** ya existe) y visible en cocina y en el
  consumo de la mesa.
- No-objetivo: galería de varias fotos, recorte manual, almacenamiento en la nube (se hará al pasar a SaaS).
- Anti-objetivo: que el POS se vuelva lento en celulares por cargar fotos pesadas.

## Enfoques considerados (fotos)

| Opción | Resumen | Decisión |
|---|---|---|
| **A. Archivo en el servidor** | La foto se guarda en `backend/data/uploads/products/`; el producto guarda la ruta | **Elegida por el usuario** |
| B. Foto dentro de la base | Imagen como texto en el producto | Descartada: cada carga del catálogo traería todas las fotos |
| C. Pegar enlace | URL externa | Descartada: los negocios pequeños no tienen fotos publicadas |

## Diseño

### Fotos
- **Subida:** el navegador reduce la foto a máx. 400 px y la convierte a JPEG (~30 KB) y la envía
  como `dataUrl` en JSON a `PUT /api/products/{id}/image`. *Mi decisión:* JSON en vez de
  `multipart` para no agregar la dependencia `python-multipart`.
- **Validación en el servidor:** solo JPEG/PNG/WebP, máx. 500 KB tras decodificar, producto del
  mismo negocio, permiso `catalog.edit` (ya lo exige el middleware para `/api/products/...`).
- **Guardado:** archivo con nombre aleatorio (`<uuid>.jpg`) en `backend/data/uploads/products/`;
  el campo `products.image` guarda `/uploads/products/<uuid>.jpg`. Al reemplazar o quitar
  (`DELETE /api/products/{id}/image`), se borra el archivo anterior.
- **Entrega:** `GET /uploads/products/<archivo>` sin sesión (las etiquetas `<img>` no envían el
  token); el nombre aleatorio evita que se adivinen. *Mi decisión:* son fotos de catálogo, no datos sensibles.
- **Compatibilidad:** los valores viejos de `image` (`food`, `fries`…) se siguen tratando como
  "sin foto".
- **Interruptor:** `features.productImages` en la configuración del negocio (Configuración →
  Configuración general), **activado por defecto** (*mi decisión*: si el dueño sube fotos, espera verlas).
  Apagado: ninguna tarjeta muestra fotos.
- **Pantallas:** formulario de producto (elegir, vista previa, quitar); tarjetas de POS, Mesero y
  Mesas muestran la foto si existe y el interruptor está activo; si no, se ven como hoy.
- **Respaldo:** `scripts/backup_database.py` copia también la carpeta de fotos.

### Notas de comanda
- **Mesas:** campo "Nota para cocina" por línea del pedido, igual que en Mesero; se envía en
  `items[].notes` (el backend ya lo guarda en `order_items.notes`).
- **Mismo producto con notas distintas:** si una línea del carrito ya tiene nota y se agrega otra
  vez el mismo producto, entra como **línea nueva** (Mesero y Mesas). *Mi decisión.*
- **Visible:** cocina ya muestra "Nota: …"; se agrega la nota en el "consumo actual" de la mesa.

## Pruebas
- Backend: subir (válida), rechazar tipo/tamaño inválido, rechazar producto de otro negocio,
  reemplazar borra el archivo anterior, quitar foto, servir el archivo.
- Frontend: carrito separa líneas cuando el mismo producto lleva otra nota.
- Navegador: subir foto y verla en POS; apagar el interruptor y que desaparezca; pedir desde Mesas
  "hamburguesa · sin cebolla" y verla en Cocina.

## Queda para quien construya
- Estilo exacto de la foto en cada tarjeta (alto fijo, recorte `object-cover`).
