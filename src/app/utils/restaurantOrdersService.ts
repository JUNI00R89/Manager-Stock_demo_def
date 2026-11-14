import { dataService, type SaleRecord } from '../services/dataService';
import type { EmpleadoRef, Pedido, PedidosRepository } from './restaurantTypes';

/**
 * Registra la venta real del pedido y recién entonces lo marca como entregado.
 *
 * dataService.createSale es el equivalente actual de registerSale(): descuenta
 * stock, guarda el detalle y es idempotente por pedido. Si la venta falla, el
 * pedido permanece en "Listo" para reintentar sin perder el trabajo de cocina.
 */
export async function deliverRestaurantOrder(
  repository: PedidosRepository,
  order: Pedido,
  employee: EmpleadoRef,
): Promise<{ order: Pedido; sale: SaleRecord | null }> {
  if (order.estado === 'entregado') return { order, sale: null };
  if (order.estado !== 'finalizado') {
    throw new Error('El pedido debe estar listo antes de entregarlo.');
  }
  if (!order.items.length) throw new Error('El pedido no tiene productos para registrar la venta.');

  let sale: SaleRecord | null = null;
  let saleId = order.ventaId;
  if (!saleId) {
    let cashSessionId: string | null = null;
    try {
      const session = await dataService.getCurrentCashSession();
      cashSessionId = session?.status === 'open' ? session.id : null;
    } catch {
      // La caja es opcional para propietarios y administradores.
    }
    sale = await dataService.createSale({
      orderIds: order.source === 'shared' ? [order.id] : undefined,
      items:
        order.source === 'shared'
          ? []
          : order.items.map(item => ({
              productId: item.productId,
              quantity: item.cantidad,
            })),
      customer: `${order.mesaNombre} · Pedido #${order.numero}`,
      paymentMethod: 'cash',
      taxRate: order.taxRate,
      status: 'completed',
      idempotencyKey: `restaurant-order-${order.id}`,
      cashSessionId,
    });
    saleId = sale.id;
  }

  const updated = await repository.entregarPedido(order.id, order.negocioId, employee, saleId);
  return { order: updated, sale };
}
