import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { ConfirmActionDialog } from '../../components/ConfirmActionDialog';
import { useAuth } from '../../context/AuthContext';
import { addHotelCharge, cancelHotelCharge, getHotelAccount, getHotelProducts, type HotelAccount, type HotelChargeInput, type HotelChargeRecord, type HotelReservationRecord } from '../../services/dataService';
import type { Product } from '../../utils/types';

import { HotelPaymentsPanel } from './HotelPaymentsPanel';
import { uniqueRestaurantId } from '../../utils/restaurantStorage';

const money = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 }).format(value);

export function HotelAccountDialog({ reservations, initialId, onClose, onSaved }: { reservations: HotelReservationRecord[]; initialId: string; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const canManage = user?.role === 'owner' || user?.role === 'business_admin' || user?.permissions?.includes('hotel.manage');
  const canCollect = canManage && (user?.role === 'owner' || user?.role === 'business_admin' || !!user?.permissions?.includes('cash.manage'));
  const [id, setId] = useState(initialId);
  const [account, setAccount] = useState<HotelAccount | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<HotelChargeInput | null>(null);
  const [cancelling, setCancelling] = useState<HotelChargeRecord | null>(null);
  const submitting = useRef(false);
  const storageKey = `hotel-pending-charge:${user?.businessId}:${id}`;
  const clearPending = useCallback(() => { sessionStorage.removeItem(storageKey); setPending(null); }, [storageKey]);

  useEffect(() => {
    let active = true;
    setLoading(true); setAccount(null); setError(''); setProductId(''); setQuantity('1'); setNote('');
    let saved: HotelChargeInput | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { /* no pending charge */ }
    setPending(saved);
    Promise.all([getHotelAccount(id), getHotelProducts()]).then(([result, catalog]) => {
      if (!active) return;
      setAccount(result); setProducts(catalog);
      if (saved && result.charges.some(c => c.idempotencyKey === saved!.idempotencyKey)) clearPending();
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'No se pudo cargar la cuenta.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, storageKey, clearPending]);

  const add = async () => {
    if (submitting.current) return;
    const input = pending || { productId, quantity: Number(quantity), note: note.trim(), idempotencyKey:uniqueRestaurantId('hotel') };
    if (!input.productId || !Number.isFinite(input.quantity) || input.quantity <= 0) { setError('Selecciona un producto y una cantidad mayor que cero.'); return; }
    submitting.current = true; setBusy(true); setError('');
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(input)); setPending(input);
      const updated = await addHotelCharge(id, input);
      setAccount(updated); clearPending(); setQuantity('1'); setNote('');
      toast.success('Consumo cargado a la cuenta.'); onSaved();
      void getHotelProducts().then(setProducts).catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo confirmar el consumo. Reintenta la misma carga.');
      // A definite validation rejection is safe to edit; network/5xx failures
      // retain their request key across closing/reopening the account.
      const status = (e as { status?: number })?.status;
      if (status && status >= 400 && status < 500) clearPending();
    } finally { submitting.current = false; setBusy(false); }
  };
  const cancel = async () => {
    if (!cancelling) return;
    setBusy(true);
    try { setAccount(await cancelHotelCharge(id, cancelling.id)); onSaved(); toast.success('Consumo anulado; existencias devueltas.'); void getHotelProducts().then(setProducts).catch(() => undefined); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo anular el consumo.'); throw e; }
    finally { setBusy(false); }
  };
  const selected = products.find(p => p.id === productId);
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>Cuenta de habitación {account?.reservation.roomNumber || reservations.find(r => r.id === id)?.roomNumber}</DialogTitle><DialogDescription>Alojamiento y productos consumidos durante esta estancia. Cargar un consumo no registra un pago.</DialogDescription></DialogHeader>
      <div><Label htmlFor="hotel-stay">Estancia / huésped</Label><select id="hotel-stay" className="mt-1 w-full rounded border bg-background p-2" value={id} disabled={busy} onChange={e => setId(e.target.value)}>{reservations.map(r => <option key={r.id} value={r.id}>{r.guestName} · {r.checkIn} → {r.checkOut} · {r.status === 'checkin' ? 'En estancia' : r.status === 'checkout' ? 'Finalizada' : r.status === 'cancelled' ? 'Cancelada' : 'Reservada'}</option>)}</select></div>
      {error && <p role="alert" className="text-red-600">{error}</p>}
      {loading ? <p role="status">Cargando cuenta…</p> : account && <>
        <dl className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-4 text-sm">
          <dt>Alojamiento</dt><dd className="text-right">{money(account.accommodationTotal)}</dd>
          <dt>Consumos</dt><dd className="text-right">{money(account.consumptionTotal)}</dd>
          <dt>Total de la cuenta</dt><dd className="text-right font-semibold">{money(account.total)}</dd>
          <dt>Anticipo previo</dt><dd className="text-right">{money(account.advance)}</dd>
          <dt>Abonos</dt><dd className="text-right">{money(account.paidTotal)}</dd>
          <dt>Devoluciones</dt><dd className="text-right">{money(account.refundedTotal)}</dd>
          <dt>Cobrado neto</dt><dd className="text-right">{money(account.netPaidTotal)}</dd>
          <dt className="font-bold">Saldo pendiente</dt><dd className="text-right font-bold">{money(account.balance)}</dd>
        </dl>
        {canManage && !account.closedAt && account.reservation.status === 'checkin' && <section className="space-y-3 rounded-xl border p-4">
          <h3 className="font-semibold">Agregar consumo</h3>
          {pending && <p className="text-sm">Hay una carga pendiente de confirmación. Reinténtala antes de registrar otra.</p>}
          <div><Label htmlFor="hotel-product">Producto</Label><select id="hotel-product" className="mt-1 w-full rounded border bg-background p-2" value={pending?.productId || productId} disabled={busy || !!pending} onChange={e => setProductId(e.target.value)}><option value="">Seleccionar producto</option>{products.map(p => <option key={p.id} value={p.id}>{p.name} · {money(p.price)} · {p.stock} disponibles</option>)}</select></div>
          {!products.length && <p className="text-sm text-muted-foreground">Registra productos en el catálogo del hotel para cargar consumos.</p>}
          <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="hotel-quantity">Cantidad</Label><Input id="hotel-quantity" type="number" min="0.001" step="any" value={pending?.quantity ?? quantity} disabled={busy || !!pending} onChange={e => setQuantity(e.target.value)} /></div><div><Label htmlFor="hotel-charge-note">Nota (opcional)</Label><Input id="hotel-charge-note" maxLength={500} value={pending?.note ?? note} disabled={busy || !!pending} onChange={e => setNote(e.target.value)} placeholder="Minibar, entrega…" /></div></div>
          {selected && !pending && <p className="text-sm">Importe: {money(selected.price * (Number(quantity) || 0))}</p>}
          <Button disabled={busy || (!pending && !productId)} onClick={() => void add()}>{busy ? 'Guardando…' : pending ? 'Reintentar carga' : 'Cargar a cuenta'}</Button>
        </section>}
        {account.reservation.status !== 'checkin' && <p className="text-sm text-muted-foreground">Los consumos se pueden agregar o anular únicamente durante la estancia activa.</p>}
        <HotelPaymentsPanel key={id} account={account} canCollect={!!canCollect} busy={busy} onBusy={setBusy} onAccount={setAccount} onSaved={onSaved} />
        <section className="space-y-2"><h3 className="font-semibold">Detalle de consumos</h3>{!account.charges.length && <p className="text-sm text-muted-foreground">Esta estancia todavía no tiene consumos.</p>}{account.charges.map(charge => <div key={charge.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><div><p className={charge.status === 'cancelled' ? 'line-through text-muted-foreground' : 'font-medium'}>{charge.productName} · {charge.quantity} × {money(charge.unitPrice)} = {money(charge.total)}</p><p className="text-xs text-muted-foreground">{new Date(charge.createdAt).toLocaleString('es-CO')}{charge.note ? ` · ${charge.note}` : ''}{charge.status === 'cancelled' ? ' · Anulado' : ''}</p></div>{canManage && !account.closedAt && account.reservation.status === 'checkin' && charge.status === 'active' && <Button size="sm" variant="outline" disabled={busy || !!pending} onClick={() => setCancelling(charge)}>Anular</Button>}</div>)}</section>
      </>}
      <ConfirmActionDialog open={!!cancelling} onOpenChange={open => { if (!open) setCancelling(null); }} title="Anular consumo" description="Se quitará el importe de la cuenta y se devolverán las unidades al inventario. El registro quedará en el historial." confirmLabel="Anular consumo" onConfirm={cancel} />
    </DialogContent>
  </Dialog>;
}
