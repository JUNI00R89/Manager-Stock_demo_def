# Fase 2 — Integración de pedidos de restaurante en tiempo real

**Estado:** documentación de diseño. No se instaló ninguna dependencia ni se modificó el flujo actual.
**Alcance:** mesero móvil (`/restaurant/waiter`), cocina (`/restaurant/kitchen`) y administración (`/restaurant/orders`).
**Base de la fase 1:** `README_PEDIDOS_RESTAURANTE.md`.

---

## 1. Punto de partida (fase 1)

La fase 1 funciona sin backend adicional y está implementada en:

| Archivo | Responsabilidad |
|---|---|
| `src/app/utils/restaurantTypes.ts` | Contrato `Pedido`, `PedidoItem`, estados y `PedidosRepository`. |
| `src/app/utils/restaurantPedidosRepository.ts` | Repositorio local sobre `localStorage`, bloqueo y sincronización. |
| `src/app/utils/restaurantStorage.ts` | Almacén con ámbito por negocio y `useSyncExternalStore`. |
| `src/app/utils/restaurantOrdersHook.ts` | Suscripción de las vistas a los pedidos y a las mesas. |
| `src/app/utils/restaurantOrdersService.ts` | Entrega del pedido y registro de la venta. |
| `src/app/utils/restaurantStaffStore.ts` | Personal local: mesero, cocina y administración. |
| `src/app/utils/restaurantSettingsStore.ts` | Jornada, minutos esperados y nombres de mesas. |
| `src/app/utils/restaurantCatalogStore.ts` | Overrides locales del menú y venta directa. |

### Claves locales actuales

| Dato | Clave |
|---|---|
| Pedidos | `manager_stock_restaurant_pedidos_v1_<negocio>` |
| Personal | `manager_stock_restaurant_staff_v1_<negocio>` |
| Ajustes | `manager_stock_restaurant_settings_v1_<negocio>` |
| Catálogo | `manager_stock_restaurant_catalog_v1_<negocio>` |
| Candado de escritura | `manager_stock_restaurant_pedidos_v1_lock_<negocio>` |

`<negocio>` se normaliza con `normalizeScope()` a partir de `config.id`, `user.businessId` o el nombre del negocio.

### Estados y reglas vigentes

```
pendiente -> en_preparacion -> finalizado -> entregado
     \             \              \
      \             \              +--> cancelado (solo antes de entregar)
       +-------------+------------------> cancelado
```

- Un pedido compuesto **solo** por productos de venta directa nace en `finalizado`
  (`listoParaLlevar = true`) y no aparece en cocina.
- `tomarPedido` es idempotente si el mismo empleado vuelve a tomar el pedido.
- `entregarPedido` solo acepta pedidos en `finalizado`.
- Un pedido `entregado` no se puede cancelar.
- La cancelación exige un motivo.
- El número de pedido reinicia por **jornada**, calculada con la hora de inicio
  configurada (`getJornadaKey`), no a medianoche.
- La entrega registra la venta con `dataService.createSale()` y usa
  `idempotencyKey = restaurant-order-<pedidoId>`.

### Limitación real de la fase 1

`localStorage` y `BroadcastChannel` solo sincronizan **pestañas del mismo navegador y del mismo equipo**.
No sincronizan el celular del mesero con la tablet de cocina ni con el PC de administración.
Ese es exactamente el problema que resuelve la fase 2.

---

## 2. Decisión de arquitectura

### Recomendación: Supabase (PostgreSQL + Realtime + RLS)

Motivos:

1. El proyecto ya modela la operación en SQL (SQLite: `orders`, `order_items`,
   `restaurant_tables`, `sales`, `sale_items`, `inventory_movements`).
2. RLS permite aislar por negocio sin construir un gateway propio para cada
   lectura en tiempo real.
3. `postgres_changes` de Supabase Realtime cubre el caso mesero → cocina →
   administración con latencia baja.
4. Las operaciones críticas (tomar pedido, numerar, entregar y registrar venta)
   pueden resolverse en una función SQL transaccional, sin carreras entre
   dispositivos.
