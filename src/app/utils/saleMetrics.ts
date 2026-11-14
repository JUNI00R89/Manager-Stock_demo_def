import type { SaleRecord, SaleItemRecord } from '../services/dataService';

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Sales are grouped by the original sale date, with all refunds known today. */
export function saleNetTotal(sale: { status: string; totalPrice: number; returnedTotal?: number }) {
  return sale.status === 'completed' ? cents(Math.max(0, sale.totalPrice - (sale.returnedTotal || 0))) : 0;
}

export function saleNetRevenue(sale: SaleRecord) {
  // The current sales model applies one tax rate to the whole sale.
  const base = Math.max(0, sale.subtotal - sale.lineDiscount - sale.globalDiscount);
  return sale.totalPrice > 0 ? cents(base * saleNetTotal(sale) / sale.totalPrice) : 0;
}

export function returnedUnits(sale: SaleRecord, item: SaleItemRecord, restockedOnly = false) {
  if (!item.id) return 0;
  return Math.min(item.quantity, (sale.returns || []).flatMap(r => r.items)
    .filter(r => r.itemId === item.id && (!restockedOnly || r.restock))
    .reduce((sum, r) => sum + r.quantity, 0));
}

export function saleCost(sale: SaleRecord) {
  if (sale.status !== 'completed') return 0;
  // Damaged/prepared goods remain a cost; only stock actually restored reverses it.
  return cents(sale.items.reduce((sum, item) => sum + (item.unitCost || 0) *
    Math.max(0, item.quantity - returnedUnits(sale, item, true)), 0));
}

export function csvCell(value: unknown) {
  let text = String(value ?? '');
  if (typeof value === 'string' && /^[\s]*[=+\-@]|^[\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
