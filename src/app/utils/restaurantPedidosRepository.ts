import {
  PedidoConflictoError,
  type CrearPedidoInput,
  type EmpleadoRef,
  type Pedido,
  type PedidoEstado,
  type PedidosRepository,
} from './restaurantTypes';
import { createScopedLocalStore, uniqueRestaurantId } from './restaurantStorage';
import { getJornadaKey } from './restaurantFormat';

export const PEDIDO_ESTADO_LABELS: Record<PedidoEstado, string> = {
  pendiente: 'Pendiente',
  en_preparacion: 'En preparación',
  finalizado: 'Listo',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

const ORDERS_PREFIX = 'manager_stock_restaurant_pedidos_v1_';
const CHANNEL_NAME = 'manager-stock-restaurant-pedidos';
const VALID_STATES: PedidoEstado[] = ['pendiente', 'en_preparacion', 'finalizado', 'entregado', 'cancelado'];

function normalizeOrders(value: unknown): Pedido[] {
  if (!Array.isArray(value)) return [];
  const result: Pedido[] = [];
  value.forEach((candidate) => {
    if (!candidate || typeof candidate !== 'object') return;
    const order = candidate as Partial<Pedido>;
    if (!order.id || !order.negocioId || !VALID_STATES.includes(order.estado as PedidoEstado)) return;
    if (!Array.isArray(order.items)) return;
    const items = order.items.filter((item) => item && item.productId && item.nombre).map((item) => ({
      ...item,
      id: item.id || uniqueRestaurantId('item'),
      cantidad: Math.max(1, Number(item.cantidad) || 1),
      precioUnitario: Number(item.precioUnitario) || 0,
      ventaDirecta: item.ventaDirecta === true,
    }));
    const subtotal = Number(order.subtotal) || items.reduce((sum, item) => sum + item.precioUnitario * item.cantidad, 0);
    const taxRate = Number.isFinite(Number(order.taxRate)) ? Math.max(0, Number(order.taxRate)) : 0;
    const impuesto = Number.isFinite(Number(order.impuesto)) ? Number(order.impuesto) : Math.round(subtotal * taxRate);
    result.push({
      ...order,
      id: order.id,
      negocioId: order.negocioId,
      jornada: order.jornada || getJornadaKey(new Date(order.creadoEn || Date.now()), '06:00'),
      mesaId: order.mesaId || '',
      mesaNumero: Number(order.mesaNumero) || 0,
      mesaNombre: order.mesaNombre || 'Mesa',
      meseroId: order.meseroId || '',
      meseroNombre: order.meseroNombre || '',
      numero: Number(order.numero) || 1,
      estado: order.estado as PedidoEstado,
      canal: 'local',
      items,
      subtotal,
      impuesto,
      taxRate,
      total: Number(order.total) || subtotal + impuesto,
      creadoEn: order.creadoEn || new Date().toISOString(),
      actualizadoEn: order.actualizadoEn || order.creadoEn || new Date().toISOString(),
      listoParaLlevar: order.listoParaLlevar === true,
    });
  });
  return result;
}

const ordersStore = createScopedLocalStore<Pedido[]>(
  ORDERS_PREFIX,
  () => [],
  normalizeOrders,
);

type Listener = (orders: Pedido[]) => void;
const subscribers = new Map<string, Set<Listener>>();
let realtimeInitialized = false;
let channel: BroadcastChannel | null = null;

function sortedOrders(scope: string): Pedido[] {
  return ordersStore.get(scope).slice().sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
}

function emit(scope: string) {
  const rows = sortedOrders(scope);
  subscribers.get(scope)?.forEach((listener) => {
    try {
      listener(rows);
    } catch {
      // La vista que falla no debe interrumpir la sincronización.
    }
  });
}

function initializeRealtime() {
  if (realtimeInitialized || typeof window === 'undefined') return;
  realtimeInitialized = true;

  window.addEventListener('storage', (event) => {
    if (!event.key || !event.key.startsWith(ORDERS_PREFIX)) return;
    const scopes = new Set(subscribers.keys());
    scopes.forEach((scope) => {
      if (ordersStore.key(scope) === event.key) emit(scope);
    });
  });

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event) => {
        const scope = event.data?.scope;
        if (typeof scope === 'string') emit(scope);
      };
    } catch {
      channel = null;
    }
  }
}

function broadcast(scope: string) {
  try {
    channel?.postMessage({ scope, at: Date.now() });
  } catch {
    // storage event sigue cubriendo la sincronización si BroadcastChannel falla.
  }
}

function notifyChange(scope: string) {
  emit(scope);
  broadcast(scope);
}

function estadoConflicto(pedido: Pedido): string {
  if (pedido.estado === 'en_preparacion' && pedido.tomadoPorNombre) {
    return `Ya lo tomó ${pedido.tomadoPorNombre}.`;
  }
  if (pedido.estado === 'finalizado') return 'El pedido ya está listo para llevar.';
  if (pedido.estado === 'entregado') return 'El pedido ya fue entregado.';
  if (pedido.estado === 'cancelado') return 'El pedido fue cancelado.';
  return 'El pedido ya no está disponible.';
}

