import { afterEach, describe, expect, it, vi } from 'vitest';
import { dataService } from './dataService';

const sale = {
  id: 'VTA-1',
  date: '2026-11-09T12:00:00Z',
  status: 'completed',
  items: [],
  payments: [],
  totalPrice: 1000,
};

describe('dataService.getSales', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('con sesión no copia el historial de ventas a localStorage (llenaba el límite de ~5 MB)', async () => {
    localStorage.setItem('manager_stock_auth_token', 'token-de-prueba');
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify([sale]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    await expect(dataService.getSales()).resolves.toEqual([sale]);
    const wroteSales = setItem.mock.calls.some(([, value]) => String(value).includes(sale.id));
    expect(wroteSales).toBe(false);
  });
});