5. El plan gratuito alcanza para desarrollo y pruebas; producción se evalúa
   aparte.

### Alternativa: Firebase (documento detallado)

Diseño completo en
[`INTEGRACION_TIEMPO_REAL_FASE2_FIREBASE.md`](INTEGRACION_TIEMPO_REAL_FASE2_FIREBASE.md).
Es viable y tiene mejor caché offline nativa, pero obliga a llevar la lógica de
negocio a Cloud Functions, duplicar validaciones en reglas de Firestore y
alejarse del modelo SQL que ya existe. La sección 10 de este documento resume
las diferencias.

### Lo que **no** se va a hacer

- No se reemplaza `localStorage` de golpe: se conserva como modo offline y
  como respaldo de desarrollo.
- No se hace doble escritura permanente (local + remoto). Genera divergencia.
  La fuente de verdad será una sola; el modo local se usa solo sin conexión.
- No se exponen claves `service_role` en el frontend.

---

## 3. Autenticación e identidad

Hay dos caminos. **Se recomienda A.**

### A. Supabase Auth (recomendado)

- El usuario inicia sesión con Supabase Auth (email + contraseña).
- La tabla `business_members` relaciona `auth.uid()` con el negocio y el rol.
- RLS usa `auth.uid()` directamente.
- El backend FastAPI actual puede convivir durante la transición, pero la
  identidad de tiempo real la emite Supabase.

### B. Mantener el login actual de FastAPI

- El backend emite un JWT propio firmado con el secreto de Supabase
  (`SUPABASE_JWT_SECRET`) incluyendo `sub`, `business_id` y `role`.
- RLS lee los claims con `auth.jwt()`.
- Requiere implementar la firma y rotación de tokens; más trabajo y más riesgo.

### Roles

Los roles de autenticación actuales (`owner`, `business_admin`, `cashier`) no
alcanzan para el flujo de restaurante. Se propone:

| Rol de negocio | Uso |
|---|---|
| `owner` | Todo el negocio. |
| `business_admin` | Operación y configuración. |
| `cashier` | Caja y ventas. |
| `waiter` | Mesero: crear pedidos, ver los propios, entregar. |
| `kitchen` | Cocina: ver pedidos, tomar y finalizar. |

El personal local (`restaurant_staff`) se conserva para mostrar el nombre y el
PIN operativo, pero queda vinculado opcionalmente a un usuario real:

```text
restaurant_staff.auth_user_id -> auth.users.id (nullable)
```

Los roles `mesero`, `cocina` y `admin` de la fase 1 se mapean a
`waiter`, `kitchen` y `business_admin` respectivamente.

---

## 4. Esquema propuesto (PostgreSQL / Supabase)

> Convenciones: `snake_case`, `timestamptz` en UTC, dinero en `numeric(12,2)`,
> `business_id` como `text` para conservar los ids actuales (`DEMO-FOOD-001`).

### 4.1 Negocios y miembros

```sql
create table if not exists public.businesses (
  id            text primary key,
  name          text not null,
  business_type text not null default 'food',
  currency      text not null default 'COP',
  tax_rate      numeric(5,4) not null default 0.19,
  timezone      text not null default 'America/Bogota',
  active        boolean not null default true,
  settings_json jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create table if not exists public.business_members (
  business_id text not null references public.businesses(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('owner','business_admin','cashier','waiter','kitchen')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  primary key (business_id, user_id)
);

create index if not exists idx_business_members_user
  on public.business_members(user_id, active);
```

### 4.2 Personal operativo y ajustes