function withStatusError(pedido: Pedido, expected: PedidoEstado): never {
  const message = pedido.estado === expected
    ? 'El pedido ya se encuentra en ese estado.'
    : estadoConflicto(pedido);
  throw new PedidoConflictoError(message, pedido);
}

const localLockWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function withLocalStorageLock<T>(scope: string, action: () => Promise<T> | T): Promise<T> {
  const lockKey = `${ORDERS_PREFIX}lock_${scope}`;
  const token = uniqueRestaurantId('lock');
  const deadline = Date.now() + 4_000;
  let acquired = false;
  while (Date.now() < deadline) {
    try {
      const raw = window.localStorage.getItem(lockKey);
      if (raw) {
        const holder = JSON.parse(raw) as { token?: string; expires?: number };
        if (holder.expires && holder.expires > Date.now()) {
          await localLockWait(25);
          continue;
        }
      }
      window.localStorage.setItem(lockKey, JSON.stringify({ token, expires: Date.now() + 2_000 }));
      const stored = window.localStorage.getItem(lockKey);
      if (stored && (JSON.parse(stored) as { token?: string }).token === token) {
        acquired = true;
        break;
      }
    } catch {
      // Si localStorage no está disponible, la pestaña actual sigue serializando
      // sus propias operaciones con el candado en memoria.
      acquired = true;
      break;
    }
    await localLockWait(25);
  }
  if (!acquired) throw new Error('No se pudo sincronizar el pedido. Inténtalo de nuevo.');
  try {
    return await action();
  } finally {
    try {
      const stored = window.localStorage.getItem(lockKey);
      if (stored && (JSON.parse(stored) as { token?: string }).token === token) {
        window.localStorage.removeItem(lockKey);
      }
    } catch {
      // El candado expira solo.
    }
  }
}

async function withOrdersLock<T>(scope: string, action: () => Promise<T> | T): Promise<T> {
  const lockManager = typeof navigator !== 'undefined'
    ? (navigator as unknown as { locks?: { request: <R>(name: string, callback: () => Promise<R> | R) => Promise<R> } }).locks
    : undefined;
  if (lockManager?.request) {
    return lockManager.request(`manager-stock-restaurant-${scope}`, action);
  }
  return withLocalStorageLock(scope, action);
}

function writeOrders(scope: string, orders: Pedido[]) {
  ordersStore.set(scope, orders);
  notifyChange(scope);
}

class LocalPedidosRepository implements PedidosRepository {
  async listar(negocioId: string): Promise<Pedido[]> {
    initializeRealtime();
    return sortedOrders(negocioId);
  }

