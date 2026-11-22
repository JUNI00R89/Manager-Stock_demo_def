import { DIGITAL_PROVIDERS, type PaymentPartRecord } from '../services/dataService';
import { formatMoney } from './restaurantFormat';

export const METHOD_NAMES: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  digital: 'Digital',
  credit: 'Fiado',
  split: 'Dividido',
};
const providerName = (id?: string | null) => DIGITAL_PROVIDERS.find(p => p.id === id)?.label ?? '';

/** "Nequi · Ref 123" for the digital parts of a sale; empty when there are none. */
export function digitalDetail(payments: PaymentPartRecord[] | undefined): string {
  return (payments ?? [])
    .filter(p => p.method === 'digital' && p.provider)
    .map(p => [providerName(p.provider), p.reference ? `Ref ${p.reference}` : ''].filter(Boolean).join(' · '))
    .join(', ');
}

/** One line per till total: "Efectivo $ 5.000 · Nequi $ 80.000". Digital totals are named by provider. */
export function tillBreakdown(rows: { method: string; provider: string | null; amount: number }[] | undefined): string {
  return (rows ?? [])
    .map(
      r =>
        `${(r.method === 'digital' && providerName(r.provider)) || METHOD_NAMES[r.method] || r.method} ${formatMoney(r.amount)}`,
    )
    .join(' · ');
}

/** The payment method that brought in the most money (split sales count by their parts), with its share. */
export function mainPaymentMethod(
  sales: { paymentMethod: string; totalPrice: number; payments?: { method: string; amount: number }[] }[],
): { label: string; percent: number } | null {
  const totals = new Map<string, number>();
  for (const sale of sales) {
    const parts = sale.payments?.length ? sale.payments : [{ method: sale.paymentMethod, amount: sale.totalPrice }];
    for (const part of parts) totals.set(part.method, (totals.get(part.method) ?? 0) + part.amount);
  }
  const total = [...totals.values()].reduce((sum, amount) => sum + amount, 0);
  if (total <= 0) return null;
  const [method, amount] = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
  return { label: METHOD_NAMES[method] ?? method, percent: Math.round((amount / total) * 100) };
}