```sql
create table if not exists public.restaurant_staff (
  id            text primary key default gen_random_uuid()::text,
  business_id   text not null references public.businesses(id) on delete cascade,
  auth_user_id  uuid references auth.users(id) on delete set null,
  name          text not null check (length(trim(name)) between 1 and 120),
  role          text not null check (role in ('mesero','cocina','admin')),
  active        boolean not null default true,
  pin_hash      text,           -- nunca guardar el PIN en texto plano
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_restaurant_staff_business
  on public.restaurant_staff(business_id, role, active);

create table if not exists public.restaurant_settings (
  business_id      text primary key references public.businesses(id) on delete cascade,
  start_time       time not null default '06:00',
  expected_minutes integer not null default 15 check (expected_minutes between 1 and 180),
  updated_at       timestamptz not null default now()
);

-- Nombres visibles de mesas; el número sigue viviendo en restaurant_tables.
create table if not exists public.restaurant_table_names (
  business_id text not null references public.businesses(id) on delete cascade,
  table_id    text not null,
  name        text not null check (length(trim(name)) between 1 and 80),
  primary key (business_id, table_id)
);
```

### 4.3 Mesas

Se reutiliza la tabla existente, adaptada a Postgres:

```sql
create table if not exists public.restaurant_tables (
  id          text primary key,
  business_id text not null references public.businesses(id) on delete cascade,
  number      integer not null check (number > 0),
  zone        text not null default '',
  capacity    integer not null default 4 check (capacity > 0),
  status      text not null default 'active' check (status in ('active','inactive')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (business_id, number)
);
```

### 4.4 Pedidos

```sql
create table if not exists public.restaurant_orders (
  id                  text primary key,             -- uuid generado en el cliente
  business_id         text not null references public.businesses(id) on delete cascade,
  numero              integer not null check (numero > 0),
  jornada             date not null,
  estado              text not null default 'pendiente'
                        check (estado in ('pendiente','en_preparacion','finalizado','entregado','cancelado')),
  canal               text not null default 'local' check (canal in ('local','takeaway','delivery')),
  mesa_id             text references public.restaurant_tables(id),
  mesa_numero         integer not null default 0,
  mesa_nombre         text not null default 'Mesa',
  mesero_id           text references public.restaurant_staff(id),
  mesero_nombre       text not null default '',
  subtotal            numeric(12,2) not null default 0 check (subtotal >= 0),
  impuesto            numeric(12,2) not null default 0 check (impuesto >= 0),
  tax_rate            numeric(5,4) not null default 0 check (tax_rate between 0 and 1),
  total               numeric(12,2) not null default 0 check (total >= 0),
  nota                text,
  listo_para_llevar   boolean not null default false,
  tomado_por_id       text references public.restaurant_staff(id),
  tomado_por_nombre   text,
  tomado_en           timestamptz,
  finalizado_por_id   text references public.restaurant_staff(id),
  finalizado_por_nombre text,
  finalizado_en       timestamptz,
  entregado_por_id    text references public.restaurant_staff(id),
  entregado_por_nombre text,
  entregado_en        timestamptz,
  cancelado_por_id    text references public.restaurant_staff(id),
  cancelado_por_nombre text,
  cancelado_en        timestamptz,
  motivo_cancelacion  text,
  venta_id            text,                          -- sales.id cuando se entrega
  venta_registrada_en timestamptz,
  version             integer not null default 1,    -- control de concurrencia
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),
  unique (business_id, jornada, numero)
);

create index if not exists idx_restaurant_orders_board
  on public.restaurant_orders(business_id, estado, creado_en);
create index if not exists idx_restaurant_orders_jornada
  on public.restaurant_orders(business_id, jornada, numero);

create table if not exists public.restaurant_order_items (
  id               text primary key default gen_random_uuid()::text,
  order_id         text not null references public.restaurant_orders(id) on delete cascade,
  product_id       text not null,
  nombre           text not null,
  precio_unitario  numeric(12,2) not null check (precio_unitario >= 0),
  cantidad         integer not null check (cantidad > 0),
  nota             text,
  venta_directa    boolean not null default false
);

create index if not exists idx_restaurant_order_items_order
  on public.restaurant_order_items(order_id);
```

### 4.5 Numeración por jornada

No usar `max(numero) + 1` desde el cliente: dos meseros pueden crear a la vez.

```sql
create table if not exists public.restaurant_order_counters (
  business_id text not null references public.businesses(id) on delete cascade,
  jornada     date not null,
  last_number integer not null default 0,
  primary key (business_id, jornada)
);
```

La función `crear_pedido()` hace, dentro de una transacción:

```sql
insert into public.restaurant_order_counters (business_id, jornada, last_number)
values (p_business_id, p_jornada, 1)
on conflict (business_id, jornada)
do update set last_number = public.restaurant_order_counters.last_number + 1
returning last_number into v_numero;
```

La restricción `unique (business_id, jornada, numero)` es la red de seguridad final.

### 4.6 Eventos de pedido (auditoría)

```sql
create table if not exists public.restaurant_order_events (
  id          bigint generated always as identity primary key,
  order_id    text not null references public.restaurant_orders(id) on delete cascade,
  business_id text not null references public.businesses(id) on delete cascade,
  estado      text not null,
  actor_id    text references public.restaurant_staff(id),
  actor_nombre text not null default '',
  detalle     jsonb not null default '{}'::jsonb,
  creado_en   timestamptz not null default now()
);

create index if not exists idx_restaurant_order_events_order
  on public.restaurant_order_events(order_id, creado_en);
```

### 4.7 Venta al entregar

La venta actual vive en SQLite (`sales`, `sale_items`, `inventory_movements`).
Para la fase 2 hay dos opciones:

1. **Recomendada:** migrar también ventas e inventario a Postgres y registrar
   la venta en la misma transacción que marca el pedido como `entregado`.
2. **Transición:** mantener la venta en FastAPI/SQLite y llamar al backend desde
   la función de entrega. Es más frágil: si la venta se registra y la actualización
   del pedido falla, hay que reintentar con la misma clave de idempotencia.

En ambos casos se conserva:

```text
idempotency_key = 'restaurant-order-' || order_id
unique (business_id, idempotency_key)
```

---

## 5. RLS (Row Level Security)

### 5.1 Funciones auxiliares

```sql
create or replace function public.is_business_member(p_business_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.business_members m
    where m.business_id = p_business_id
      and m.user_id = auth.uid()
      and m.active
  );
$$;

create or replace function public.has_business_role(p_business_id text, variadic p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.business_members m
    where m.business_id = p_business_id
      and m.user_id = auth.uid()
      and m.active
      and m.role = any(p_roles)
  );
$$;

revoke all on function public.is_business_member(text) from public;
revoke all on function public.has_business_role(text, text[]) from public;
grant execute on function public.is_business_member(text) to authenticated;
grant execute on function public.has_business_role(text, text[]) to authenticated;
```

### 5.2 Políticas por tabla

```sql
alter table public.businesses             enable row level security;
alter table public.business_members       enable row level security;
alter table public.restaurant_staff       enable row level security;
alter table public.restaurant_settings    enable row level security;
alter table public.restaurant_table_names enable row level security;
alter table public.restaurant_tables      enable row level security;
alter table public.restaurant_orders      enable row level security;
alter table public.restaurant_order_items enable row level security;
alter table public.restaurant_order_events enable row level security;
alter table public.restaurant_order_counters enable row level security;

-- Lectura: cualquier miembro activo del negocio.
create policy "members read business"
  on public.businesses for select
  using (public.is_business_member(id));

create policy "members read staff"
  on public.restaurant_staff for select
  using (public.is_business_member(business_id));

create policy "members read settings"
  on public.restaurant_settings for select
  using (public.is_business_member(business_id));

create policy "members read tables"
  on public.restaurant_tables for select
  using (public.is_business_member(business_id));

create policy "members read orders"
  on public.restaurant_orders for select
  using (public.is_business_member(business_id));

create policy "members read order items"
  on public.restaurant_order_items for select
  using (exists (
    select 1 from public.restaurant_orders o
    where o.id = restaurant_order_items.order_id
      and public.is_business_member(o.business_id)
  ));

create policy "members read order events"
  on public.restaurant_order_events for select
  using (public.is_business_member(business_id));

-- Escritura de configuración: solo propietario/administrador.
create policy "admins manage staff"
  on public.restaurant_staff for all
  using (public.has_business_role(business_id, 'owner', 'business_admin'))
  with check (public.has_business_role(business_id, 'owner', 'business_admin'));

create policy "admins manage settings"
  on public.restaurant_settings for all
  using (public.has_business_role(business_id, 'owner', 'business_admin'))
  with check (public.has_business_role(business_id, 'owner', 'business_admin'));

create policy "admins manage tables"
  on public.restaurant_tables for all
  using (public.has_business_role(business_id, 'owner', 'business_admin'))
  with check (public.has_business_role(business_id, 'owner', 'business_admin'));
```

