import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pedido, PedidosRepository } from './restaurantTypes';

const createSale = vi.fn(async (input: object) => ({ id: 'VTA-1', ...input }));
vi.mock('../services/dataService', () => ({
  dataService: {
    createSale,
    getCurrentCashSession: vi.fn(async () => ({ id: 'CAJA-1', status: 'open' })),
  },
}));

const { deliverRestaurantOrder } = await import('./restaurantOrdersService');

const order = {
  id: 'PED-1',
  numero: 1,
  negocioId: 'NEG-1',
  mesaNombre: 'Mesa 1',
  estado: 'finalizado',
  source: 'shared',
  items: [{ productId: 'P1', cantidad: 1 }],
  taxRate: 0.19,
  total: 21420,
} as unknown as Pedido;
const repository = {
  entregarPedido: vi.fn(async () => ({ ...order, estado: 'entregado' })),
} as unknown as PedidosRepository;
const employee = { id: 'U1', nombre: 'Admin' } as never;

describe('deliverRestaurantOrder', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cobra con el medio de pago que se eligió, no siempre en efectivo', async () => {
    await deliverRestaurantOrder(repository, order, employee, [
      { method: 'digital', amount: 21420, provider: 'nequi', reference: 'ABC' },
    ]);
    expect(createSale).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentMethod: 'digital',
        payments: [{ method: 'digital', amount: 21420, provider: 'nequi', reference: 'ABC' }],
      }),
    );
  });

  it('con varios medios registra un pago dividido', async () => {
    await deliverRestaurantOrder(repository, order, employee, [
      { method: 'cash', amount: 10000 },
      { method: 'card', amount: 11420 },
    ]);
    expect(createSale).toHaveBeenCalledWith(expect.objectContaining({ paymentMethod: 'split' }));
  });

  it('si el pedido ya se cobró en la mesa, lo entrega sin crear otra venta', async () => {
    await deliverRestaurantOrder(repository, { ...order, ventaId: 'VTA-MESA' } as Pedido, employee);
    expect(createSale).not.toHaveBeenCalled();
    expect(repository.entregarPedido).toHaveBeenCalledWith('PED-1', 'NEG-1', employee, 'VTA-MESA');
  });
});
