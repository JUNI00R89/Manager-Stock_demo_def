import { Input } from './ui/input';
import type { PaymentPartRecord } from '../services/dataService';

export const paymentNames = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', digital: 'Digital' };
export function PaymentFields({ total, values, onChange, disabled = false }: { total: number; values: Record<string, string>; onChange: (values: Record<string, string>) => void; disabled?: boolean }) {
  const amount = Object.values(values).reduce((sum, value) => sum + (Number(value) || 0), 0);
  return <fieldset disabled={disabled} className="space-y-3"><legend className="font-semibold mb-2">Medios de pago</legend>
    <div className="flex flex-wrap gap-2">{Object.entries(paymentNames).map(([key, label]) => <button type="button" className="border rounded-lg p-2 min-h-11 text-sm hover:bg-accent" key={key} onClick={() => onChange({ [key]: total.toFixed(2) })}>Todo en {label.toLowerCase()}</button>)}</div>
    <div className="grid grid-cols-2 gap-3">{Object.entries(paymentNames).map(([key, label]) => <label key={key} className="text-sm">{label}<Input type="number" inputMode="decimal" min="0" step="0.01" value={values[key] || ''} onChange={e => onChange({ ...values, [key]: e.target.value })} className="mt-1 min-h-11" /></label>)}</div>
    <p className={Math.abs(total - amount) > .01 ? 'text-amber-700 text-sm' : 'text-sm text-emerald-700'}>Pendiente de distribuir: {(total - amount).toLocaleString('es-CO', { style: 'currency', currency: 'COP' })}</p>
  </fieldset>;
}
export function paymentParts(values: Record<string, string>): PaymentPartRecord[] {
  if (Object.values(values).some(v => v !== '' && (!Number.isFinite(Number(v)) || Number(v) < 0))) throw new Error('Revisa los importes de pago.');
  return Object.entries(values).filter(([, value]) => Number(value) > 0).map(([method, value]) => ({ method: method as PaymentPartRecord['method'], amount: Number(value) }));
}
