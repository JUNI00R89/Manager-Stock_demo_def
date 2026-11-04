# README — Flujo de pedidos en tiempo real (restaurant)

## Objetivo

Implementar en `FUSION_UNIFICADO` el flujo de pedidos en tiempo real para negocios `restaurant`:

- Mesero móvil (`/restaurant/waiter`)
- Cocina tablet (`/restaurant/kitchen`)
- Administración de escritorio (`/restaurant/orders`)

El objetivo es que el mesero cree pedidos, la cocina los tome/finalice y el administrador entregue o registre la venta, todo en tiempo real, sin afectar los otros tipos de negocio.

## Estado actual

- **Fase 1:** completada y validada en navegador durante esta sesión.
- **Fase 2:** pendiente. Falta documentar integración futura con Supabase/Firebase, esquema, RLS, variables de entorno y dependencia, sin instalar nada todavía.

## Qué se implementó en la Fase 1

### Almacenamiento y sincronización

- `src/app/utils/restaurantPedidosRepository.ts`
- Persistencia local por negocio con `localStorage`.
- Sincronización entre pestañas mediante `BroadcastChannel` y evento `storage`.
- Bloqueo atómico de toma mediante `navigator.locks` con respaldo en `localStorage`.
- Estados: `pendiente`, `en_preparacion`, `finalizado`, `entregado`, `cancelado`.
- Numeración secuencial que reinicia en `1` por jornada.

### Roles y personal local

- `src/app/components/restaurant/StaffSwitcher.tsx`
- Uso de `UsersRoles.tsx`.
- Roles locales: `mesero`, `cocina`, `admin`.
- Selector con PIN opcional.
- Sembrado automático de usuarios locales por rol con el nombre de la cuenta autenticada.

### Mesero

- Saludo, usuario activo, mesas, menú con búsqueda/categorías, carrito, notas, barra `{n} · Ver pedido · {total}`.
- Confirmación de pedido.
- Pestañas `Nuevo pedido` / `Pedidos`.
- Chips, `Solo míos`, sonido/vibración y “Listos para llevar”.

### Cocina

- Fecha/hora, sonido, usuario activo.
- `En curso` / `Finalizados`.
- Columnas `Entrantes` / `En preparación`.
- Cronómetro, insignia `NUEVO`, botones `Tomar` / `Finalizado`.
- Toast con quién tomó.
- Alerta configurable de 15 minutos.
- Exclusión de productos de venta directa.

### Administración

- Jornada con hora de inicio.
- `Activos` / `Entregados`.
- Tablero de 3 columnas: `Entrantes`, `En preparación`, `Listos`.
- Búsqueda, `Nuevo pedido`, cancelación con motivo, catálogo, ajustes de Mesas y Usuarios.

### Entrega y venta

- `src/app/utils/restaurantOrdersService.ts`
- Al marcar como `entregado`, se registra la venta mediante `dataService.createSale`.
- Se descuenta stock.
- Pedido solo de venta directa pasa directamente a `finalizado` / listo para llevar.

## Validaciones realizadas en esta sesión

1. Se inició sesión con la cuenta demo del restaurante.
2. Se creó un pedido mixto en mesero.
3. Se observó en cocina, se tomó, se finalizó y se entregó.
4. Se comprobó el toast de toma/finalización/entrega y el descuento de stock.
5. Se creó un segundo pedido mixto con nota y se entregó.
6. Se probó venta directa: el pedido apareció como listo para llevar y no entró en cocina.
7. Se probó cancelación con motivo.

## Ajustes de UI aplicados al final

- La barra inferior del mesero quedó anclada correctamente en móvil.
- El header grande se oculta en móvil al abrir menú para liberar espacio.
- Área táctil del switch ampliada a aproximadamente 44 px.
- Steppers del carrito aumentados a 44 px.
- Botones y controles del nuevo pedido, catálogo y ajustes ajustados a objetivos táctiles.

## Fase 2 pendiente

- Documentar integración con Supabase/Firebase.
- Esquema de datos.
- RLS.
- Variables de entorno.
- Dependencia a instalar, sin instalarla todavía.

## Comandos

```bash
# Backend
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000

# Frontend
npx vite --host 0.0.0.0 --port 5173

# Validaciones
npx tsc --noEmit
npx vite build
```

## Cuenta demo usada

- Email: `owner.comidas@managerstock.test`
- Contraseña: `ComidasDemo2026!`
- Negocio: “Sabores del Parque (Demo)”

## Nota

- La base real `backend/data/manager_stock.db` no se reemplazó.
- El trabajo actual se mantiene en el repositorio local y debe guardarse antes de continuar.
