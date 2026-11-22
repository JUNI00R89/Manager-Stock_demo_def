import { describe, expect, it } from 'vitest';
import { dailyRevenue, paymentBreakdown, salesInPeriod, topProducts } from './salesSummary';

// 21 Nov 2026, 15:00 in Colombia (UTC-5).
const NOW = new Date('2026-11-21T20:00:00Z');
const sale = (id: string, date: string, total: number, extra: object = {}) => ({
  id,
  date,
  status: 'completed' as const,
  totalPrice: total,
  paymentMethod: 'cash',
  items: [],
  ...extra,
});

describe('salesInPeriod', () => {
  const sales = [
    sale('hoy', '2026-11-21T14:00:00Z', 1000),
    // 22 Nov 01:00 UTC is still 21 Nov in Colombia.
    sale('hoy-noche', '2026-11-22T01:00:00Z', 1000),
    sale('hace-6-dias', '2026-11-15T15:00:00Z', 1000),
    sale('hace-7-dias', '2026-11-14T15:00:00Z', 1000),
    sale('mes-pasado', '2026-10-30T15:00:00Z', 1000),
    sale('anulada', '2026-11-21T15:00:00Z', 1000, { status: 'cancelled' }),
  ];
  const ids = (period: 'today' | 'week' | 'month') => salesInPeriod(sales, period, NOW).map(s => s.id);

  it('usa el día de Colombia y solo ventas completadas', () => {
    expect(ids('today')).toEqual(['hoy', 'hoy-noche']);
  });
  it('los 7 días incluyen hoy y los 6 anteriores', () => {
    expect(ids('week')).toEqual(['hoy', 'hoy-noche', 'hace-6-dias']);
  });
  it('el mes es el mes calendario', () => {
    expect(ids('month')).toEqual(['hoy', 'hoy-noche', 'hace-6-dias', 'hace-7-dias']);
  });
});

describe('paymentBreakdown', () => {
  it('suma por medio, cuenta las partes divididas y ordena de mayor a menor', () => {
    const rows = paymentBreakdown([
      sale('a', '2026-11-21T14:00:00Z', 30000),
      sale('b', '2026-11-21T14:00:00Z', 50000, {
        paymentMethod: 'split',
        payments: [
          { method: 'digital', amount: 45000 },
          { method: 'cash', amount: 5000 },
        ],
      }),
      sale('c', '2026-11-21T14:00:00Z', 20000, { paymentMethod: 'credit' }),
    ]);
    expect(rows).toEqual([
      { method: 'digital', label: 'Digital', amount: 45000, percent: 45 },
      { method: 'cash', label: 'Efectivo', amount: 35000, percent: 35 },
      { method: 'credit', label: 'Fiado', amount: 20000, percent: 20 },
    ]);
  });
});

describe('topProducts', () => {
  it('agrupa por producto y ordena por ingresos', () => {
    const items = (rows: [string, number, number][]) =>
      rows.map(([productName, quantity, subtotal]) => ({ productId: productName, productName, quantity, subtotal }));
    expect(
      topProducts(
        [
          sale('a', '2026-11-21T14:00:00Z', 0, {
            items: items([
              ['Arroz', 2, 9000],
              ['Gaseosa', 1, 6500],
            ]),
          }),
          sale('b', '2026-11-21T14:00:00Z', 0, { items: items([['Arroz', 4, 18000]]) }),
        ],
        2,
      ),
    ).toEqual([
      { name: 'Arroz', units: 6, revenue: 27000 },
      { name: 'Gaseosa', units: 1, revenue: 6500 },
    ]);
  });
});

describe('dailyRevenue', () => {
  it('devuelve un punto por día con los ingresos netos, aunque el día no tenga ventas', () => {
    const points = dailyRevenue(
      [sale('a', '2026-11-21T14:00:00Z', 1000), sale('b', '2026-11-20T14:00:00Z', 500)],
      3,
      NOW,
    );
    expect(points.map(p => p.ingresos)).toEqual([0, 500, 1000]);
    expect(points[2].day).toBe('sáb 21');
  });
});
