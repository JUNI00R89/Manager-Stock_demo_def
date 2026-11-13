import { uniqueRestaurantId } from '../utils/restaurantStorage';
import { useState } from 'react';
import { api, dataService, type SaleRecord, type PaymentPartRecord } from '../services/dataService';
import { useAuth } from '../context/AuthContext';
import { canPerformAction } from '../security/permissions';
import { isDesktopMode } from '../services/desktop';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { toast } from 'sonner';
import { toastError } from '../utils/notifications';

export interface SaleReturnRecord {
  id: string; total: number; serviceAmount?: number; reason: string; createdAt: string;
  items: { itemId: number; quantity: number; restock: boolean; amount: number }[];
  payments: PaymentPartRecord[];
}
interface ReturnLine { itemId: number; quantity: number; restock: boolean }
interface Quote { total: number; items: ReturnLine[]; availablePayments: Record<string, number> }
interface Pending { items: ReturnLine[]; serviceAmount?: number; expectedTotal: number; reason: string; payments: PaymentPartRecord[]; idempotencyKey: string; cashSessionId: string }
const money = (n: number) => n.toLocaleString('es-CO', { style: 'currency', currency: 'COP' });
const methods: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', digital: 'Digital' };

export function SaleReturnsPanel({ sale, onSaved, appointmentId }: { sale: SaleRecord; onSaved: () => Promise<void>; appointmentId?: string }) {
  const base = appointmentId ? `/services/appointments/${encodeURIComponent(appointmentId)}/returns` : `/sales/${encodeURIComponent(sale.id)}/returns`;
  const { user } = useAuth();
  const key = `sale_return:${user?.businessId}:${user?.id}:${sale.id}`;
  const [pending, setPending] = useState<Pending | null>(() => { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; } });
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [serviceAmount, setServiceAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const canReturn = canPerformAction(user, appointmentId ? 'services.manage' : 'sales.cancel') && canPerformAction(user, 'cash.manage');
  const remaining = (id: number, qty: number) => Math.max(0, qty - (sale.returns || []).flatMap(r => r.items).filter(i => i.itemId === id).reduce((sum, i) => sum + i.quantity, 0));
  const submit = async () => {
    setBusy(true);
    try {
      let input = pending;
      if (!input) {
        if (!quote) return;
        const session = await dataService.getCurrentCashSession();
        if (!session) throw new Error('Abre tu turno de caja antes de devolver dinero.');
        input = { items: lines, serviceAmount: Number(serviceAmount || 0), expectedTotal: quote.total, reason: reason.trim(), payments: Object.entries(amounts).filter(([, amount]) => Number(amount) > 0).map(([method, amount]) => ({ method: method as PaymentPartRecord['method'], amount: Number(amount) })), idempotencyKey: uniqueRestaurantId('op'), cashSessionId: session.id };
        sessionStorage.setItem(key, JSON.stringify(input)); setPending(input);
      }
      await api(base, { method: 'POST', body: JSON.stringify(input) });
      sessionStorage.removeItem(key); setPending(null); setLines([]); setQuote(null); setReason(''); setServiceAmount('');
      toast.success('Devolución registrada.'); await onSaved();
    } catch (e) {
      if (typeof e === 'object' && e && 'status' in e && [400, 403, 404, 409, 422].includes(Number(e.status))) { sessionStorage.removeItem(key); setPending(null); setQuote(null); }
      toastError(e, 'No se pudo confirmar la devolución. Reintenta la misma operación.');
    } finally { setBusy(false); }
  };
  return <section className="border rounded-xl p-4 space-y-4">
    <h2 className="font-semibold">Devoluciones parciales</h2><p className="text-sm">Devuelto: {money(sale.returnedTotal || 0)} · Venta neta: {money(sale.netTotal ?? sale.totalPrice)}</p>
    {(sale.returns || []).map(r => <article key={r.id} className="border rounded-lg p-3 text-sm space-y-1"><p>{r.id} · {money(r.total)}</p><p className="break-words">{r.reason}</p><p>{r.payments.map(p => `${methods[p.method]}: ${money(p.amount)}`).join(' · ')}</p><p>{new Date(r.createdAt).toLocaleString('es-CO')}</p></article>)}
    {canReturn && sale.status === 'completed' && (isDesktopMode() ? <p className="text-sm text-muted-foreground">El registro de devoluciones parciales requiere la aplicación conectada al servidor.</p> : <>
      <p className="text-sm text-muted-foreground">Selecciona cantidades y revisa el importe antes de confirmar. Para artículos dañados o preparados, desmarca la reposición. Una devolución interna deberá tener su nota crédito cuando la factura electrónica esté habilitada.</p>
      {pending ? <div className="rounded-lg border p-3 space-y-2"><p>Hay una devolución por confirmar. Reintentar consulta o registra la misma operación sin duplicarla.</p><Button disabled={busy} onClick={() => void submit()} className="min-h-11">Confirmar devolución pendiente</Button></div> : <>
        {(sale.returnableServiceAmount || 0) > 0 && <label className="block text-sm">Importe del servicio a devolver · Máximo {money(sale.returnableServiceAmount!)}<Input type="number" min="0" max={sale.returnableServiceAmount} step="0.01" value={serviceAmount} onChange={e => { setServiceAmount(e.target.value); setQuote(null); }} /></label>}
        <fieldset disabled={busy} className="space-y-3">{sale.items.filter(i => i.id && remaining(i.id, i.quantity) > 0).map(i => {
          const id = i.id!; const line = lines.find(l => l.itemId === id);
          return <div className="border rounded-lg p-3 space-y-2" key={id}><label className="block text-sm">{i.productName} · Disponibles: {remaining(id, i.quantity)}<Input aria-label={'Devolver ' + i.productName} type="number" min="0" max={remaining(id, i.quantity)} step="0.000001" value={line?.quantity || ''} placeholder="0" onChange={e => { setQuote(null); const n = Number(e.target.value); setLines(current => [...current.filter(l => l.itemId !== id), ...(n > 0 ? [{ itemId: id, quantity: n, restock: line?.restock ?? true }] : [])]); }} /></label><label className="flex gap-2 items-center text-sm min-h-11"><input type="checkbox" checked={line?.restock ?? true} disabled={!line} onChange={e => { setQuote(null); setLines(current => current.map(l => l.itemId === id ? { ...l, restock: e.target.checked } : l)); }} /> Reponer al inventario</label></div>;
        })}<label className="block text-sm">Motivo<Input value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label></fieldset>
        <Button variant="outline" className="min-h-11" disabled={busy || (!lines.length && !(Number(serviceAmount) > 0))} onClick={async () => {
          setBusy(true); try { const result = await api<Quote>(base + '/quote', { method: 'POST', body: JSON.stringify({ items: lines, serviceAmount: Number(serviceAmount || 0) }) }); setQuote(result); let left = result.total; const suggested: Record<string, string> = {}; Object.entries(result.availablePayments).forEach(([method, available]) => { const amount = Math.min(left, available); suggested[method] = amount.toFixed(2); left = Math.max(0, Math.round((left - amount) * 100) / 100); }); setAmounts(suggested); } catch (e) { toastError(e, 'No se pudo calcular.'); } finally { setBusy(false); }
        }}>Revisar devolución</Button>
        {quote && <div className="space-y-3"><p className="font-semibold">Total a devolver: {money(quote.total)}</p>{Object.entries(quote.availablePayments).map(([method, available]) => <label className="block text-sm" key={method}>{methods[method]} · Máximo {money(available)}<Input type="number" step="0.01" min="0" max={available} value={amounts[method] || ''} onChange={e => setAmounts(current => ({ ...current, [method]: e.target.value }))} /></label>)}<Button disabled={busy || reason.trim().length < 3} className="min-h-11" onClick={() => void submit()}>Confirmar devolución</Button></div>}
      </>}
    </>)}
  </section>;
}