### 5.3 Pedidos: escritura solo por RPC

No se concede `insert`/`update` directo sobre pedidos e ítems. Se usan funciones
`security definer` con validación de estado y actor:

```sql
create or replace function public.tomar_pedido(p_order_id text)
returns public.restaurant_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.restaurant_orders;
  v_staff public.restaurant_staff;
begin
  select * into v_order
  from public.restaurant_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'PEDIDO_NO_ENCONTRADO';
  end if;

  if not public.is_business_member(v_order.business_id) then
    raise exception 'SIN_PERMISO';
  end if;

  select * into v_staff
  from public.restaurant_staff
  where business_id = v_order.business_id
    and auth_user_id = auth.uid()
    and active
  limit 1;

  if v_order.estado = 'en_preparacion' and v_order.tomado_por_id = v_staff.id then
    return v_order; -- idempotente
  end if;

  if v_order.estado <> 'pendiente' then
    raise exception 'CONFLICTO_ESTADO:%', v_order.estado;
  end if;

  update public.restaurant_orders
     set estado = 'en_preparacion',
         tomado_por_id = v_staff.id,
         tomado_por_nombre = v_staff.name,
         tomado_en = now(),
         actualizado_en = now(),
         version = version + 1
   where id = p_order_id
   returning * into v_order;

  insert into public.restaurant_order_events (order_id, business_id, estado, actor_id, actor_nombre)
  values (v_order.id, v_order.business_id, v_order.estado, v_staff.id, v_staff.name);

  return v_order;
end;
$$;
```

Funciones equivalentes:

| Función | Transición | Regla |
|---|---|---|
| `crear_pedido(p_business_id, p_items, ...)` | `-> pendiente` o `-> finalizado` | Solo productos del negocio; calcula totales en servidor; asigna número por jornada. |
| `tomar_pedido(p_order_id)` | `pendiente -> en_preparacion` | Una sola cocina gana; el resto recibe conflicto. |
| `finalizar_pedido(p_order_id)` | `en_preparacion -> finalizado` | Solo quien tomó o cualquier cocina, según se decida. |
| `entregar_pedido(p_order_id, p_venta_id)` | `finalizado -> entregado` | Idempotente; exige venta registrada. |
| `cancelar_pedido(p_order_id, p_motivo)` | `* -> cancelado` salvo `entregado` | Motivo obligatorio; registra actor. |

```sql
revoke all on function public.tomar_pedido(text) from public;
revoke all on function public.finalizar_pedido(text) from public;
revoke all on function public.entregar_pedido(text, text) from public;
revoke all on function public.cancelar_pedido(text, text) from public;

grant execute on function public.tomar_pedido(text) to authenticated;
grant execute on function public.finalizar_pedido(text) to authenticated;
grant execute on function public.entregar_pedido(text, text) to authenticated;
grant execute on function public.cancelar_pedido(text, text) to authenticated;
```

> Importante: `security definer` debe fijar `search_path` y validar el negocio
> del pedido contra `auth.uid()`. Sin esa validación, cualquier autenticado
> podría operar pedidos de otro negocio.

### 5.4 Realtime y RLS

```sql
alter publication supabase_realtime add table public.restaurant_orders;
alter publication supabase_realtime add table public.restaurant_order_items;
alter publication supabase_realtime add table public.restaurant_tables;
```

Supabase Realtime respeta las políticas `select` para Postgres Changes. Aun así,
el cliente debe filtrar por `business_id` y volver a validar en el servidor toda
transición; el filtro del canal es una optimización, no un control de seguridad.

### 5.5 Pruebas negativas obligatorias de RLS

