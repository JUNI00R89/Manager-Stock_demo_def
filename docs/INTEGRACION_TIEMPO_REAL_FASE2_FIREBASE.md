# Fase 2 — Variante Firebase para pedidos en tiempo real

**Estado:** diseño aprobado. F2F.1 completado en modo emulador; ver
[`FIREBASE_F2F1.md`](FIREBASE_F2F1.md). La app todavía no consume Firebase.
**Documento base:** [`INTEGRACION_TIEMPO_REAL_FASE2.md`](INTEGRACION_TIEMPO_REAL_FASE2.md) (variante Supabase).
**Alcance:** mesero móvil, cocina y administración para negocios tipo restaurante.

---

## 1. Resumen ejecutivo

Firebase es una opción válida y, en un punto, mejor que Supabase para este proyecto:
su SDK web maneja **caché local y reconexión** de Firestore de forma nativa, y los
listeners `onSnapshot` son muy simples para mesero, cocina y administración.

La contrapartida es que Firebase es **NoSQL** y la lógica crítica (numeración por
jornada, toma atómica, entrega con venta y descuento de stock) debe vivir en
**Cloud Functions**. Las reglas de Firestore no pueden ejecutar transacciones
entre documentos; solo validan lecturas y escrituras.

### Cuándo elegir Firebase

- Prioridad: aplicación móvil/tablet con sincronización y caché local.
- Se acepta mover el dominio de restaurante a Firestore.
- Se acepta usar Cloud Functions (plan Blaze) para las operaciones críticas.
- No se necesita SQL para reportes del restaurante a corto plazo.

### Cuándo elegir Supabase

- Prioridad: conservar el modelo relacional y los reportes SQL.
- Se quiere RLS en lugar de reglas de Firestore.
- Se prefiere mantener todo el negocio en PostgreSQL.

---

## 2. Otras opciones (comparación)

| Opción | Modelo | Tiempo real | Offline | Auth | Lógica de servidor | Aislamiento | Costo inicial | Esfuerzo | Encaje |
|---|---|---|---|---|---|---|---|---|---|
| **Firebase** | Firestore (NoSQL) | Excelente (`onSnapshot`) | Nativo en Firestore; no en Functions | Firebase Auth | Cloud Functions (Blaze) | Reglas + custom claims | Gratis con límites; Functions exige Blaze | Medio | Alto para móvil/offline |
| **Supabase** | PostgreSQL | Bueno (`postgres_changes`) | Manual (IndexedDB/cola) | Supabase Auth | RPC SQL / Edge Functions | RLS | Gratis con límites | Medio | Alto para SQL/reportes |
| **Appwrite** | Documentos + bases | Bueno | Limitado | Appwrite Auth | Functions | Permisos por documento | Autoalojado o Cloud | Medio | Medio; menos ecosistema |
| **PocketBase** | SQLite (1 binario) | Bueno (SSE) | Manual | Auth incluida | Go hooks / JS | Reglas por colección | Gratis (autoalojado) | Bajo | Alto para demo/LAN; baja escala |
| **FastAPI + WebSocket + PostgreSQL** | SQL | Bueno (WebSocket) | Manual | La actual | La actual | Consultas propias | Infra propia | Alto | Control total; más mantenimiento |

### Recomendación según prioridad

1. **Quieres SQL, reportes y menos proveedores:** Supabase.
2. **Quieres la mejor experiencia móvil y offline con poco frontend:** Firebase.
3. **Quieres algo pequeño, local y sin nube:** PocketBase o el backend actual con WebSocket.
4. **Quieres control absoluto y ya tienes FastAPI:** WebSocket + PostgreSQL, pero es el camino más largo.

---

## 3. Arquitectura Firebase propuesta

```text
┌─────────────────────────────┐
│ React (mesero/cocina/admin) │
│  Firebase SDK v13           │
│  onSnapshot + Auth          │
└──────────────┬──────────────┘
               │
      ┌────────▼─────────┐
      │ Firebase Auth    │  email/password + custom claims
      └────────┬─────────┘
               │
      ┌────────▼─────────┐        ┌──────────────────────┐
      │ Cloud Firestore  │◄──────►│ Cloud Functions v2   │
      │ businesses/...   │ Admin  │ crear/tomar/finalizar│
      │ orders/...       │  SDK   │ entregar/cancelar    │
      └────────┬─────────┘        └──────────┬───────────┘
               │                             │
      ┌────────▼─────────┐        ┌──────────▼───────────┐
      │ Realtime listeners│        │ Venta + stock        │
      │ (3 dispositivos)  │        │ (Firestore o FastAPI)│
      └──────────────────┘        └──────────────────────┘
```

