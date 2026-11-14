import { collection, doc, getDoc, getDocs, onSnapshot, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { CrearPedidoInput, EmpleadoRef, Pedido, PedidoEstado, PedidosRepository } from './restaurantTypes';
import { PedidoConflictoError } from './restaurantTypes';
import { firebaseDb, firebaseFunctions, ensureFirebaseSignedIn } from './firebaseClient';

function timestampToString(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  const candidate = value as { toDate?: () => Date };
  if (typeof candidate.toDate === 'function') {
    return candidate.toDate().toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  return '';
}

function docToPedido(snap: { id: string; data: () => Record<string, unknown> | undefined }, negocioId: string): Pedido {
  const d = (snap.data() || {}) as Record<string, unknown>;
  const items = Array.isArray(d.items)
    ? d.items.map((item: unknown) => {
        const entry = (item || {}) as Record<string, unknown>;
        return {
          id: String(entry.id || ''),
          productId: String(entry.productId || ''),
          nombre: String(entry.nombre || ''),
          precioUnitario: Number(entry.precioUnitario || 0),
          cantidad: Number(entry.cantidad || 0),
          nota: entry.nota ? String(entry.nota) : undefined,
          ventaDirecta: Boolean(entry.ventaDirecta),
        };
      })
    : [];

  return {
    id: snap.id,
    negocioId,
    numero: Number(d.numero || 0),
    jornada: String(d.jornada || ''),
    estado: (d.estado || 'pendiente') as PedidoEstado,
    canal: 'local',
    mesaId: String(d.mesaId || ''),
    mesaNumero: Number(d.mesaNumero || 0),
    mesaNombre: String(d.mesaNombre || ''),
    meseroId: String(d.meseroId || ''),
    meseroNombre: String(d.meseroNombre || ''),
    items,
    subtotal: Number(d.subtotal || 0),
    impuesto: Number(d.impuesto || 0),
    taxRate: Number(d.taxRate || 0),
    total: Number(d.total || 0),
    nota: d.nota ? String(d.nota) : undefined,
    creadoEn: timestampToString(d.creadoEn),
    actualizadoEn: timestampToString(d.actualizadoEn),
    tomadoPorId: d.tomadoPorId ? String(d.tomadoPorId) : undefined,
    tomadoPorNombre: d.tomadoPorNombre ? String(d.tomadoPorNombre) : undefined,
    tomadoEn: timestampToString(d.tomadoEn) || undefined,
    finalizadoPorId: d.finalizadoPorId ? String(d.finalizadoPorId) : undefined,
    finalizadoPorNombre: d.finalizadoPorNombre ? String(d.finalizadoPorNombre) : undefined,
    finalizadoEn: timestampToString(d.finalizadoEn) || undefined,
    entregadoPorId: d.entregadoPorId ? String(d.entregadoPorId) : undefined,
    entregadoPorNombre: d.entregadoPorNombre ? String(d.entregadoPorNombre) : undefined,
    entregadoEn: timestampToString(d.entregadoEn) || undefined,
    canceladoPorId: d.canceladoPorId ? String(d.canceladoPorId) : undefined,
    canceladoPorNombre: d.canceladoPorNombre ? String(d.canceladoPorNombre) : undefined,
    canceladoEn: timestampToString(d.canceladoEn) || undefined,
    motivoCancelacion: d.motivoCancelacion ? String(d.motivoCancelacion) : undefined,
    ventaId: d.ventaId ? String(d.ventaId) : undefined,
    ventaRegistradaEn: timestampToString(d.ventaRegistradaEn) || undefined,
    listoParaLlevar: Boolean(d.listoParaLlevar),
  };
}

class FirebasePedidosRepository implements PedidosRepository {
  private async fetchOrder(negocioId: string, orderId: string): Promise<Pedido> {
    const snap = await getDoc(doc(firebaseDb, `businesses/${negocioId}/orders/${orderId}`));
    if (!snap.exists()) throw new Error('No se encontró el pedido.');
    return docToPedido(snap as never, negocioId);
  }

  async listar(negocioId: string): Promise<Pedido[]> {
    await ensureFirebaseSignedIn();
    const q = query(collection(firebaseDb, `businesses/${negocioId}/orders`), orderBy('creadoEn', 'asc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => docToPedido(d as never, negocioId));
  }

  suscribirse(negocioId: string, listener: (pedidos: Pedido[]) => void): () => void {
    let active = true;
    let unsubscribe: () => void = () => {};
    ensureFirebaseSignedIn()
      .then(() => {
        if (!active) return;
        const q = query(collection(firebaseDb, `businesses/${negocioId}/orders`), orderBy('creadoEn', 'asc'));
        const unsub = onSnapshot(
          q,
          snap => {
            if (!active) return;
            listener(snap.docs.map(d => docToPedido(d as never, negocioId)));
          },
          error => console.error('[firebase] orders listener', error),
        );
        unsubscribe = unsub;
      })
      .catch(error => console.error('[firebase] sign-in', error));
    return () => {
      active = false;
      unsubscribe();
    };
  }

  async crearPedido(input: CrearPedidoInput): Promise<Pedido> {
    await ensureFirebaseSignedIn();
    const fn = httpsCallable(firebaseFunctions, 'crearPedido');
    try {
      const res = await fn({
        businessId: input.negocioId,
        mesaId: input.mesaId,
        meseroId: input.mesero.id,
        items: input.items.map((item, index) => ({
          id: `item-${index + 1}`,
          productId: item.productId,
          cantidad: item.cantidad,
          nota: item.nota,
        })),
        nota: input.nota,
      });
      const data = res.data as { id: string };
      return this.fetchOrder(input.negocioId, data.id);
    } catch (error: unknown) {
      const message = (error as { message?: string })?.message || 'No se pudo crear el pedido.';
      throw new Error(message);
    }
  }

  async tomarPedido(pedidoId: string, negocioId: string, empleado: EmpleadoRef): Promise<Pedido> {
    await ensureFirebaseSignedIn();
    const fn = httpsCallable(firebaseFunctions, 'tomarPedido');
    try {
      await fn({ businessId: negocioId, orderId: pedidoId, staffId: empleado.id });
      return this.fetchOrder(negocioId, pedidoId);
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === 'functions/failed-precondition') {
        const pedido = await this.fetchOrder(negocioId, pedidoId).catch(() => null);
        if (pedido) throw new PedidoConflictoError((error as Error).message, pedido);
      }
      throw new Error((error as { message?: string })?.message || 'No se pudo tomar el pedido.');
    }
  }

  async finalizarPedido(pedidoId: string, negocioId: string, empleado: EmpleadoRef): Promise<Pedido> {
    await ensureFirebaseSignedIn();
    const fn = httpsCallable(firebaseFunctions, 'finalizarPedido');
    try {
      await fn({ businessId: negocioId, orderId: pedidoId, staffId: empleado.id });
      return this.fetchOrder(negocioId, pedidoId);
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === 'functions/failed-precondition') {
        const pedido = await this.fetchOrder(negocioId, pedidoId).catch(() => null);
        if (pedido) throw new PedidoConflictoError((error as Error).message, pedido);
      }
      throw new Error((error as { message?: string })?.message || 'No se pudo finalizar el pedido.');
    }
  }

  async entregarPedido(pedidoId: string, negocioId: string, empleado: EmpleadoRef, ventaId?: string): Promise<Pedido> {
    await ensureFirebaseSignedIn();
    const fn = httpsCallable(firebaseFunctions, 'entregarPedido');
    try {
      await fn({ businessId: negocioId, orderId: pedidoId, staffId: empleado.id, ventaId });
      return this.fetchOrder(negocioId, pedidoId);
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === 'functions/failed-precondition') {
        const pedido = await this.fetchOrder(negocioId, pedidoId).catch(() => null);
        if (pedido) throw new PedidoConflictoError((error as Error).message, pedido);
      }
      throw new Error((error as { message?: string })?.message || 'No se pudo entregar el pedido.');
    }
  }

  async cancelarPedido(pedidoId: string, negocioId: string, empleado: EmpleadoRef, motivo: string): Promise<Pedido> {
    await ensureFirebaseSignedIn();
    const fn = httpsCallable(firebaseFunctions, 'cancelarPedido');
    try {
      await fn({ businessId: negocioId, orderId: pedidoId, staffId: empleado.id, motivo });
      return this.fetchOrder(negocioId, pedidoId);
    } catch (error: unknown) {
      throw new Error((error as { message?: string })?.message || 'No se pudo cancelar el pedido.');
    }
  }
}

let firebaseRepository: PedidosRepository | null = null;

export function getFirebasePedidosRepository(): PedidosRepository {
  if (!firebaseRepository) firebaseRepository = new FirebasePedidosRepository();
  return firebaseRepository;
}