1. Usuario del negocio A consulta pedidos del negocio B → 0 filas.
2. Usuario `waiter` intenta actualizar directamente `restaurant_orders` → error.
3. Usuario `waiter` intenta cancelar un pedido entregado → error.
4. Usuario `kitchen` intenta editar `restaurant_settings` → error.
5. Usuario anónimo (solo anon key, sin sesión) consulta pedidos → 0 filas.
6. Usuario `waiter` llama `tomar_pedido` sobre un pedido de otro negocio → `SIN_PERMISO`.

---

## 6. Tiempo real en el cliente

### 6.1 Contrato conservado

`PedidosRepository` no cambia. Se agrega una implementación remota:

```ts
// src/app/utils/restaurantSupabaseRepository.ts (futuro, no creado aún)
export class SupabasePedidosRepository implements PedidosRepository {
  listar(negocioId: string): Promise<Pedido[]>;
  suscribirse(negocioId: string, listener: (pedidos: Pedido[]) => void): () => void;
  crearPedido(input: CrearPedidoInput): Promise<Pedido>;
  tomarPedido(pedidoId: string, negocioId: string, empleado: EmpleadoRef): Promise<Pedido>;
  finalizarPedido(pedidoId: string, negocioId: string, empleado: EmpleadoRef): Promise<Pedido>;
  entregarPedido(pedidoId: string, negocioId: string, empleado: EmpleadoRef, ventaId?: string): Promise<Pedido>;
  cancelarPedido(pedidoId: string, negocioId: string, empleado: EmpleadoRef, motivo: string): Promise<Pedido>;
}
```

Selección por variable de entorno, sin cambiar las vistas:

```ts
export function getPedidosRepository(): PedidosRepository {
  if (import.meta.env.VITE_RESTAURANT_BACKEND === 'supabase') {
    return getSupabasePedidosRepository();
  }
  return getLocalPedidosRepository();
}
```

### 6.2 Suscripción

```ts
const channel = supabase
  .channel(`restaurant-${negocioId}`)
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'restaurant_orders',
      filter: `business_id=eq.${negocioId}`,
    },
    () => void refreshFromServer(),
  )
  .subscribe();
```

Recomendaciones:

- Agrupar eventos con un pequeño `debounce` (150–300 ms) y volver a leer el
  tablero completo; evita parches inconsistentes cuando llegan muchos cambios.
- Reconciliar siempre contra el servidor al recuperar foco o reconectar.
- No confiar en el orden de llegada de los eventos.
- Mostrar el estado de conexión (“En vivo” / “Reconectando”) en las tres vistas.

### 6.3 Conflictos

- `tomar_pedido` usa `select ... for update` y `estado = 'pendiente'` como
  condición. El segundo dispositivo recibe un error de conflicto y refresca.
- `crear_pedido` usa el contador transaccional y la restricción única.
- `entregar_pedido` es idempotente por `venta_id` e `idempotency_key`.
- Cada actualización incrementa `version`; si se implementa edición de ítems,
  se puede exigir `version` esperada (`optimistic concurrency`).

### 6.4 Offline

La fase 2 no necesita offline completo desde el día uno. Si se implementa:

1. Leer siempre del servidor cuando haya conexión.
2. Guardar en IndexedDB una cola de mutaciones pendientes con id de operación.
3. Al reconectar, reproducir la cola en orden.
4. Las operaciones deben ser idempotentes por ID de operación/pedido.
5. Si el pedido cambió de estado mientras estaba offline, mostrar conflicto y
   nunca sobrescribir silenciosamente.

---

## 7. Mapeo local → remoto