### Decisiones de arquitectura

- **Firestore es la fuente de verdad** del flujo de restaurante.
- **Las escrituras de pedidos pasan por Cloud Functions**; el cliente no escribe
  directamente pedidos, contadores ni stock.
- **Firebase Auth** emite la identidad. Los roles viajan en custom claims para
  que las reglas sean rápidas, y `members/{uid}` es la fuente de verdad.
- **Cloud Functions v2** en la región más cercana (`southamerica-east1` o
  `us-east1`) para reducir latencia desde Colombia.
- **Firestore offline** se usa para lectura/caché del tablero. Las acciones que
  requieren numeración o venta se deshabilitan sin conexión hasta implementar
  una cola idempotente (F2F.5).

---

## 4. Modelo de datos en Firestore

### 4.1 Estructura

```text
businesses/{businessId}
  name, businessType, currency, taxRate, timezone, active, createdAt
  members/{uid}
    role: owner | business_admin | cashier | waiter | kitchen
    active: boolean
  staff/{staffId}
    authUserId, name, role: mesero | cocina | admin, active, pinHash
  tables/{tableId}
    number, zone, capacity, status: active | inactive
  settings/main
    startTime: "06:00", expectedMinutes: 15
  catalogOverrides/{productId}
    active, directSale
  counters/{jornada}
    lastNumber: number
  orders/{orderId}
    numero, jornada, estado, canal, mesaId, mesaNumero, mesaNombre,
    meseroId, meseroNombre, items[], subtotal, impuesto, taxRate, total,
    nota, listoParaLlevar, tomadoPor*, finalizadoPor*, entregadoPor*,
    canceladoPor*, motivoCancelacion, ventaId, version, creadoEn, actualizadoEn
    events/{eventId}
      estado, actorId, actorNombre, detalle, creadoEn
```

### 4.2 ¿Ítems embebidos o subcolección?

Se recomienda **ítems embebidos** en el documento del pedido:

- El pedido se lee y se actualiza como una sola unidad atómica.
- Un solo listener entrega el pedido completo a cocina y administración.
- Un pedido típico tiene entre 1 y 30 líneas; el límite de 1 MiB de Firestore
  no es un problema.
- Si en el futuro hay pedidos de cientos de líneas, se migra a
  `orders/{orderId}/items/{itemId}` sin cambiar el contrato de la UI.

### 4.3 Ejemplo de documento

```json
{
  "numero": 14,
  "jornada": "2026-11-04",
  "estado": "pendiente",
  "canal": "local",
  "mesaId": "MESA-01",
  "mesaNumero": 1,
  "mesaNombre": "Mesa 1",
  "meseroId": "staff-mesero-01",
  "meseroNombre": "Laura",
  "items": [
    {
      "id": "item-01",
      "productId": "PRD-HAM-001",
      "nombre": "Hamburguesa clásica",
      "precioUnitario": 18000,
      "cantidad": 2,
      "nota": "Sin cebolla",
      "ventaDirecta": false
    }
  ],
  "subtotal": 36000,
  "impuesto": 6840,
  "taxRate": 0.19,
  "total": 42840,
  "listoParaLlevar": false,
  "version": 1,
  "creadoEn": "<serverTimestamp>",
  "actualizadoEn": "<serverTimestamp>"
}
```

### 4.4 Numeración por jornada

```text
businesses/{businessId}/counters/{jornada} = { lastNumber: 14 }
```

La numeración se asigna dentro de la transacción de `crearPedido`:

```ts
const counterRef = db.doc(`businesses/${businessId}/counters/${jornada}`);
const counter = await tx.get(counterRef);
const numero = (counter.data()?.lastNumber ?? 0) + 1;
tx.set(counterRef, { lastNumber: numero }, { merge: true });
```

