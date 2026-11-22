import { colombiaDateKey } from '../services/dataService';
import { saleNetTotal } from './saleMetrics';
import { METHOD_NAMES } from './paymentLabel';

export type SalesPeriod = 'today' | 'week' | 'month';

type SummarySale = {
  date: string;
  status: string;
  totalPrice: number;
  returnedTotal?: number;
  paymentMethod: string;
  payments?: { method: string; amount: number }[];
  items: { productId: string | null; productName: string; quantity: number; subtotal: number }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** Colombia calendar keys of the last `count` days, oldest first, ending today. Colombia has no DST. */
function lastDayKeys(count: number, now: Date): string[] {
  return Array.from({ length: count }, (_, i) => colombiaDateKey(new Date(now.getTime() - (count - 1 - i) * DAY_MS)));
}

/** Completed sales of the period, by the sale's original date in Colombia. */
export function salesInPeriod<T extends SummarySale>(sales: T[], period: SalesPeriod, now = new Date()): T[] {
  const today = colombiaDateKey(now);
  const week = new Set(lastDayKeys(7, now));
  return sales.filter(sale => {
    if (sale.status !== 'completed') return false;
    const key = colombiaDateKey(new Date(sale.date));
    if (period === 'today') return key === today;
    if (period === 'week') return week.has(key);
    return key.slice(0, 7) === today.slice(0, 7);
  });
}

/** Money received by method (split sales count by their parts), largest first. */
export function paymentBreakdown(sales: SummarySale[]) {
  const totals = new Map<string, number>();
  for (const sale of sales) {
    const parts = sale.payments?.length ? sale.payments : [{ method: sale.paymentMethod, amount: sale.totalPrice }];
    for (const part of parts) totals.set(part.method, (totals.get(part.method) ?? 0) + part.amount);
  }
  const total = [...totals.values()].reduce((sum, amount) => sum + amount, 0);
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([method, amount]) => ({
      method,
      label: METHOD_NAMES[method] ?? method,
      amount,
      percent: total > 0 ? Math.round((amount / total) * 100) : 0,
    }));
}

/** Best-selling products by line revenue (before returns), with units sold. */
export function topProducts(sales: SummarySale[], limit = 3) {
  const byName = new Map<string, { name: string; units: number; revenue: number }>();
  for (const sale of sales)
    for (const item of sale.items) {
      const row = byName.get(item.productName) ?? { name: item.productName, units: 0, revenue: 0 };
      row.units += item.quantity;
      row.revenue += item.subtotal;
      byName.set(item.productName, row);
    }
  return [...byName.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit);
}

/** Net revenue per Colombia day for the last `days` days, oldest first, including days without sales. */
export function dailyRevenue(sales: SummarySale[], days: number, now = new Date()) {
  return lastDayKeys(days, now).map(key => {
    const daySales = sales.filter(s => s.status === 'completed' && colombiaDateKey(new Date(s.date)) === key);
    const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
    return {
      day: `${WEEKDAYS[weekday]} ${Number(key.slice(8))}`,
      ventas: daySales.length,
      ingresos: daySales.reduce((sum, s) => sum + saleNetTotal(s), 0),
    };
  });
}
