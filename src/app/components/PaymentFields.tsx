import { Input } from './ui/input';
import { DIGITAL_PROVIDERS, type DigitalProvider, type PaymentPartRecord } from '../services/dataService';

export const paymentNames = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', digital: 'Digital' };
export function PaymentFields({
  total,
  values,
  onChange,
  disabled = false,
}: {
  total: number;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const amount = Object.keys(paymentNames).reduce((sum, key) => sum + (Number(values[key]) || 0), 0);
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="font-semibold mb-2">Medios de pago</legend>
      <div className="flex flex-wrap gap-2">
        {Object.entries(paymentNames).map(([key, label]) => (
          <button
            type="button"
            className="border rounded-lg p-2 min-h-11 text-sm hover:bg-accent"
            key={key}
            onClick={() => onChange({ [key]: total.toFixed(2) })}
          >
            Todo en {label.toLowerCase()}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {Object.entries(paymentNames).map(([key, label]) => (
          <label key={key} className="text-sm">
            {label}
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={values[key] || ''}
              onChange={e => onChange({ ...values, [key]: e.target.value })}
              className="mt-1 min-h-11"
            />
          </label>
        ))}
      </div>
      {Number(values.digital) > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            Proveedor digital
            <select
              value={values.digitalProvider || ''}
              onChange={e => onChange({ ...values, digitalProvider: e.target.value })}
              className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-2 text-sm"
              required
            >
              <option value="">Elige…</option>
              {DIGITAL_PROVIDERS.map(p => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Referencia (opcional)
            <Input
              value={values.digitalReference || ''}
              maxLength={60}
              onChange={e => onChange({ ...values, digitalReference: e.target.value })}
              className="mt-1 min-h-11"
            />
          </label>
        </div>
      )}
      <p className={Math.abs(total - amount) > 0.01 ? 'text-amber-700 text-sm' : 'text-sm text-emerald-700'}>
        Pendiente de distribuir: {(total - amount).toLocaleString('es-CO', { style: 'currency', currency: 'COP' })}
      </p>
    </fieldset>
  );
}
export function paymentParts(values: Record<string, string>): PaymentPartRecord[] {
  // values holds one amount per method plus digitalProvider/digitalReference for the digital part.
  const amounts = Object.keys(paymentNames).map(method => [method, values[method] ?? ''] as const);
  if (amounts.some(([, v]) => v !== '' && (!Number.isFinite(Number(v)) || Number(v) < 0)))
    throw new Error('Revisa los importes de pago.');
  return amounts
    .filter(([, value]) => Number(value) > 0)
    .map(([method, value]) => {
      if (method !== 'digital') return { method: method as PaymentPartRecord['method'], amount: Number(value) };
      if (!values.digitalProvider)
        throw new Error('Elige el proveedor del pago digital (Nequi, Daviplata, Bre-B u otro).');
      return {
        method: 'digital' as const,
        amount: Number(value),
        provider: values.digitalProvider as DigitalProvider,
        reference: (values.digitalReference || '').trim(),
      };
    });
}