Nunca usar `count()` ni `orderBy('numero').limit(1)` desde el cliente: dos
meseros pueden crear al mismo tiempo y duplicar el número.

### 4.5 Jornada

Se calcula en el servidor con la zona horaria del negocio:

```ts
function jornadaKey(now: Date, startTime: string, timeZone = 'America/Bogota'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const local = new Date(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00`);
  const [hours, minutes] = startTime.split(':').map(Number);
  local.setMinutes(local.getMinutes() - (hours * 60 + minutes));
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, '0');
  const d = String(local.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
```

---

## 5. Reglas de seguridad de Firestore

### 5.1 Custom claims

Al crear o cambiar un miembro se actualizan los claims:

```ts
await admin.auth().setCustomUserClaims(uid, {
  businessId,
  role,
});
```

El cliente debe refrescar el token después del cambio:

```ts
await auth.currentUser?.getIdToken(true);
```

> Los claims pueden tardar en propagarse. La fuente de verdad sigue siendo
> `businesses/{businessId}/members/{uid}`; los claims son una caché para las
> reglas. Un cambio de rol debe forzar el refresh del token.

### 5.2 Reglas propuestas

```js
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() {
      return request.auth != null;
    }

    function claims() {
      return request.auth.token;
    }

    function inBusiness(businessId) {
      return signedIn() && claims().businessId == businessId;
    }

    function hasRole(businessId, roles) {
      return inBusiness(businessId) && roles.hasAny([claims().role]);
    }

    function isAdmin(businessId) {
      return hasRole(businessId, ['owner', 'business_admin']);
    }

    match /businesses/{businessId} {
      allow read: if inBusiness(businessId);
      allow write: if false; // solo Admin SDK / Cloud Functions

      match /members/{uid} {
        allow read: if inBusiness(businessId);
        allow write: if false;
      }

      match /staff/{staffId} {
        allow read: if inBusiness(businessId);
        allow write: if isAdmin(businessId);
      }

      match /tables/{tableId} {
        allow read: if inBusiness(businessId);
        allow write: if isAdmin(businessId);
      }

      match /settings/{docId} {
        allow read: if inBusiness(businessId);
        allow write: if isAdmin(businessId);
      }

      match /catalogOverrides/{productId} {
        allow read: if inBusiness(businessId);
        allow write: if isAdmin(businessId);
      }

      match /counters/{jornada} {
        allow read: if inBusiness(businessId);
        allow write: if false; // solo Functions
      }

      match /orders/{orderId} {
        allow read: if inBusiness(businessId);
        allow create, update, delete: if false; // solo Functions

        match /events/{eventId} {
          allow read: if inBusiness(businessId);
          allow write: if false;
        }
      }
    }
  }
}
```

### 5.3 Por qué las escrituras de pedidos se niegan al cliente

- La numeración requiere una transacción sobre `counters`.
- La toma debe ser atómica (`pendiente -> en_preparacion`).
- La entrega debe crear venta, descontar stock y marcar el pedido en una sola
  operación.
- Permitir escrituras directas obligaría a duplicar toda esa lógica en reglas,
  que no pueden hacer transacciones entre documentos.

### 5.4 Pruebas negativas

1. Usuario del negocio A lee `businesses/B/orders` → `permission-denied`.
2. Mesero intenta escribir `orders/{id}` directamente → `permission-denied`.
3. Mesero intenta leer `members` de otro negocio → `permission-denied`.
4. Usuario sin claim `businessId` lee cualquier pedido → `permission-denied`.
5. Cocina intenta escribir `settings/main` → `permission-denied`.
6. Token con claim viejo tras cambio de rol: debe refrescarse; probar que el
   acceso anterior se revoca.

---

## 6. Cloud Functions (operaciones críticas)

### 6.1 Estructura sugerida

```text
functions/
  src/
    index.ts
    auth.ts          // helpers de membresía y claims
    orders.ts        // crear/tomar/finalizar/entregar/cancelar
    sales.ts         // venta + stock + movimientos
    jornada.ts       // cálculo de jornada
  package.json
  tsconfig.json
```

Runtime recomendado: **Node.js 22** (verificar disponibilidad en la región).
Región: `southamerica-east1` (São Paulo) o `us-east1`.

### 6.2 `crearPedido`

```ts
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const db = getFirestore();

