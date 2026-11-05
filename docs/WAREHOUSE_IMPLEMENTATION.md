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

## Frontend implementado (parcial)

- Rutas nuevas: `/warehouse`, `/warehouse/entries`, `/warehouse/exits`, `/warehouse/waste`, `/warehouse/adjustments`, `/warehouse/lots`, `/warehouse/purchase-orders`, `/warehouse/counts`, `/warehouse/transfers`, `/warehouse/locations`, `/warehouse/movements`, `/warehouse/reports`, `/warehouse/settings`.
- Rutas heredadas redirigidas: `/inventory/transfers`, `/inventory/physical-count`, `/inventory/movements`.
- Nuevas secciones: `/restaurant/recipes`.

Páginas creadas en `src/app/pages/warehouse/`:

- `Overview.tsx` ✅
- `Entries.tsx` ✅
- `Exits.tsx` ✅
- `Adjustments.tsx` ✅
- `Lots.tsx` ✅
- `PurchaseOrders.tsx` ✅
- `Counts.tsx` ✅
- `Transfers.tsx` ⬜ (pendiente)
- `Reports.tsx` ⬜ (pendiente)
- `Settings.tsx` ⬜ (pendiente)
- `Locations.tsx` ⬜ (debe reemplazarse por CRUD real)

`src/app/pages/inventory/Transfers.tsx` y `PhysicalCount.tsx` ya no se usan en rutas y deben eliminarse o dejar de usarse.

## Trabajo pendiente (resumen)

1. Crear restantes páginas de bodega.
2. Reemplazar mock de ubicaciones con CRUD real.
3. Campos de nuevo producto (proveedor, código de barras, lotes, ubicación por defecto).
4. Recetas con unidades; verificación de `/restaurant/recipes`.
5. Dependencias de permisos en `UsersRoles.tsx` (nueva checklist).
6. Actualizar tests backend (`backend/tests/test_sales_api.py`) para recetas y comportamiento nuevo.
7. Ejecutar: tests backend, checks Python, build TypeScript/Vite, migración SQLite y flujos.

## Cómo correr

- Frontend: `npm run dev`
- Backend: `python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000`
- Tests: `python -m pytest backend/tests`

---

*Documento generado durante la implementación del módulo de bodega. No incluye flujos de venta/pago, solo inventario/warehouse.*