| Campo local (`Pedido`) | Columna remota |
|---|---|
| `id` | `restaurant_orders.id` |
| `negocioId` | `business_id` |
| `numero` | `numero` |
| `jornada` (`YYYY-MM-DD`) | `jornada` (`date`) |
| `estado` | `estado` |
| `canal` | `canal` |
| `mesaId` / `mesaNumero` / `mesaNombre` | `mesa_id` / `mesa_numero` / `mesa_nombre` |
| `meseroId` / `meseroNombre` | `mesero_id` / `mesero_nombre` |
| `items[]` | `restaurant_order_items` |
| `subtotal` / `impuesto` / `taxRate` / `total` | `subtotal` / `impuesto` / `tax_rate` / `total` |
| `nota` | `nota` |
| `creadoEn` / `actualizadoEn` | `creado_en` / `actualizado_en` |
| `tomadoPor*` / `tomadoEn` | `tomado_por_*` / `tomado_en` |
| `finalizadoPor*` / `finalizadoEn` | `finalizado_por_*` / `finalizado_en` |
| `entregadoPor*` / `entregadoEn` | `entregado_por_*` / `entregado_en` |
| `canceladoPor*` / `canceladoEn` / `motivoCancelacion` | `cancelado_por_*` / `cancelado_en` / `motivo_cancelacion` |
| `ventaId` / `ventaRegistradaEn` | `venta_id` / `venta_registrada_en` |
| `listoParaLlevar` | `listo_para_llevar` |
| `PedidoItem.id` | `restaurant_order_items.id` |
| `PedidoItem.productId` | `product_id` |
| `PedidoItem.nombre` | `nombre` |
| `PedidoItem.precioUnitario` | `precio_unitario` |
| `PedidoItem.cantidad` | `cantidad` |
| `PedidoItem.nota` | `nota` |
| `PedidoItem.ventaDirecta` | `venta_directa` |

Los totales se recalculan en el servidor con los precios vigentes del catálogo;
no se confía en los valores enviados por el cliente.

---

## 8. Variables de entorno

### Frontend (públicas, prefijo `VITE_`)

```env
# Selector de implementación: local | supabase
VITE_RESTAURANT_BACKEND=local

# Proyecto Supabase (la anon key es pública; la seguridad la da RLS)
VITE_SUPABASE_URL=https://<proyecto>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

### Solo backend / scripts (nunca en el bundle)

```env
SUPABASE_URL=https://<proyecto>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_DB_URL=postgresql://postgres:<password>@db.<proyecto>.supabase.co:5432/postgres
```

Reglas:

- Ninguna variable con `SERVICE_ROLE` debe llevar prefijo `VITE_`.
- `.env` y `.env.*` ya están ignorados por Git; mantener `.env.example` sin
  secretos reales.
- En producción, las claves se configuran en el proveedor de hosting, no en el
  repositorio.

---

## 9. Dependencia a instalar (cuando se apruebe)

**No instalada todavía.**

| Paquete | Dónde | Para qué |
|---|---|---|
| `@supabase/supabase-js@^2` | frontend | Cliente, Auth y Realtime. |
| `supabase` (CLI) | desarrollo | Migraciones, tipos generados y despliegue de funciones. |

Comando previsto (no ejecutar aún):

```bash
npm install @supabase/supabase-js
npm install -D supabase
```

Generación de tipos:

```bash
npx supabase gen types typescript --project-id <id> > src/app/services/supabaseTypes.ts
```

Alternativa Firebase (solo si se elige ese camino): `firebase@13.2.0`
(ver [`INTEGRACION_TIEMPO_REAL_FASE2_FIREBASE.md`](INTEGRACION_TIEMPO_REAL_FASE2_FIREBASE.md)).

---

## 10. Alternativa Firebase (resumen)

> Diseño completo, reglas, Cloud Functions, variables de entorno y plan de
> implementación en
> [`INTEGRACION_TIEMPO_REAL_FASE2_FIREBASE.md`](INTEGRACION_TIEMPO_REAL_FASE2_FIREBASE.md).

Si se elige Firebase, el equivalente sería:

```text
businesses/{businessId}
  orders/{orderId}
    items/{itemId}
  tables/{tableId}
  staff/{staffId}
  settings/main
  counters/{jornada}   // numero