export const crearPedido = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión.');

    const { businessId, mesaId, items, nota, meseroId } = request.data ?? {};
    if (!businessId || !mesaId || !meseroId || !Array.isArray(items) || items.length === 0) {
      throw new HttpsError('invalid-argument', 'Pedido incompleto.');
    }

    const memberRef = db.doc(`businesses/${businessId}/members/${uid}`);
    const orderId = request.data.orderId || crypto.randomUUID();
    const orderRef = db.doc(`businesses/${businessId}/orders/${orderId}`);

    return db.runTransaction(async (tx) => {
      const member = await tx.get(memberRef);
      if (!member.exists || member.data()?.active !== true) {
        throw new HttpsError('permission-denied', 'Sin acceso al negocio.');
      }

      // El nombre y el rol salen del servidor, nunca del cliente.
      const staffSnap = await tx.get(db.doc(`businesses/${businessId}/staff/${meseroId}`));
      if (!staffSnap.exists || staffSnap.data()?.active !== true) {
        throw new HttpsError('permission-denied', 'Empleado no válido.');
      }
      const staff = staffSnap.data()!;
      if (staff.role !== 'mesero' && staff.role !== 'admin') {
        throw new HttpsError('permission-denied', 'El empleado no puede crear pedidos.');
      }

      const settingsSnap = await tx.get(db.doc(`businesses/${businessId}/settings/main`));
      const startTime = settingsSnap.data()?.startTime ?? '06:00';
      const jornada = jornadaKey(new Date(), startTime, 'America/Bogota');

      const existing = await tx.get(orderRef);
      if (existing.exists) {
        const data = existing.data()!;
        return { id: orderId, numero: data.numero, estado: data.estado }; // idempotente
      }

      // Leer productos y recalcular precios en el servidor.
      const businessSnap = await tx.get(db.doc(`businesses/${businessId}`));
      const productRefs = items.map((item: any) =>
        db.doc(`businesses/${businessId}/products/${item.productId}`)
      );
      const productSnaps = await Promise.all(productRefs.map((ref) => tx.get(ref)));
      const normalized = items.map((item: any, index: number) => {
        const product = productSnaps[index];
        if (!product.exists || product.data()?.active === false) {
          throw new HttpsError('failed-precondition', `Producto no disponible: ${item.productId}`);
        }
        const data = product.data()!;
        const cantidad = Math.max(1, Math.round(Number(item.cantidad) || 1));
        return {
          id: item.id || crypto.randomUUID(),
          productId: item.productId,
          nombre: data.name,
          precioUnitario: data.price,
          cantidad,
          nota: item.nota?.trim() || null,
          ventaDirecta: Boolean(product.data()?.directSale),
        };
      });

      const subtotal = normalized.reduce(
        (sum, item) => sum + item.precioUnitario * item.cantidad, 0
      );
      const taxRate = Number(businessSnap.data()?.taxRate ?? 0.19);
      const impuesto = Math.round(subtotal * taxRate);
      const total = subtotal + impuesto;
      const directOnly = normalized.every((item) => item.ventaDirecta);

      const counterRef = db.doc(`businesses/${businessId}/counters/${jornada}`);
      const counter = await tx.get(counterRef);
      const numero = (counter.data()?.lastNumber ?? 0) + 1;

      const mesaSnap = await tx.get(db.doc(`businesses/${businessId}/tables/${mesaId}`));
      if (!mesaSnap.exists) throw new HttpsError('not-found', 'Mesa no encontrada.');

      // Todas las lecturas ya están hechas: desde aquí solo se escribe.
      tx.set(counterRef, { lastNumber: numero }, { merge: true });

      const order = {
        numero,
        jornada,
        estado: directOnly ? 'finalizado' : 'pendiente',
        canal: 'local',
        mesaId,
        mesaNumero: mesaSnap.data()!.number,
        mesaNombre: mesaSnap.data()!.name || `Mesa ${mesaSnap.data()!.number}`,
        meseroId,
        meseroNombre: staff.name,
        items: normalized,
        subtotal,
        impuesto,
        taxRate,
        total,
        nota: nota?.trim() || null,
        listoParaLlevar: directOnly,
        version: 1,
        creadoEn: FieldValue.serverTimestamp(),
        actualizadoEn: FieldValue.serverTimestamp(),
      };

      tx.create(orderRef, order);
      tx.create(orderRef.collection('events').doc(), {
        estado: order.estado,
        actorId: meseroId,
        actorNombre: staff.name,
        detalle: { numero, jornada },
        creadoEn: FieldValue.serverTimestamp(),
      });

      return { id: orderId, numero, estado: order.estado };
    });
  }
);
```

> Los `serverTimestamp()` se resuelven en el servidor y **no** se devuelven en la
> respuesta del callable; el cliente recibe los valores reales por `onSnapshot`.
> La respuesta solo confirma `id`, `numero` y `estado`.

> `Promise.all` con `tx.get` no es válido en todas las versiones del SDK Admin:
> las lecturas de una transacción deben hacerse antes de las escrituras. Si el
> SDK de Firestore no permite lecturas concurrentes, se leen secuencialmente.
> Verificar con la versión instalada antes de implementar.

### 6.3 `tomarPedido`

```ts
export const tomarPedido = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Inicia sesión.');

    const { businessId, orderId, staffId } = request.data ?? {};
    const orderRef = db.doc(`businesses/${businessId}/orders/${orderId}`);

    return db.runTransaction(async (tx) => {
      const member = await tx.get(db.doc(`businesses/${businessId}/members/${uid}`));
      if (!member.exists || member.data()?.active !== true) {
        throw new HttpsError('permission-denied', 'Sin acceso al negocio.');
      }

      // El nombre y el rol salen del servidor, nunca del cliente.
      const staffSnap = await tx.get(db.doc(`businesses/${businessId}/staff/${staffId}`));
      if (!staffSnap.exists || staffSnap.data()?.active !== true) {
        throw new HttpsError('permission-denied', 'Empleado no válido.');
      }
      const staff = staffSnap.data()!;
      if (staff.role !== 'cocina') {
        throw new HttpsError('permission-denied', 'Solo cocina puede tomar pedidos.');
      }
      const staffName = staff.name;

      const snap = await tx.get(orderRef);
      if (!snap.exists) throw new HttpsError('not-found', 'Pedido no encontrado.');
      const order = snap.data()!;

      if (order.estado === 'en_preparacion' && order.tomadoPorId === staffId) {
        return { id: orderId, estado: order.estado }; // idempotente
      }
      if (order.estado !== 'pendiente') {
        throw new HttpsError(
          'failed-precondition',
          `CONFLICTO:${order.estado}`,
          { pedidoId: orderId, estado: order.estado }
        );
      }

      tx.update(orderRef, {
        estado: 'en_preparacion',
        tomadoPorId: staffId,
        tomadoPorNombre: staffName,
        tomadoEn: FieldValue.serverTimestamp(),
        actualizadoEn: FieldValue.serverTimestamp(),
        version: FieldValue.increment(1),
      });
      tx.create(orderRef.collection('events').doc(), {
        estado: 'en_preparacion',
        actorId: staffId,
        actorNombre: staffName,
        detalle: {},
        creadoEn: FieldValue.serverTimestamp(),
      });

      return { id: orderId, estado: 'en_preparacion' };
    });
  }
);
```

`finalizarPedido` y `cancelarPedido` siguen el mismo patrón:

- `finalizar`: solo desde `en_preparacion`.
- `cancelar`: cualquier estado salvo `entregado`; exige motivo.
- `entregar`: solo desde `finalizado`; es la operación más delicada.

### 6.4 `entregarPedido` con venta y stock

Dos variantes:

#### Variante A — todo en Firestore (recomendada si se migra el catálogo)

```text
transacción:
  1. leer pedido
  2. si estado == entregado y ventaId existe -> devolver (idempotente)
  3. exigir estado == finalizado
  4. leer productos involucrados
  5. verificar stock suficiente
  6. crear sales/{saleId} con idempotencyKey = restaurant-order-{orderId}
  7. descontar stock de cada producto
  8. crear inventoryMovements
  9. actualizar pedido: entregado, ventaId, entregadoPor*, timestamps
 10. crear evento
