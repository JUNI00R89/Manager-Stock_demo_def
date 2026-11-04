# F2F.2 — Cloud Functions para pedidos

**Estado:** completado en modo emulador. Las cinco funciones están desplegadas en
el emulador y validadas con 10 pruebas de humo.

## 1. Funciones

| Función | Transición | Roles permitidos |
|---|---|---|
| `crearPedido` | `-> pendiente` o `-> finalizado` | mesero, admin |
| `tomarPedido` | `pendiente -> en_preparacion` | cocina, admin |
| `finalizarPedido` | `en_preparacion -> finalizado` | cocina, admin |
| `entregarPedido` | `finalizado -> entregado` | mesero asignado, admin |
| `cancelarPedido` | `* -> cancelado` (salvo `entregado`) | mesero, cocina, admin |

## 2. Garantías implementadas

- Numeración por jornada con contador transaccional (`counters/{jornada}`).
- `select ... for update` equivalente: transacción de Firestore con lectura
  previa del pedido y condición de estado.
- Idempotencia en `tomarPedido`, `finalizarPedido`, `entregarPedido` y
  `cancelarPedido`.
- Conflicto controlado (`failed-precondition` con `CONFLICTO:<estado>`) cuando
  dos dispositivos compiten.
- Auditoría: cada transición crea un evento en `orders/{id}/events`.
- Precios y totales se recalculan en el servidor con los productos de Firestore.
- El nombre del empleado se resuelve en el servidor a partir de `staff/{id}`.
- `entregarPedido` acepta `ventaId` opcional (variante B: venta en FastAPI).

## 3. Cómo probarlo

```bash
npm run firebase:test-functions
```

Levanta Auth, Firestore y Functions, siembra datos y ejecuta 10 pruebas de humo.
Resultado esperado: `10/10 pruebas de funciones pasaron`.

## 4. Archivos

- `functions/package.json`, `functions/tsconfig.json`
- `functions/src/index.ts`
- `scripts/test_functions_emulator.mjs`
- `firebase.json` (sección `functions` y emulador de functions)

## 5. Pendientes

- Venta y stock atómicos al entregar (F2F.5).
- Despliegue a un proyecto real (requiere plan Blaze).
