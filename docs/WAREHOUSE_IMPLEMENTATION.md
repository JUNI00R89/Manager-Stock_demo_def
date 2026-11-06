# Implementación del módulo de bodega e inventario

Este documento resume lo implementado hasta la fecha del proyecto (Manager Stock) para el módulo de **bodega / inventario**, pensado para que otro agente o herramienta pueda retomarlo con contexto.

## Objetivo

Convertir la operativa de inventario de Manager Stock en un módulo completo:

- Entradas, salidas, mermas, ajustes, conteos, traslados, compras y ventas con trazabilidad.
- Recetas de menú con deducción automática de ingredientes.
- Lotes (FEFO), alertas, reportes y configuraciones.

## Estado actual

- **Backend**: `backend/main.py` (~4.900 líneas). API FastAPI + SQLite.
- **Esquema**: `database/schema.sql`.
- **Frontend**: `src/app/**` (React + TypeScript + Vite).

## Modelo de datos implementado (SQLite)

### Tablas existentes ampliadas / reutilizadas

- `products`: agregó `supplier_id`, `barcode`, `track_lots`, `default_location_id`. Se eliminó el CHECK que impedía stock negativo (la política pasa a config/administración).
- `suppliers`: existentes (nombre, razón social, contacto, email, dirección, notas).
- `inventory_movements`: re-creado con columnas nuevas (tipo ampliado, `unit_cost`, `lot_id`, `location_id`, `operation_id`, `reference_type`, `reference_id`, `reason`, `created_by`, etc.).
- `orders`: agregó `stock_consumed` (cuando la venta ya consumió ingredientes).
- `recipes`: se creó/evolucionó con `unit` (unidad de medida del ingrediente en la receta).

### Nuevas tablas

- `warehouse_locations` (zona, pasillo, rack, nivel, capacidad, código).
- `inventory_operations` (encabezado: tipo, proveedor, referencia, motivo, factura, adjunto, notas, usuario).
- `product_lots` (lote, cantidad, vencimiento, costo, ubicación, recepción).
- `purchase_orders` + `purchase_order_items`.
- `physical_counts` + `physical_count_items`.
- `inventory_transfers` + `inventory_transfer_items` + `inventory_transfer_allocations`.
- `supplier_price_history`.
- `product_substitutions`.

## Endpoints backend (prefixo `/api/inventory`)

| Método | Ruta | Propósito |
|---|---|---|
| GET/POST | `/api/inventory/movements` | Historial con filtros (tipo, ubicación, lote, búsqueda, fechas, producto, usuario, motivo, SKU, unidad) |
| GET/PUT | `/api/inventory/settings` | Config: `allowNegativeStock`, `expiryAlertDays`, `lowStockAlerts`, `defaultLocationId` |
| GET/POST | `/api/inventory/locations`, `/api/inventory/locations/{id}` (PATCH/DELETE) | CRUD de ubicaciones |
| GET | `/api/inventory/lots` | Lotes con estado (`vigente`, `por_vencer`, `vencido`, `sin_vencimiento`), días restantes, valor |
| GET | `/api/inventory/barcode/{code}` | Búsqueda por código de barras/SKU con productos y lotes |
| POST | `/api/inventory/entries` | Entradas (`purchase`, `customer_return`, `donation`, `opening`), lotes/costos/ubicación |
| POST | `/api/inventory/exits` | Salidas (`consumption`, `direct_sale`, `other`) con FEFO |
| POST | `/api/inventory/waste` | Mermas con motivo obligatorio normalizado (`vencido`, `danado`, `error_preparacion`, `otro`) |
| POST | `/api/inventory/adjustments` | Ajustes con motivo obligatorio |
| CRUD compra | `/api/inventory/purchase-orders…` | crear, `approve`, `send`, `receive`, `cancel` |
| CRUD conteo | `/api/inventory/counts`, `/api/inventory/counts` POST | conteos que generan ajustes |
| CRUD transferencia | `/api/inventory/transfers…` | create, `send`, `receive`, `cancel` (con asignación por lotes) |
| GET | `/api/inventory/price-history` | Historial de precios por producto/proveedor |
| GET/PUT | `/api/inventory/reports` | reportes: valor total, stock crítico, vencimientos, merma por motivo, rotación, sin movimiento, diferencias de conteo |
| GET | `/api/inventory/replenishment` | Sugerencias de reposición |
| GET | `/api/inventory/dish-costing` | Costeo de platillos por receta y rendimiento |

Funciones clave en backend:

- `add_product_stock(...)`: suma stock, crea/incrementa lote y registra movimiento.
- `consume_product_stock(...)`: descuenta con FEFO; devuelve movimientos por lote; respeta política de stock negativo (`allows_negative_stock`).
- `reverse_movements(...)`: reversión de movimientos (ventas/órdenes/transferencias).
- `inventory_settings(...)`: lee configuración de bodega desde `businesses.settings_json.inventoryConfig`.
- `has_permission(...)`: permisos delegables del rol (`inventory.view`, `inventory.entry`, `inventory.adjust`, `inventory.delete`, `inventory.negative`, `purchases.approve`).

