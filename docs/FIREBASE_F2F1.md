# F2F.1 — Base Firebase para pedidos de restaurante

**Estado:** completado en modo emulador. No se creó todavía un proyecto real en
Google Cloud y la app sigue usando el repositorio local (`VITE_RESTAURANT_BACKEND=local`).

Documento de diseño:
[`INTEGRACION_TIEMPO_REAL_FASE2_FIREBASE.md`](INTEGRACION_TIEMPO_REAL_FASE2_FIREBASE.md).

---

## 1. Qué se creó

| Archivo | Para qué |
|---|---|
| `firebase.json` | Emuladores de Auth (9099), Firestore (8080) y UI (4000). |
| `.firebaserc` | Proyecto de emulador `demo-manager-stock`. |
| `firestore.rules` | Aislamiento por negocio y bloqueo de escrituras directas de pedidos. |
| `firestore.indexes.json` | Índices para tablero, historial y pedidos por mesero. |
| `scripts/seed_firebase_emulator.mjs` | Crea usuarios, claims, negocio, personal, mesas, ajustes y productos. |
| `scripts/test_firestore_rules.mjs` | 10 pruebas positivas/negativas de las reglas. |
| `.env.example` | Variables públicas de Firebase y bandera del backend. |

Paquetes instalados:

| Paquete | Versión | Uso |
|---|---|---|
| `firebase` | `13.2.0` | SDK web (se usa en F2F.3). |
| `firebase-tools` | `15.34.2` | Emuladores, reglas e índices. |
| `firebase-admin` | `14.5.0` | Seed local de Auth/Firestore. |
| `@firebase/rules-unit-testing` | última compatible | Pruebas de reglas. |

---

## 2. Cómo levantarlo

En una terminal:

```bash
npm run firebase:emulators
```

En otra terminal, con los emuladores ya arriba:

```bash
npm run firebase:seed
```

Consola web de los emuladores: <http://127.0.0.1:4000>

Pruebas de reglas (levantan y apagan Firestore automáticamente):

```bash
npm run firebase:test-rules
```

Resultado esperado:

```text
10/10 pruebas de reglas pasaron.
```

---

## 3. Usuarios de prueba

Todos usan la contraseña `ComidasDemo2026!`.

| Email | Claim `role` | Personal asociado |
|---|---|---|
| `owner.comidas@managerstock.test` | `owner` | — |
| `admin.comidas@managerstock.test` | `business_admin` | Andrea Díaz (`staff-admin-01`) |
| `mesero.comidas@managerstock.test` | `waiter` | Laura Gómez (`staff-mesero-01`) |
| `cocina.comidas@managerstock.test` | `kitchen` | Carlos Ruiz (`staff-cocina-01`) |

Cada usuario recibe además el claim `businessId = DEMO-FOOD-001`.

> Los claims son una caché para las reglas. La fuente de verdad es
> `businesses/DEMO-FOOD-001/members/{uid}`. Si se cambia un rol, hay que volver
> a ejecutar el seed o actualizar los claims con el Admin SDK y refrescar el
> token en el cliente.

---

## 4. Datos sembrados

```text
businesses/DEMO-FOOD-001
  name: Sabores del Parque (Demo)
  businessType: food
  currency: COP
  taxRate: 0.19
  timezone: America/Bogota

  members/{uid}            owner, business_admin, waiter, kitchen
  staff/staff-mesero-01    Laura Gómez, rol mesero
  staff/staff-cocina-01    Carlos Ruiz, rol cocina
  staff/staff-admin-01     Andrea Díaz, rol admin

  tables/MESA-01           Mesa 1, Salón, 4 puestos
  tables/MESA-02           Mesa 2, Salón, 2 puestos
  tables/MESA-03           Mesa 3, Terraza, 6 puestos

  settings/main            startTime 06:00, expectedMinutes 15

  products/DEMO-PRD-FOOD-001  Hamburguesa clásica
  products/DEMO-PRD-FOOD-002  Papas a la francesa
  products/DEMO-PRD-FOOD-003  Gaseosa 400 ml (venta directa)
  products/DEMO-PRD-FOOD-004  Postre del día (venta directa)
```

El seed es idempotente: se puede ejecutar varias veces sin duplicar documentos.

---

## 5. Reglas implementadas

- Solo un usuario autenticado con claim `businessId` puede leer su negocio.
- Un usuario del negocio A no puede leer ni escribir documentos del negocio B.
- `waiter`, `kitchen` y `cashier` pueden leer pedidos; **ninguno** puede
  escribirlos directamente.
- `owner` y `business_admin` administran personal, mesas, ajustes, catálogo y
  productos.
- `counters/{jornada}`, `orders/{orderId}` y `orders/{orderId}/events/{eventId}`
  solo se escriben desde Cloud Functions (Admin SDK).
- Las reglas no permiten escrituras offline directas de pedidos. La cola
  idempotente se evalúa en F2F.6.

Pruebas incluidas:

1. Anónimo no lee pedidos.
2. Miembro lee pedidos de su negocio.
3. Miembro de A no lee pedidos de B.
4. Usuario sin claim `businessId` no lee.
5. Mesero no escribe pedidos directamente.
6. Cocina lee el tablero.
7. Cocina no edita ajustes.
8. Mesero no edita ajustes.
9. Administrador edita ajustes.
10. Nadie escribe contadores desde el cliente.

---

## 6. Índices

| Consulta | Campos |
|---|---|
| Tablero por jornada | `jornada ASC, estado ASC, creadoEn ASC` |
| Historial | `jornada ASC, estado ASC, actualizadoEn DESC` |
| Pedidos de un mesero | `meseroId ASC, jornada ASC, creadoEn ASC` |
| Numeración / detalle | `jornada ASC, numero ASC` |

Se despliegan con:

```bash
npx firebase deploy --only firestore:indexes
```

---

## 7. Pasar de emulador a proyecto real

El proyecto `demo-manager-stock` es solo para emuladores: no existe en la nube.
Cuando quieras crear el proyecto real:

```bash
npx firebase login
npx firebase projects:create manager-stock-dev --display-name "Manager Stock Dev"
npx firebase use --add
```

Después, en la consola de Firebase:

1. Activar **Authentication → Sign-in method → Email/Password**.
2. Crear **Firestore Database** en modo producción.
3. Desplegar reglas e índices:

```bash
npx firebase deploy --only firestore:rules,firestore:indexes
```

4. Cambiar `.firebaserc` al proyecto real y actualizar las variables
   `VITE_FIREBASE_*` del `.env`.
5. Crear los usuarios reales y sus claims. El seed actual apunta a los
   emuladores; para producción se ejecuta con credenciales de servicio
   (`GOOGLE_APPLICATION_CREDENTIALS`) y sin las variables de emulador.

**Nunca** commitear la cuenta de servicio ni archivos `serviceAccount*.json`.

---

## 8. Siguiente fase

**F2F.2 — Cloud Functions:**

- `crearPedido` con numeración transaccional por jornada.
- `tomarPedido`, `finalizarPedido`, `entregarPedido`, `cancelarPedido`.
- Validación de personal y roles en el servidor (no confiar en el cliente).
- Eventos de auditoría en `orders/{orderId}/events`.
- Venta y stock: primero variante B (FastAPI con `idempotencyKey`).

La app todavía no consume Firebase. Eso ocurre en F2F.3, cuando se cree
`FirebasePedidosRepository` y se active con `VITE_RESTAURANT_BACKEND=firebase`.