```

`saleId = restaurant-order-{orderId}` actúa como clave idempotente: si la
transacción se reintenta, la venta no se duplica.

#### Variante B — venta en el backend actual (FastAPI/SQLite)

```text
  1. transacción: leer pedido y validar estado
  2. llamar a FastAPI POST /api/sales con idempotencyKey
  3. transacción: marcar pedido entregado con ventaId
```

Riesgo: si el paso 2 responde pero el paso 3 falla, hay que reintentar. La
idempotencia del backend evita duplicar la venta, pero el pedido puede quedar
“listo” hasta que el reintento funcione. Es aceptable como transición, no como
arquitectura final.

### 6.5 Venta y stock: dependencia del catálogo

Para descontar stock en Firestore, los productos deben existir en:

```text
businesses/{businessId}/products/{productId}
  name, sku, category, price, cost, stock, minStock, active,
  productType, directSale
```

Si el catálogo sigue en SQLite/FastAPI, la variante A no es posible sin migrar
productos. Esto es una decisión de alcance de la fase 2.

---

## 7. Cliente React

### 7.1 Inicialización

```ts
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});
```

### 7.2 Suscripción al tablero

```ts
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';

export function subscribeOrders(businessId: string, jornada: string, onChange: (rows: Pedido[]) => void) {
  const q = query(
    collection(db, `businesses/${businessId}/orders`),
    where('jornada', '==', jornada),
    where('estado', 'in', ['pendiente', 'en_preparacion', 'finalizado']),
    orderBy('creadoEn', 'asc'),
  );

  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snapshot) => {
      const rows = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Pedido[];
      onChange(rows);
    },
    (error) => console.error('orders-listener', error),
  );
}
```

### 7.3 Índices compuestos

Firestore exige índices para consultas con varios campos:

```text
orders: jornada ASC, estado ASC, creadoEn ASC
orders: jornada ASC, estado ASC, actualizadoEn DESC
```

Se declaran en `firestore.indexes.json` y se despliegan con:

```bash
firebase deploy --only firestore:indexes
```

### 7.4 Llamadas a Functions

```ts
import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions(app, 'southamerica-east1');
const crearPedido = httpsCallable(functions, 'crearPedido');

