import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  customerCredit,
  receiveCreditPayment,
  setCreditLimit,
  type Customer,
  type CustomerCredit,
} from '../services/commerce';
import { dataService, DIGITAL_PROVIDERS } from '../services/dataService';
import { useAuth } from '../context/AuthContext';
import { canPerformAction } from '../security/permissions';
import { toastError } from '../utils/notifications';
import { formatMoney as money } from '../utils/restaurantFormat';
import { uniqueRestaurantId } from '../utils/restaurantStorage';

const METHODS = { cash: 'Efectivo', card: 'Tarjeta', digital: 'Digital', transfer: 'Transferencia' } as const;
type Method = keyof typeof METHODS;
const MOVEMENT = { sale: 'Venta fiada', return: 'Devolución', payment: 'Abono' };

/** Fiado of one customer: balance and history; owner/admin set the limit; whoever handles the till receives abonos. */
export function CustomerCreditDialog({
  customer,
  onClose,
}: {
  customer: Customer | null;
  onClose: (changed: boolean) => void;
}) {
  const { user } = useAuth();
  const canSetLimit = user?.role === 'owner' || user?.role === 'business_admin';
  const canReceive = canPerformAction(user, 'cash.manage');
  const [credit, setCredit] = useState<CustomerCredit | null>(null);
  const [limit, setLimit] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<Method>('cash');
  const [provider, setProvider] = useState('');
  const [reference, setReference] = useState('');
  // One key per abono attempt: a retry after a network error never charges twice.
  const [paymentKey, setPaymentKey] = useState(() => uniqueRestaurantId('abono'));
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);

  const load = async (id: string) => {
    const result = await customerCredit(id);
    setCredit(result);
    setLimit(String(result.creditLimit));
  };
  useEffect(() => {
    setCredit(null);
    setAmount('');
    setChanged(false);
    if (customer) load(customer.id).catch(e => toastError(e, 'No se pudo cargar el fiado.'));
  }, [customer]);

  const saveLimit = async () => {
    if (!customer) return;
    setBusy(true);
    try {
      await setCreditLimit(customer.id, Number(limit));
      await load(customer.id);
      setChanged(true);
      toast.success('Cupo actualizado.');
    } catch (e) {
      toastError(e, 'No se pudo guardar el cupo.');
    } finally {
      setBusy(false);
    }
  };

  const receive = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!customer) return;
    if (method === 'digital' && !provider) {
      toast.error('Elige el proveedor del pago digital (Nequi, Daviplata, Bre-B u otro).');
      return;
    }
    setBusy(true);
    try {
      const session = await dataService.getCurrentCashSession();
      if (!session) throw new Error('Abre tu turno de caja antes de recibir un abono.');
      const result = await receiveCreditPayment(customer.id, {
        idempotencyKey: paymentKey,
        amount: Number(amount),
        method,
        ...(method === 'digital' ? { provider, reference: reference.trim() } : {}),
        cashSessionId: session.id,
      });
      setPaymentKey(uniqueRestaurantId('abono'));
      setAmount('');
      setReference('');
      await load(customer.id);
      setChanged(true);
      toast.success(`Abono registrado. Saldo pendiente: ${money(result.balance)}`);
    } catch (e) {
      toastError(e, 'No se pudo registrar el abono.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!customer} onOpenChange={open => !open && !busy && onClose(changed)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Fiado de {customer?.name}</DialogTitle>
          <DialogDescription>Saldo pendiente, cupo y abonos. Los abonos entran a tu turno de caja.</DialogDescription>
        </DialogHeader>
        {!credit ? (
          <p className="text-muted-foreground">Cargando…</p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-2 text-center">
              {(
                [
                  ['Debe', credit.balance],
                  ['Disponible', credit.available],
                  ['Cupo', credit.creditLimit],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-xl border p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="font-bold">{money(value)}</p>
                </div>
              ))}
            </div>
            {credit.balance < 0 && (
              <p className="text-sm text-emerald-700">El cliente tiene {money(-credit.balance)} a favor.</p>
            )}

            {canSetLimit && (
              <div className="flex items-end gap-2">
                <label className="flex-1 text-sm">
                  Cupo de fiado (0 = no puede fiar)
                  <Input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1000"
                    value={limit}
                    onChange={e => setLimit(e.target.value)}
                    className="mt-1 min-h-11"
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={busy || limit === '' || Number(limit) < 0}
                  onClick={saveLimit}
                >
                  Guardar cupo
                </Button>
              </div>
            )}

            {canReceive && credit.balance > 0 && (
              <form onSubmit={receive} className="space-y-3 rounded-xl border p-3">
                <p className="font-semibold">Recibir abono</p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-sm">
                    Valor
                    <Input
                      required
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max={credit.balance}
                      step="any"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      className="mt-1 min-h-11"
                    />
                  </label>
                  <label className="text-sm">
                    Medio
                    <select
                      value={method}
                      onChange={e => setMethod(e.target.value as Method)}
                      className="mt-1 min-h-11 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      {Object.entries(METHODS).map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {method === 'digital' && (
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      aria-label="Proveedor del pago digital"
                      value={provider}
                      onChange={e => setProvider(e.target.value)}
                      className="min-h-11 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="">Proveedor…</option>
                      {DIGITAL_PROVIDERS.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <Input
                      aria-label="Referencia"
                      placeholder="Referencia (opcional)"
                      maxLength={60}
                      value={reference}
                      onChange={e => setReference(e.target.value)}
                      className="min-h-11"
                    />
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => setAmount(String(credit.balance))}
                  >
                    Todo ({money(credit.balance)})
                  </Button>
                  <Button type="submit" className="min-h-11 flex-1" disabled={busy || !(Number(amount) > 0)}>
                    {busy ? 'Guardando…' : 'Registrar abono'}
                  </Button>
                </div>
              </form>
            )}

            <div className="space-y-2">
              <p className="font-semibold">Movimientos</p>
              {credit.movements.map(m => (
                <div
                  key={`${m.type}-${m.id}-${m.createdAt}`}
                  className="flex justify-between gap-3 rounded-lg border p-2 text-sm"
                >
                  <span>
                    {MOVEMENT[m.type]}
                    {m.type === 'payment' && m.method ? ` · ${METHODS[m.method as Method] ?? m.method}` : ''}
                    {m.type !== 'payment' && (
                      <Link className="ml-1 text-orange-700 underline" to={'/sales/' + encodeURIComponent(m.id)}>
                        {m.id}
                      </Link>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {new Date(m.createdAt).toLocaleString('es-CO')}
                    </span>
                  </span>
                  <span
                    className={m.type === 'sale' ? 'font-semibold text-rose-700' : 'font-semibold text-emerald-700'}
                  >
                    {m.type === 'sale' ? '+' : '−'}
                    {money(m.amount)}
                  </span>
                </div>
              ))}
              {!credit.movements.length && <p className="text-sm text-muted-foreground">Sin movimientos de fiado.</p>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
