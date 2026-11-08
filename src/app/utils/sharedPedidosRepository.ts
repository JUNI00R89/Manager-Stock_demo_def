import { dataService, getBusinessConfig, type OrderRecord } from '../services/dataService';
import { getJornadaKey } from './restaurantFormat';
import type { CrearPedidoInput, EmpleadoRef, Pedido, PedidoEstado, PedidosRepository } from './restaurantTypes';

const states: Record<OrderRecord['status'], PedidoEstado> = {
  received: 'pendiente', preparing: 'en_preparacion', ready: 'finalizado', delivered: 'entregado', cancelled: 'cancelado',
};

/** Common order store for tables, waiters and kitchen. Legacy browser orders
 * remain accessible in their original store until they are completed. */
export class SharedPedidosRepository implements PedidosRepository {
  constructor(private legacy: PedidosRepository) {}

  async listar(scope: string): Promise<Pedido[]> {
    const [rows, old, tables, config] = await Promise.all([
      dataService.getOrders(), this.legacy.listar(scope), dataService.getTables(),
      getBusinessConfig<{ taxRate: number }>(),
    ]);
    const taxRate = config?.taxRate ?? 0;
    const shared = rows.map((row): Pedido => {
      const meta = row.restaurantMetadata || {};
      const table = tables.find(t => t.number === row.tableNumber);
      const items = row.items.map((item, index) => ({
        id: `${row.id}-${index}`, productId: item.productId, nombre: item.productName,
        cantidad: item.quantity, precioUnitario: item.unitPrice, nota: item.notes,
        ventaDirecta: (meta.directProductIds || []).includes(item.productId),
      }));
      const impuesto = Math.round(row.total * taxRate * 100) / 100;
      return {
        ...meta, source: 'shared', id: row.id, negocioId: scope,
        numero: meta.numero || parseInt(row.id.slice(-6), 16) || 1,
        jornada: meta.jornada || getJornadaKey(new Date(row.created_at), '06:00'),
        estado: states[row.status], canal: 'local', mesaId: table?.id || meta.mesaId || '',
        mesaNumero: row.tableNumber || 0, mesaNombre: row.tableNumber ? `Mesa ${row.tableNumber}` : row.customer,
        meseroId: meta.meseroId || '', meseroNombre: row.waiter || '',
        items, subtotal: row.total, impuesto, taxRate, total: row.total + impuesto,
        nota: row.notes, creadoEn: row.created_at, actualizadoEn: row.created_at,
        ventaId: row.saleId, listoParaLlevar: items.every(item => item.ventaDirecta),
      };
    });
    const ids = new Set(shared.map(order => order.id));
    return [...shared, ...old.filter(order => !ids.has(order.id))];
  }

  suscribirse(scope: string, listener: (orders: Pedido[]) => void, onError?: (error: unknown) => void) {
    let active = true;
    let busy = false;
    const refresh = async () => {
      if (busy || !active) return;
      busy = true;
      try { const orders = await this.listar(scope); if (active) listener(orders); }
      catch (error) { if (active) onError?.(error); }
      finally { busy = false; }
    };
    const unsub = this.legacy.suscribirse(scope, () => { void refresh(); });
    const timer = window.setInterval(refresh, 2000);
    window.addEventListener('focus', refresh);
    void refresh();
    return () => { active = false; clearInterval(timer); unsub(); window.removeEventListener('focus', refresh); };
  }

  private async find(id: string, scope: string) {
    const order = (await this.listar(scope)).find(row => row.id === id);
    if (!order) throw new Error('Pedido no encontrado.');
    return order;
  }

  async crearPedido(input: CrearPedidoInput) {
    const row = await dataService.createOrder({
      channel: 'table', tableNumber: input.mesaNumero, tableId: input.mesaId,
      customer: input.mesaNombre, waiter: input.mesero.nombre, notes: input.nota,
      items: input.items.map(item => ({ productId: item.productId, quantity: item.cantidad, notes: item.nota })),
      restaurantMetadata: { mesaId: input.mesaId, meseroId: input.mesero.id,
        jornada: getJornadaKey(new Date(), input.horaInicioJornada),
        directProductIds: input.items.filter(item => item.ventaDirecta).map(item => item.productId) },
    });
    if (row.status === 'received' && input.items.every(item => item.ventaDirecta)) {
      await dataService.updateOrderStatus(row.id, 'ready', { expectedStatus: 'received', actorId: input.mesero.id, actorName: input.mesero.nombre });
    }
    return this.find(row.id, input.negocioId);
  }

  async tomarPedido(id: string, scope: string, employee: EmpleadoRef) {
    const order = await this.find(id, scope);
    if (order.source !== 'shared') return this.legacy.tomarPedido(id, scope, employee);
    if (order.estado === 'en_preparacion' && order.tomadoPorId === employee.id) return order;
    await dataService.updateOrderStatus(id, 'preparing', { expectedStatus: 'received', actorId: employee.id, actorName: employee.nombre });
    return this.find(id, scope);
  }

  async finalizarPedido(id: string, scope: string, employee: EmpleadoRef) {
    const order = await this.find(id, scope);
    if (order.source !== 'shared') return this.legacy.finalizarPedido(id, scope, employee);
    if (order.estado === 'finalizado') return order;
    await dataService.updateOrderStatus(id, 'ready', { expectedStatus: 'preparing', actorId: employee.id, actorName: employee.nombre });
    return this.find(id, scope);
  }

  async entregarPedido(id: string, scope: string, employee: EmpleadoRef, saleId?: string) {
    const order = await this.find(id, scope);
    if (order.source !== 'shared') return this.legacy.entregarPedido(id, scope, employee, saleId);
    // Shared checkout closes the order in the sale transaction.
    if (order.estado !== 'entregado' || !order.ventaId || order.ventaId !== saleId) throw new Error('El pedido debe cobrarse antes de entregarlo.');
    return order;
  }

  async cancelarPedido(id: string, scope: string, employee: EmpleadoRef, reason: string) {
    const order = await this.find(id, scope);
    if (order.source !== 'shared') return this.legacy.cancelarPedido(id, scope, employee, reason);
    if (!reason.trim()) throw new Error('Escribe el motivo de cancelación.');
    if (order.estado === 'cancelado') return order;
    if (order.estado === 'entregado') throw new Error('El pedido ya fue entregado.');
    const status = Object.entries(states).find(([, state]) => state === order.estado)![0];
    await dataService.updateOrderStatus(id, 'cancelled', { expectedStatus: status, actorId: employee.id, actorName: employee.nombre, reason });
    return this.find(id, scope);
  }
}