try {
  const result = await crearPedido({ businessId, mesaId, items, nota });
  return result.data as Pedido;
} catch (error: any) {
  if (error.code === 'functions/failed-precondition') {
    // conflicto de estado: refrescar tablero y mostrar mensaje
  }
  throw error;
}
```

### 7.5 Offline: qué funciona y qué no

| Función | Offline |
|---|---|
| Ver pedidos ya cargados | Sí, caché de Firestore. |
| Recibir cambios al reconectar | Sí, `onSnapshot` re-sincroniza. |
| Crear pedido | No con Functions; requiere conexión o cola propia. |
| Tomar/finalizar/entregar | No con Functions; requiere conexión o cola propia. |
| Ver ventas/stock cacheados | Sí, si están en Firestore. |

Si el offline de escritura es obligatorio, hay dos caminos:

1. **Cola local idempotente** (recomendada): guardar la operación en IndexedDB,
   reintentar al reconectar y usar IDs de operación para no duplicar.
2. **Permitir escrituras directas** a Firestore con reglas estrictas y numeración
   temporal local; es complejo y puede generar números duplicados al sincronizar.

Para restaurante, la opción 1 es la única que conserva la numeración correcta.

---

## 8. Mapeo local → Firestore

| Campo local (`Pedido`) | Campo Firestore |
|---|---|
| `id` | ID del documento `orders/{orderId}` |
| `negocioId` | `businesses/{businessId}` |
| `numero` | `numero` |
| `jornada` | `jornada` |
| `estado` | `estado` |
| `canal` | `canal` |
| `mesaId` / `mesaNumero` / `mesaNombre` | `mesaId` / `mesaNumero` / `mesaNombre` |
| `meseroId` / `meseroNombre` | `meseroId` / `meseroNombre` |
| `items[]` | `items[]` (array embebido) |
| `subtotal` / `impuesto` / `taxRate` / `total` | mismos nombres |
| `nota` | `nota` |
| `creadoEn` / `actualizadoEn` | timestamps del servidor |
| `tomadoPor*` / `tomadoEn` | `tomadoPor*` / `tomadoEn` |
| `finalizadoPor*` / `finalizadoEn` | `finalizadoPor*` / `finalizadoEn` |
| `entregadoPor*` / `entregadoEn` | `entregadoPor*` / `entregadoEn` |
| `canceladoPor*` / `canceladoEn` / `motivoCancelacion` | mismos nombres |
| `ventaId` / `ventaRegistradaEn` | `ventaId` / `ventaRegistradaEn` |
| `listoParaLlevar` | `listoParaLlevar` |
| `PedidoItem.id` | `items[].id` |
| `PedidoItem.productId` | `items[].productId` |
| `PedidoItem.nombre` | `items[].nombre` |
| `PedidoItem.precioUnitario` | `items[].precioUnitario` |
| `PedidoItem.cantidad` | `items[].cantidad` |
| `PedidoItem.nota` | `items[].nota` |
| `PedidoItem.ventaDirecta` | `items[].ventaDirecta` |

---

## 9. Variables de entorno

### Frontend (públicas)

```env
VITE_RESTAURANT_BACKEND=firebase
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=<proyecto>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<proyecto>
VITE_FIREBASE_STORAGE_BUCKET=<proyecto>.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...