  suscribirse(negocioId: string, listener: Listener): () => void {
    initializeRealtime();
    let set = subscribers.get(negocioId);
    if (!set) {
      set = new Set();
      subscribers.set(negocioId, set);
    }
    set.add(listener);
    queueMicrotask(() => {
      if (set?.has(listener)) listener(sortedOrders(negocioId));
    });
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) subscribers.delete(negocioId);
    };
  }

  async crearPedido(input: CrearPedidoInput): Promise<Pedido> {
    if (!input.items.length) throw new Error('Agrega al menos un producto al pedido.');
    const cleanedItems = input.items
      .filter((item) => item.productId && item.nombre && Number(item.cantidad) > 0)
      .map((item) => ({
        id: uniqueRestaurantId('item'),
        productId: item.productId,
        nombre: item.nombre.trim(),
        precioUnitario: Math.max(0, Number(item.precioUnitario) || 0),
        cantidad: Math.max(1, Math.round(Number(item.cantidad) || 1)),
        nota: item.nota?.trim() || undefined,
        ventaDirecta: item.ventaDirecta === true,
      }));
    if (!cleanedItems.length) throw new Error('Agrega al menos un producto al pedido.');

    return withOrdersLock(input.negocioId, () => {
      const orders = ordersStore.get(input.negocioId);
      const now = new Date();
      const jornada = getJornadaKey(now, input.horaInicioJornada);
      const numero = orders
        .filter((order) => order.jornada === jornada)
        .reduce((max, order) => Math.max(max, order.numero), 0) + 1;
      const directOnly = cleanedItems.every((item) => item.ventaDirecta);
      const subtotal = cleanedItems.reduce((sum, item) => sum + item.precioUnitario * item.cantidad, 0);
      const taxRate = Math.max(0, Math.min(1, Number(input.taxRate) || 0));
      const impuesto = Math.round(subtotal * taxRate);
      const total = subtotal + impuesto;
      const timestamp = now.toISOString();
      const order: Pedido = {
        id: uniqueRestaurantId('PED'),
        negocioId: input.negocioId,
        numero,
        jornada,
        estado: directOnly ? 'finalizado' : 'pendiente',
        canal: 'local',
        mesaId: input.mesaId,
        mesaNumero: input.mesaNumero,
        mesaNombre: input.mesaNombre,
        meseroId: input.mesero.id,
        meseroNombre: input.mesero.nombre,
        items: cleanedItems,
        subtotal,
        impuesto,
        taxRate,
        total,
        nota: input.nota?.trim() || undefined,
        creadoEn: timestamp,
        actualizadoEn: timestamp,
        listoParaLlevar: directOnly,
        ...(directOnly ? {
          finalizadoEn: timestamp,
          finalizadoPorId: 'venta-directa',
          finalizadoPorNombre: 'Venta directa',
        } : {}),
      };
      writeOrders(input.negocioId, [...orders, order]);
      return order;
    });
  }

  async tomarPedido(pedidoId: string, negocioId: string, empleado: EmpleadoRef): Promise<Pedido> {
    return withOrdersLock(negocioId, () => {
      const orders = ordersStore.get(negocioId);
      const current = orders.find((order) => order.id === pedidoId);
      if (!current) throw new Error('No se encontró el pedido.');
      if (current.estado === 'en_preparacion' && current.tomadoPorId === empleado.id) return current;
      if (current.estado !== 'pendiente') {
        throw new PedidoConflictoError(estadoConflicto(current), current);
      }
      const now = new Date().toISOString();
      const updated: Pedido = {
        ...current,
        estado: 'en_preparacion',
        tomadoPorId: empleado.id,
        tomadoPorNombre: empleado.nombre,
        tomadoEn: now,
        actualizadoEn: now,
      };
      writeOrders(negocioId, orders.map((order) => order.id === pedidoId ? updated : order));
      return updated;
    });
  }

  async finalizarPedido(pedidoId: string, negocioId: string, empleado: EmpleadoRef): Promise<Pedido> {
    return withOrdersLock(negocioId, () => {
      const orders = ordersStore.get(negocioId);
      const current = orders.find((order) => order.id === pedidoId);
      if (!current) throw new Error('No se encontró el pedido.');
      if (current.estado === 'finalizado') return current;
      if (current.estado !== 'en_preparacion') withStatusError(current, 'en_preparacion');
      const now = new Date().toISOString();
      const updated: Pedido = {
        ...current,
        estado: 'finalizado',
        finalizadoPorId: empleado.id,
        finalizadoPorNombre: empleado.nombre,
        finalizadoEn: now,
        actualizadoEn: now,
      };
      writeOrders(negocioId, orders.map((order) => order.id === pedidoId ? updated : order));
      return updated;
    });
  }

  async entregarPedido(pedidoId: string, negocioId: string, empleado: EmpleadoRef, ventaId?: string): Promise<Pedido> {
    return withOrdersLock(negocioId, () => {
      const orders = ordersStore.get(negocioId);
      const current = orders.find((order) => order.id === pedidoId);
      if (!current) throw new Error('No se encontró el pedido.');
      if (current.estado === 'entregado') return current;
      if (current.estado !== 'finalizado') withStatusError(current, 'finalizado');
      const now = new Date().toISOString();
      const updated: Pedido = {
        ...current,
        estado: 'entregado',
        entregadoPorId: empleado.id,
        entregadoPorNombre: empleado.nombre,
        entregadoEn: now,
        actualizadoEn: now,
        ventaId: ventaId || current.ventaId,
        ventaRegistradaEn: ventaId ? now : current.ventaRegistradaEn,
      };
      writeOrders(negocioId, orders.map((order) => order.id === pedidoId ? updated : order));
      return updated;
    });
  }

  async cancelarPedido(pedidoId: string, negocioId: string, empleado: EmpleadoRef, motivo: string): Promise<Pedido> {
    const cleanReason = motivo.trim();
    if (!cleanReason) throw new Error('Escribe el motivo de la cancelación.');
    return withOrdersLock(negocioId, () => {
      const orders = ordersStore.get(negocioId);
      const current = orders.find((order) => order.id === pedidoId);
      if (!current) throw new Error('No se encontró el pedido.');
      if (current.estado === 'cancelado') return current;
      if (current.estado === 'entregado') throw new Error('Un pedido entregado no se puede cancelar.');
      const now = new Date().toISOString();
      const updated: Pedido = {
        ...current,
        estado: 'cancelado',
        canceladoPorId: empleado.id,
        canceladoPorNombre: empleado.nombre,
        canceladoEn: now,
        motivoCancelacion: cleanReason,
        actualizadoEn: now,
      };
      writeOrders(negocioId, orders.map((order) => order.id === pedidoId ? updated : order));
      return updated;
    });
  }
}

import { SharedPedidosRepository } from './sharedPedidosRepository';
import { getFirebasePedidosRepository } from './firebasePedidosRepository';

let repository: PedidosRepository | null = null;

export function getPedidosRepository(): PedidosRepository {
  if (import.meta.env.VITE_RESTAURANT_BACKEND === 'firebase') {
    return getFirebasePedidosRepository();
  }
  if (!repository) repository = new SharedPedidosRepository(new LocalPedidosRepository());
  return repository;
}

export function isKitchenOrder(order: Pedido): boolean {
  return order.items.some((item) => !item.ventaDirecta);
}

export function kitchenItems(order: Pedido) {
  return order.items.filter((item) => !item.ventaDirecta);
}