```

- **Auth:** Firebase Authentication con custom claims `businessId` y `role`.
- **Reglas:** validar membresía y transiciones permitidas en
  `firestore.rules`; las operaciones de “tomar” y numerar requieren transacción
  de Firestore o Cloud Function.
- **Tiempo real:** `onSnapshot` sobre la colección de pedidos.
- **Presencia:** Realtime Database.
- **Venta e inventario:** Cloud Function transaccional; no se puede garantizar
  atomicidad entre Firestore y el backend actual sin idempotencia.
- **Costo/complejidad:** reglas duplicadas, menos joins y migración del modelo
  relacional. Por eso se recomienda Supabase.

---

## 11. Plan de implementación

| Fase | Entregable | Sin tocar producción |
|---|---|---|
| F2.0 | Este documento y decisiones aprobadas | Sí |
| F2.1 | Proyecto Supabase de desarrollo, esquema, RLS y datos de prueba | Sí |
| F2.2 | `SupabasePedidosRepository` + feature flag `VITE_RESTAURANT_BACKEND` | Sí, por bandera |
| F2.3 | Mesas, personal y ajustes remotos; migración de datos locales | Sí |
| F2.4 | Venta e inventario atómicos al entregar; auditoría de eventos | Sí |
| F2.5 | Offline con cola idempotente (opcional) | Sí |
| F2.6 | Pruebas multidispositivo y corte | Aprobación explícita |

### Migración de datos existentes

- Exportar pedidos locales por negocio y validar con `normalizeOrders`.
- Insertar pedidos históricos respetando `(business_id, jornada, numero)`.
- Recalcular el contador por jornada al máximo histórico.
- No migrar pedidos de demostración a producción sin autorización.

---

## 12. Matriz de aceptación

| Caso | Resultado esperado |
|---|---|
| Mesero crea pedido en el celular | Cocina lo ve en menos de 2 s. |
| Dos cocineros tocan “Tomar” a la vez | Solo uno gana; el otro ve “Ya lo tomó …” y el tablero se refresca. |
| Cocina finaliza | Administración y mesero ven “Listo” sin recargar. |
| Administración entrega | Se registra una sola venta; stock baja una sola vez. |
| Reintento de entrega por fallo de red | No duplica la venta (`idempotency_key`). |
| 20 pedidos simultáneos | Números únicos y consecutivos por jornada. |
| Usuario de otro negocio | No ve ni modifica pedidos ajenos (RLS). |
| Mesero intenta cancelar un pedido entregado | Error controlado. |
| Se cae la red y vuelve | El tablero se reconcilia; no quedan pedidos fantasma. |
| Cambio de jornada a las 06:00 | La numeración reinicia en 1. |

---

## 13. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| RLS mal configurada filtra datos entre negocios | Pruebas negativas automatizadas y revisión de políticas antes del corte. |
| Uso de `service_role` en el frontend | Prohibido por revisión de build; solo variables `VITE_` públicas. |
| Condiciones de carrera al tomar/numerar | RPC transaccional + `for update` + restricciones únicas. |
| Divergencia entre local y remoto | Una sola fuente de verdad; local solo como caché/offline. |
| Reloj del dispositivo alterado | `jornada` y timestamps calculados en el servidor (zona `America/Bogota`). |
| PIN operativo en texto plano (fase 1) | Guardar `pin_hash` y validar en el servidor. |
| Límites del plan gratuito | Medir conexiones y eventos; plan de pago antes de producción. |
| Dependencia de un proveedor | El contrato `PedidosRepository` permite cambiar de implementación. |

---

## 14. Decisiones que faltan aprobar

1. **Proveedor:** Supabase (recomendado en este documento) o Firebase
   ([diseño detallado](INTEGRACION_TIEMPO_REAL_FASE2_FIREBASE.md)).
2. **Identidad:** Supabase Auth (recomendado) o JWT propio sobre el login actual.
3. **Alcance remoto:** solo pedidos, o también mesas, personal, ajustes y catálogo.
4. **Ventas/inventario:** migrar a Postgres o mantener FastAPI/SQLite durante la transición.
5. **Offline:** obligatorio desde el inicio o fase posterior.
6. **Permisos:** ¿cualquier cocinero puede finalizar un pedido tomado por otro? ¿el mesero puede entregar pedidos de otro mesero?

Con estas decisiones se puede pasar a F2.1 sin instalar nada todavía.
