import { DIGITAL_PROVIDERS, type PaymentPartRecord } from '../services/dataService';
import { formatMoney } from './restaurantFormat';

const METHOD_NAMES: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  digital: 'Digital',
  credit: 'Fiado',
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
