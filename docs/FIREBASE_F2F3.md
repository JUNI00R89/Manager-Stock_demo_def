# F2F.3 — Repositorio Firebase y bandera de backend

**Estado:** completado en modo emulador. La app puede usar Firebase para los
pedidos si se configura `VITE_RESTAURANT_BACKEND=firebase`. El modo por defecto
sigue siendo `local`.

## 1. Qué se añadió

| Archivo | Para qué |
|---|---|
| `src/app/utils/firebaseClient.ts` | Inicializa Firebase (Auth, Firestore, Functions) y conecta a los emuladores cuando `VITE_USE_FIREBASE_EMULATORS=true`. Incluye `ensureFirebaseSignedIn()` para desarrollo. |
| `src/app/utils/firebasePedidosRepository.ts` | Implementa `PedidosRepository` contra Firestore/Cloud Functions. |
| `src/app/utils/restaurantPedidosRepository.ts` | `getPedidosRepository()` elige Firebase si `VITE_RESTAURANT_BACKEND === 'firebase'`. |
| `src/app/utils/restaurantScope.ts` | `useRestaurantBusinessId()` (id crudo del negocio, sin normalizar). |
| `src/app/utils/restaurantOrdersHook.ts` | `useRestaurantTables()` lee de Firestore en modo Firebase. |

## 2. Cómo probarlo manualmente

1. Crear `.env.local` (no se commitea) con:

```env
VITE_RESTAURANT_BACKEND=firebase
VITE_USE_FIREBASE_EMULATORS=true
VITE_FIREBASE_PROJECT_ID=demo-manager-stock
VITE_FIREBASE_API_KEY=demo-api-key
VITE_FIREBASE_AUTH_DOMAIN=demo-manager-stock.firebaseapp.com
VITE_FIREBASE_STORAGE_BUCKET=demo-manager-stock.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000
VITE_FIREBASE_APP_ID=1:000000000000:web:demo
```

2. En una terminal:

```bash
npm run firebase:emulators
```

3. En otra:

```bash
npm run firebase:seed
npm run dev
```

4. Abrir dos pestañas/navegadores en `http://127.0.0.1:5173` con el negocio
   demo. Crear un pedido en una pestaña y verificar que aparece en cocina y
   administración sin recargar.

> En modo emulador el cliente inicia sesión automáticamente con
> `owner.comidas@managerstock.test` (`ComidasDemo2026!`), que tiene claim
> `owner` y acceso completo al negocio demo.

## 3. Validaciones ejecutadas

- `npx tsc --noEmit` sin errores.
- `npm run build` correcto.
- Emuladores: `npm run firebase:test-rules` (10/10) y
  `npm run firebase:test-functions` (10/10).

## 4. Pendientes (F2F.4+)

- Migrar personal, ajustes y catálogo a Firestore (hoy siguen en localStorage).
- Venta y stock atómicos al entregar (F2F.5, variante B con FastAPI).
- Cola offline idempotente (F2F.6).
- Flujo de login real con Firebase Auth para producción (F2F.3b).
- Separar el bundle de Firebase (code-splitting) para reducir el tamaño del JS.
