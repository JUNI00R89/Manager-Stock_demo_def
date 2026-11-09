import { useEffect, useState } from 'react';
import { Layout } from '../../components/Layout';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ConfirmActionDialog } from '../../components/ConfirmActionDialog';
import { api } from '../../services/dataService';
import { isDesktopMode } from '../../services/desktop';
import { useAuth } from '../../context/AuthContext';
import { canPerformAction } from '../../security/permissions';
import { toast } from 'sonner';
import { toastError } from '../../utils/notifications';

interface CountProduct { id: string; name: string; sku: string; unit: string; movementId: number }
interface Line { product: CountProduct; quantity: string }
interface Review {
  id: string; status: 'open' | 'closed' | 'cancelled'; notes: string; createdByName: string; createdAt: string;
  canApprove: boolean; items: { id: number; productName: string; countedQuantity: number; systemQuantity: number | null; difference: number | null }[];
}
const statuses = { open: 'Pendiente de revisión', closed: 'Aplicado', cancelled: 'Cancelado' };
function readDraft(key: string): { lines: Line[]; notes: string } {
  try { return JSON.parse(localStorage.getItem(key) || '{"lines":[],"notes":""}'); }
  catch { return { lines: [], notes: '' }; }
}

export function CountReviews() {
  const { user } = useAuth();
  const draftKey = `blind_count:${user?.businessId}:${user?.id}`;
  const pendingKey = draftKey + ':pending';
  const [lines, setLines] = useState<Line[]>(() => readDraft(draftKey).lines);
  const [notes, setNotes] = useState(() => readDraft(draftKey).notes);
  const [pending, setPending] = useState<string | null>(() => sessionStorage.getItem(pendingKey));
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<CountProduct[]>([]);
  const [counts, setCounts] = useState<Review[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [action, setAction] = useState<{ id: string; kind: 'approve' | 'cancel' } | null>(null);
  const load = async () => {
    const [reviews, available] = await Promise.all([
      api<Review[]>('/inventory/count-reviews'),
      api<CountProduct[]>(`/inventory/count-products?search=${encodeURIComponent(search)}`),
    ]);
    setCounts(reviews); setProducts(available);
  };
  useEffect(() => { if (!isDesktopMode()) void load().catch(e => setError(e.message)); }, []);
  useEffect(() => { localStorage.setItem(draftKey, JSON.stringify({ lines, notes })); }, [lines, notes, draftKey]);
  useEffect(() => {
    let active = true;
    if (isDesktopMode()) return;
    const timer = setTimeout(() => { void api<CountProduct[]>(`/inventory/count-products?search=${encodeURIComponent(search)}`).then(list => { if (active) { setProducts(list); setError(''); } }).catch(e => { if (active) setError(e.message); }); }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [search]);
  const submit = async () => {
    setBusy(true);
    try {
      let body = pending;
      if (!body) {
        if (!lines.length || lines.some(l => l.quantity === '' || !Number.isFinite(Number(l.quantity)) || Number(l.quantity) < 0)) throw new Error('Completa las cantidades contadas.');
        body = JSON.stringify({ idempotencyKey: crypto.randomUUID(), notes, items: lines.map(l => ({ productId: l.product.id, countedQuantity: Number(l.quantity), expectedMovementId: l.product.movementId })) });
        sessionStorage.setItem(pendingKey, body); setPending(body);
      }
      await api('/inventory/count-reviews', { method: 'POST', body });
      sessionStorage.removeItem(pendingKey); setPending(null); setLines([]); setNotes('');
      toast.success('Conteo enviado a revisión. Las existencias todavía no cambian.'); await load();
      setProducts(await api<CountProduct[]>(`/inventory/count-products?search=${encodeURIComponent(search)}`));
    } catch (e) {
      if (e && typeof e === 'object' && 'status' in e && [400, 403, 404, 409, 422].includes(Number(e.status))) { sessionStorage.removeItem(pendingKey); setPending(null); }
      if (e && typeof e === 'object' && 'status' in e && Number(e.status) === 409) void load().catch(() => {});
      toastError(e, 'No se pudo confirmar el conteo.');
    } finally { setBusy(false); }
  };
  if (isDesktopMode()) return <Layout><h1 className="text-2xl font-bold">Conteos con revisión</h1><p className="mt-4">Este flujo de aprobación requiere la aplicación conectada al servidor.</p></Layout>;
  return <Layout><div className="max-w-6xl mx-auto space-y-5">
    <div className="flex justify-between flex-wrap gap-3"><div><h1 className="text-2xl font-bold">Conteos con revisión</h1><p className="text-muted-foreground">Cuenta sin ver la existencia teórica. Un responsable revisa y aplica las diferencias.</p></div><Button variant="outline" onClick={() => void load().catch(e => toastError(e, 'No se pudo actualizar.'))}>Actualizar</Button></div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="grid lg:grid-cols-2 gap-5"><section className="rounded-xl border p-4 space-y-4"><h2 className="font-semibold">Nuevo conteo</h2><p className="text-sm text-muted-foreground">El borrador se conserva en este navegador. Si hay movimientos durante el conteo, quita los productos y vuelve a agregarlos para contarlos de nuevo.</p>
      {pending ? <><p>Hay un conteo por confirmar. El reintento conserva la misma operación.</p><Button disabled={busy} onClick={() => void submit()}>Confirmar envío pendiente</Button></> : canPerformAction(user, 'inventory.count') && <>
        <label className="block text-sm">Buscar producto por nombre o SKU<Input value={search} onChange={e => setSearch(e.target.value)} className="min-h-11" /></label>
        <label className="block text-sm">Agregar producto<select aria-label="Agregar producto" className="w-full bg-background border rounded-md p-2 min-h-11" value="" onChange={e => { const p = products.find(v => v.id === e.target.value); if (p && !lines.some(l => l.product.id === p.id)) setLines(list => [...list, { product: p, quantity: '' }]); }}><option value="">Selecciona un producto</option>{products.filter(p => !lines.some(l => l.product.id === p.id)).map(p => <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}</select></label>
        {lines.map(line => <div className="border rounded-lg p-3 space-y-2" key={line.product.id}><label className="block text-sm">{line.product.name} · {line.product.unit}<Input aria-label={'Cantidad contada de ' + line.product.name} type="number" step="0.000001" min="0" value={line.quantity} onChange={e => setLines(current => current.map(l => l.product.id === line.product.id ? { ...l, quantity: e.target.value } : l))} /></label><Button variant="outline" onClick={() => setLines(current => current.filter(l => l.product.id !== line.product.id))}>Quitar</Button></div>)}
        <label className="block text-sm">Notas<textarea className="w-full bg-background border rounded-md p-2" maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)} /></label><Button className="min-h-11 w-full" disabled={busy || !lines.length} onClick={() => void submit()}>Enviar a revisión</Button>
      </>}
    </section><section className="space-y-3"><h2 className="font-semibold">Últimos 100 conteos</h2>{counts.map(count => <details className="border rounded-xl p-4" key={count.id}><summary className="cursor-pointer min-h-11 break-words">{count.id} · {statuses[count.status]}</summary><p className="text-sm text-muted-foreground mb-3">{count.createdByName} · {new Date(count.createdAt).toLocaleString('es-CO')}</p><p className="text-sm mb-3">{count.notes}</p><div className="space-y-2">{count.items.map(item => <div className="border rounded-lg p-3 text-sm" key={item.id}><p className="font-medium">{item.productName}</p><p>Contado: {item.countedQuantity}</p>{count.canApprove && <p>Sistema al contar: {item.systemQuantity} · Diferencia: {item.difference}</p>}</div>)}</div>{count.status === 'open' && count.canApprove && <div className="flex flex-wrap gap-2 mt-4"><Button className="min-h-11" disabled={busy} onClick={() => setAction({ id: count.id, kind: 'approve' })}>Aprobar y ajustar</Button><Button variant="outline" disabled={busy} onClick={() => setAction({ id: count.id, kind: 'cancel' })}>Cancelar conteo</Button></div>}</details>)}{!counts.length && <p className="text-muted-foreground">Aún no hay conteos.</p>}</section></div>
    <ConfirmActionDialog open={!!action} onOpenChange={open => { if (!open) setAction(null); }} title={action?.kind === 'approve' ? 'Aplicar diferencias del conteo' : 'Cancelar conteo'} description={action?.kind === 'approve' ? 'Se crearán movimientos por las diferencias revisadas. Si hubo movimientos posteriores, se rechazará la aprobación.' : 'El conteo se conservará como cancelado y no cambiará las existencias.'} confirmLabel={action?.kind === 'approve' ? 'Aprobar y ajustar' : 'Cancelar conteo'} onConfirm={async () => { if (!action) return; setBusy(true); try { await api(`/inventory/count-reviews/${action.id}/${action.kind}`, { method: 'POST' }); setAction(null); await load(); toast.success('Conteo actualizado.'); } catch (e) { toastError(e, 'No se pudo actualizar el conteo.'); throw e; } finally { setBusy(false); } }} />
  </div></Layout>;
}