# Solo desarrollo local con emuladores
VITE_USE_FIREBASE_EMULATORS=true
```

La configuración web de Firebase es pública por diseño. La seguridad la dan las
reglas de Firestore y los custom claims; no es un secreto.

### Functions / administración

```env
# En producción, Cloud Functions usa la identidad del servicio automáticamente.
# Para desarrollo local:
GCLOUD_PROJECT=<proyecto>
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099

# Solo si una Function llama al backend actual:
RESTAURANT_API_URL=http://127.0.0.1:8000/api
RESTAURANT_API_TOKEN=<secreto>
```

Nunca incluir una cuenta de servicio (`serviceAccount.json`) en el frontend ni
en Git. Para CI/local se usa `GOOGLE_APPLICATION_CREDENTIALS` fuera del repo.

---

## 10. Dependencia a instalar (cuando se apruebe)

**No instalada todavía.** Versiones estables de referencia (noviembre 2026):

| Paquete | Dónde | Versión de referencia |
|---|---|---|
| `firebase` | frontend | `13.2.0` |
| `firebase-admin` | functions | `14.5.0` |
| `firebase-functions` | functions | `7.4.0` |
| `firebase-tools` | desarrollo (CLI) | `15.34.2` |

Comandos previstos (no ejecutar aún):

```bash
npm install firebase
npm install -D firebase-tools
npm --prefix functions install firebase-admin firebase-functions
```

Estructura mínima de Functions:

```json
{
  "name": "manager-stock-functions",
  "engines": { "node": "22" },
  "main": "lib/index.js",
  "dependencies": {
    "firebase-admin": "^14.5.0",
    "firebase-functions": "^7.4.0"
  }
}
```

---

## 11. Costos y límites

- **Firestore:** capa gratuita aproximada de 50.000 lecturas/día, 20.000
  escrituras/día, 20.000 borrados/día y 1 GiB de almacenamiento. Verificar
  precios vigentes antes de producción.
- **Cloud Functions v2:** requiere plan **Blaze** (pago por uso). Tiene una capa
  gratuita mensual de invocaciones y tiempo de cómputo; el cobro empieza al
  superarla.
- **Firebase Auth:** gratis para email/contraseña dentro de los límites.
- **Hosting:** capa gratuita de 10 GB/mes de transferencia.
- **Realtime:** cada documento leído por un listener cuenta como lectura; los
  cambios posteriores cuentan como nuevas lecturas. Con 5 negocios y decenas de
  pedidos al día, el costo es bajo; monitorear antes de escalar.

Ejemplo de estimación:

```text
5 negocios × 100 pedidos/día = 500 pedidos/día
Cada pedido: 1 creación + ~8 actualizaciones = 4.500 escrituras/día
3 dispositivos × 500 pedidos × 2 lecturas = 3.000 lecturas/día
```

Está dentro de la capa gratuita de Firestore; las Functions se cobran aparte.

---

## 12. Plan de implementación

| Fase | Entregable | Riesgo | Estado |
|---|---|---|---|
| F2F.0 | Aprobar Firebase y el alcance (solo pedidos o todo el dominio) | Bajo | Aprobado |
| F2F.1 | Proyecto Firebase, Auth, Firestore, reglas e índices | Bajo | Emulador listo |
| F2F.2 | Cloud Functions `crear/tomar/finalizar/entregar/cancelar` | Medio | Emulador listo |
| F2F.3 | `FirebasePedidosRepository` + bandera `VITE_RESTAURANT_BACKEND=firebase` | Medio | Completado |
| F2F.4 | Migrar mesas, personal, ajustes y catálogo | Medio | Pendiente |
| F2F.5 | Venta + stock atómicos (Firestore o backend) | Alto | Pendiente |
| F2F.6 | Cola offline idempotente (si se requiere) | Alto | Pendiente |
| F2F.7 | Pruebas multidispositivo y corte | Alto | Pendiente |

Detalle de F2F.1: [`FIREBASE_F2F1.md`](FIREBASE_F2F1.md).

### Migración de datos locales

1. Exportar pedidos por negocio desde `localStorage`.
2. Validar con `normalizeOrders`.
3. Insertar en Firestore respetando `counters/{jornada}` (máximo histórico + 1).
4. No migrar pedidos de demostración a producción sin autorización.
5. Conservar el repositorio local como modo de desarrollo/pruebas.

---

## 13. Matriz de aceptación

| Caso | Resultado esperado |
|---|---|
| Mesero crea pedido en el celular | Cocina lo ve en menos de 2 s. |
| Dos cocineros tocan “Tomar” | Solo uno gana; el otro recibe conflicto y refresca. |
| Cocina finaliza | Administración y mesero ven “Listo” sin recargar. |
| Administración entrega | Se crea una sola venta y el stock baja una vez. |
| Reintento de entrega | No duplica venta ni stock (`restaurant-order-{id}`). |
| 20 pedidos simultáneos | Números únicos y consecutivos por jornada. |
| Usuario de otro negocio | No puede leer ni escribir pedidos ajenos. |
| Mesero intenta escribir un pedido directo | `permission-denied`. |
| Se cae la red y vuelve | El tablero se reconcilia; no hay pedidos fantasma. |
| Cambio de jornada a las 06:00 | La numeración reinicia en 1. |

---

## 14. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Reglas mal configuradas filtran datos | Pruebas negativas con emulador y revisión antes del corte. |
| Lógica de pedidos duplicada en cliente y Functions | Una sola implementación en Functions; el cliente solo invoca. |
| Firestore es NoSQL y complica reportes | Mantener reportes en el backend/SQLite o exportar a BigQuery. |
| Functions exige plan Blaze | Aprobar costo antes de empezar; monitorear invocaciones. |
| Cold starts en Functions | Región cercana, mínimo de instancias si el presupuesto lo permite. |
| Custom claims desactualizados | Refrescar token tras cambios de rol; validar membresía en Functions. |
| Offline de escritura no funciona con Functions | Cola idempotente en IndexedDB (F2F.6) o modo online-first. |
| Límite de 1 MiB por documento | Ítems embebidos solo para pedidos normales; subcolección si crece. |
| Dependencia de Google | Contrato `PedidosRepository` permite volver a Supabase/local. |

---

## 15. Decisiones aprobadas

Aprobadas el 2026-11-04:

1. **Proveedor:** Firebase.
2. **Alcance inicial:** pedidos, mesas, personal, ajustes y overrides del
   catálogo. Inventario completo queda para F2F.5.
3. **Venta/stock:** primero variante B (FastAPI actual con `idempotencyKey`);
   luego se evalúa migrar todo a Firestore.
4. **Offline:** online-first al inicio; cola idempotente en F2F.6.
5. **Permisos:** cualquier cocinero puede finalizar; entregar solo el mesero
   asignado o un administrador.
6. **Autenticación:** Firebase Auth desde el inicio para el módulo restaurante,
   conviviendo con el login actual mientras se migra el resto.

Estas decisiones quedaron aplicadas en la base de F2F.1
([`FIREBASE_F2F1.md`](FIREBASE_F2F1.md)).