## Lógica de ventas / pedidos

- `create_sale`: si el producto tiene receta, valida y descuenta ingredientes (o producto directo si no hay receta); usa costo receta para costos.
- `cancel_sale`: revierte movimientos (`sale`, `recipe_consumption`).
- `create_order` / `update_order_status` / `add_order_items`: deducen stock al pasar a `preparing/ready/delivered`; soportan añadir líneas después de consumo parcial; reversión al cancelar.

## Frontend implementado

- Rutas nuevas: `/warehouse`, `/warehouse/entries`, `/warehouse/exits`, `/warehouse/waste`, `/warehouse/adjustments`, `/warehouse/lots`, `/warehouse/purchase-orders`, `/warehouse/counts`, `/warehouse/transfers`, `/warehouse/locations`, `/warehouse/movements`, `/warehouse/reports`, `/warehouse/settings`.
- Rutas heredadas redirigidas: `/inventory/transfers`, `/inventory/physical-count`, `/inventory/movements`.
- Nuevas secciones: `/restaurant/recipes`.
- Navegación lateral agrupada en **Bodega**, con acceso a recetas para negocios de comida.
- Las acciones rápidas del resumen de bodega se ocultan según permisos (`inventory.entry`, `inventory.adjust`).

Páginas creadas en `src/app/pages/warehouse/`:

- `Overview.tsx`: valor del inventario, stock crítico, vencimientos, merma, alertas, lotes por vencer y últimos movimientos.
- `Entries.tsx`: compras, devoluciones de cliente, donaciones y existencias iniciales; multi-línea, lotes, vencimiento, costo, ubicación y escáner.
- `Exits.tsx`: consumo interno, venta directa, otras salidas y mermas con motivo obligatorio (`vencido`, `danado`, `error_preparacion`).
- `Adjustments.tsx`: ajustes con motivo obligatorio y motivos rápidos.
- `Lots.tsx`: lotes, estado, días restantes, valor, filtros por ubicación y accesos a merma/traslado.
- `PurchaseOrders.tsx`: creación, aprobación, envío, recepción parcial/total, historial de precios, compras recientes y **sugerencias de reposición** que se pueden volcar a la orden.
- `Counts.tsx`: conteos físicos que generan ajustes por diferencia.
- `Transfers.tsx`: traslados entre ubicaciones con envío/recepción y movimientos enlazados.
- `Locations.tsx`: CRUD real de zonas, pasillos, racks y niveles.
- `Reports.tsx`: valor total, stock crítico, vencimientos, merma por motivo, rotación, sin movimiento y diferencias de conteo.
- `Settings.tsx`: stock negativo, días de alerta de vencimiento, alertas de stock bajo y ubicación por defecto.

`src/app/pages/inventory/Movements.tsx` fue reescrito para el módulo nuevo:

- Filtros en servidor por producto, tipo, ubicación, rango de fechas y búsqueda (producto, SKU, código de barras, motivo, nota o referencia).
- Columnas de usuario, lote, ubicación, stock antes/después, costo y referencia.
- Enlace directo desde cada producto del catálogo: **Ver movimientos y trazabilidad** (`/warehouse/movements?productId=...`).
- Exportación CSV del resultado filtrado.

Extras implementados:

- `Products.tsx` muestra proveedor, código de barras y acceso al historial del producto.
- `NewProduct.tsx` captura proveedor, código de barras, manejo de lotes y ubicación por defecto.
- `restaurant/Recipes.tsx` guarda unidades por ingrediente y muestra una tabla de **costeo y margen por plato** usando `/api/inventory/dish-costing`.
- `UsersRoles.tsx` expone los permisos nuevos y sus dependencias.
- `security/permissions.ts` protege las rutas de bodega y recetas según el módulo/permisos.

## Verificación realizada

- Script de integración backend `backend/tests/test_sales_api.py` ejecutado correctamente antes de este bloque de cambios: ventas atómicas, recetas, deducción de ingredientes, cancelación y stock.
- No se pudo ejecutar `tsc`/`vite build` porque `npm install` quedó interrumpido y no hay `node_modules`. **Pendiente de verificación de compilación frontend.**

## Trabajo pendiente (resumen)

1. Restaurar dependencias con `npm install` y ejecutar `npx tsc --noEmit` + `npm run build`.
2. Probar en UI los flujos de entradas, salidas, mermas, ajustes, lotes, compras (incluyendo reposición), conteos, traslados, ubicaciones, reportes y configuración.
3. Verificar redirecciones heredadas `/inventory/*` y acceso a `/restaurant/recipes` en negocios de comida.
4. Opcional: eliminar las páginas heredadas `src/app/pages/inventory/Transfers.tsx` y `PhysicalCount.tsx` si se confirma que no se usan.
5. Opcional: exponer en UI el CRUD de sustituciones (`/api/inventory/substitutions`), que ya existe en backend y `dataService`.

## Cómo correr

- Frontend: `npm run dev`
- Backend: `python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000`
- Tests: `python -m pytest backend/tests`

---

*Documento generado durante la implementación del módulo de bodega. No incluye flujos de venta/pago, solo inventario/warehouse.*
