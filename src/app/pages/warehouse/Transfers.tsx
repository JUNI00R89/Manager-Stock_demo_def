import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, CirclePlus, PackageCheck, RefreshCw, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../utils/notifications';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Badge } from '../../components/ui/badge';
import { dataService, type InventoryLotRecord, type TransferRecord } from '../../services/dataService';
import type { Product } from '../../utils/types';
import { dateTime, fmtQty, LotSelect, PageTitle, ProductSelect, useWarehousePermissions, useWarehouseRefs } from './shared';

type TransferLine = { key: string; productId: string; quantity: string; unit: string; lotId: string };
const newLine = (): TransferLine => ({ key: `${Date.now()}-${Math.random().toString(36).slice(2)}`, productId: '', quantity: '1', unit: '', lotId: '' });
const statusMeta: Record<TransferRecord['status'], { label: string; className: string }> = {
  draft: { label: 'Borrador', className: 'border-slate-200 bg-slate-50 text-slate-700' },
  pending: { label: 'Pendiente', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  in_transit: { label: 'En tránsito', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  received: { label: 'Recibida', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  cancelled: { label: 'Cancelada', className: 'border-rose-200 bg-rose-50 text-rose-700' },
};

export function WarehouseTransfers() {
  const { products, locations, loading, reload } = useWarehouseRefs();
  const permissions = useWarehousePermissions();
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [originId, setOriginId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<TransferLine[]>([newLine()]);
  const [lots, setLots] = useState<InventoryLotRecord[]>([]);
  const [saving, setSaving] = useState(false);

  const loadTransfers = async (status?: string) => {
    try { setTransfers(await dataService.getTransfers(status)); }
    catch (error) { toastError(error, 'No se pudieron cargar las transferencias.'); }
    finally { if (status) setStatusFilter(status); }
  };
  const loadLots = async () => {
    try { setLots(await dataService.getInventoryLots({ includeEmpty: false })); }
    catch { /* informativo */ }
  };
  useEffect(() => { void loadTransfers(); }, []);
  useEffect(() => { void loadLots(); }, []);

  const productById = useMemo(() => new Map<string, Product>(products.map(product => [product.id, product])), [products]);
  const productLots = useMemo(() => {
    const ids = new Set(lines.map(line => line.productId).filter(Boolean));
    if (!ids.size) return lots;
    return lots.filter(lot => lot.productId && ids.has(lot.productId));
  }, [lots, lines]);

  const updateLine = (key: string, patch: Partial<TransferLine>) => setLines(current => current.map(line => line.key === key ? { ...line, ...patch } : line));
  const changeProduct = (key: string, productId: string) => {
    const product = productById.get(productId);
    updateLine(key, { productId, unit: product?.unit || '', lotId: '' });
  };
  const removeLine = (key: string) => setLines(current => current.length === 1 ? current : current.filter(line => line.key !== key));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!originId || !destinationId) { toast.error('Selecciona origen y destino para la transferencia.'); return; }
    if (originId === destinationId) { toast.error('La ubicación de origen y destino deben ser diferentes.'); return; }
    const invalid = lines.find(line => !line.productId || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0);
    if (invalid) { toast.error('Agrega productos y cantidades mayores que cero.'); return; }
    setSaving(true);
    try {
      const transfer = await dataService.createTransfer({
        originLocationId: originId, destinationLocationId: destinationId, notes: notes.trim(),
        items: lines.map(line => ({ productId: line.productId, quantity: Number(line.quantity), unit: line.unit || undefined, lotId: line.lotId || null })),
      });
      toast.success(`Transferencia ${transfer.id} creada en borrador.`);
      setNotes(''); setLines([{ ...newLine() }]); setOriginId(''); setDestinationId('');
      await Promise.all([loadTransfers(), loadLots(), reload()]);
    } catch (error) { toastError(error, 'No se pudo crear la transferencia.'); }
    finally { setSaving(false); }
  };

  const runAction = async (transfer: TransferRecord, action: 'send' | 'receive' | 'cancel') => {
    setBusyId(transfer.id);
    try {
      if (action === 'send') await dataService.sendTransfer(transfer.id);
      if (action === 'receive') await dataService.receiveTransfer(transfer.id);
      if (action === 'cancel') await dataService.cancelTransfer(transfer.id);
      toast.success(action === 'send' ? 'Transferencia enviada desde el origen.' : action === 'receive' ? 'Transferencia recibida en destino.' : 'Transferencia cancelada.');
      await loadTransfers();
    } catch (error) { toastError(error, 'No se pudo actualizar la transferencia.'); }
    finally { setBusyId(null); }
  };

  return <Layout><div className="mx-auto max-w-7xl space-y-6">
    <PageTitle eyebrow="Bodega · Traslados" title="Traslados entre ubicaciones" description="Mueve inventario de una ubicación a otra con asignación por lotes y doble movimiento (salida y entrada) cuando se envía y recibe."/>

    <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
      <Card className="rounded-2xl border-border/70 p-5 shadow-sm sm:p-6">
        <form onSubmit={submit} className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label className="text-xs">Origen *</Label><select value={originId} onChange={event => setOriginId(event.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"><option value="">Selecciona origen…</option>{locations.map(location => <option key={location.id} value={location.id}>{location.code} · {location.label}</option>)}</select></div>
            <div className="space-y-1"><Label className="text-xs">Destino *</Label><select value={destinationId} onChange={event => setDestinationId(event.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"><option value="">Selecciona destino…</option>{locations.map(location => <option key={location.id} value={location.id}>{location.code} · {location.label}</option>)}</select></div>
          </div>
          <div className="space-y-2"><Label className="text-xs">Productos a trasladar</Label><div className="rounded-xl border border-border/70 p-3"><div className="mb-2 flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">Líneas</span><Button type="button" variant="outline" size="sm" onClick={() => setLines(current => [...current, newLine()])} className="rounded-lg"><CirclePlus className="mr-1 h-4 w-4"/>Línea</Button></div><div className="space-y-3">{lines.map(line => { const product = productById.get(line.productId); const lineLots = lots.filter(lot => lot.productId === line.productId); return <div key={line.key} className="grid gap-2 rounded-lg border border-border/60 bg-muted/20 p-2 sm:grid-cols-[1fr_120px_220px_36px]">
              <ProductSelect products={products} value={line.productId} onChange={value => changeProduct(line.key, value)} className="h-10"/>
              <div className="space-y-1"><Input type="number" min="0.001" step="0.001" value={line.quantity} onChange={event => updateLine(line.key, { quantity: event.target.value })} placeholder="Cant." className="h-10 rounded-lg"/></div>
              <LotSelect lots={lineLots} value={line.lotId} onChange={value => updateLine(line.key, { lotId: value })} className="h-10" placeholder="FEFO / sin lote específico"/>
              <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(line.key)} disabled={lines.length === 1} aria-label="Quitar línea" className="text-rose-600"><Trash2 className="h-4 w-4"/></Button>
              {product && <p className="text-xs text-muted-foreground sm:col-span-4">Stock disponible: {fmtQty(product.stock)} {product.unit}</p>}
            </div>; })}</div></div></div>
          <div className="space-y-1"><Label className="text-xs">Notas</Label><Textarea value={notes} onChange={event => setNotes(event.target.value)} rows={2} maxLength={1000} className="rounded-xl"/></div>
          <div className="flex justify-end"><Button type="submit" disabled={saving || loading || !permissions.canEntry} className="rounded-xl bg-orange-600 text-white hover:bg-orange-700"><Send className="mr-2 h-4 w-4"/>{saving ? 'Creando…' : 'Crear transferencia'}</Button></div>
        </form>
      </Card>

      <Card className="rounded-2xl border-border/70 p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Transferencias</h2><p className="mt-1 text-sm text-muted-foreground">{transfers.length} registro(s)</p></div><Button variant="outline" size="sm" onClick={() => void loadTransfers()} className="rounded-xl"><RefreshCw className="mr-2 h-4 w-4"/>Actualizar</Button></div>
        <div className="mt-4 max-h-[520px] space-y-3 overflow-y-auto pr-1">{transfers.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Sin transferencias registradas.</p> : transfers.map(transfer => <div key={transfer.id} className="rounded-xl border border-border/70 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold">{transfer.id}</p><p className="mt-1 text-xs text-muted-foreground">{transfer.originCode} → {transfer.destinationCode} · {transfer.createdByName || 'Sistema'}</p><p className="text-xs text-muted-foreground">{dateTime(transfer.createdAt)}</p></div><Badge variant="outline" className={statusMeta[transfer.status].className}>{statusMeta[transfer.status].label}</Badge></div>
              <div className="mt-3 overflow-x-auto rounded-lg border border-border/60"><table className="w-full min-w-[420px] text-xs"><thead className="bg-muted/40 text-left uppercase tracking-wide text-muted-foreground"><tr><th className="px-2 py-2 font-semibold">Producto</th><th className="px-2 py-2 text-right font-semibold">Cantidad</th><th className="px-2 py-2 font-semibold">Lote</th></tr></thead><tbody className="divide-y divide-border/60">{transfer.items.map(item => <tr key={item.id}><td className="px-2 py-2"><p className="font-medium">{item.productName}</p><p className="text-muted-foreground">{item.sku}</p></td><td className="px-2 py-2 text-right tabular-nums">{fmtQty(item.quantity)} {item.productUnit}</td><td className="px-2 py-2">{item.lotCode || 'FEFO'}</td></tr>)}</tbody></table></div>
              <div className="mt-3 flex flex-wrap gap-2">
                {transfer.status === 'draft' && permissions.canEntry && <Button size="sm" variant="outline" disabled={busyId === transfer.id} onClick={() => void runAction(transfer, 'send')} className="rounded-lg"><Send className="mr-1 h-4 w-4"/>Enviar</Button>}
                {transfer.status === 'in_transit' && permissions.canEntry && <Button size="sm" className="rounded-lg bg-orange-600 text-white hover:bg-orange-700" onClick={() => void runAction(transfer, 'receive')}><PackageCheck className="mr-1 h-4 w-4"/>Recibir en destino</Button>}
                {!['received', 'cancelled'].includes(transfer.status) && permissions.canEntry && <Button size="sm" variant="outline" disabled={busyId === transfer.id} onClick={() => void runAction(transfer, 'cancel')} className="rounded-lg border-rose-200 text-rose-700 hover:bg-rose-50">Cancelar</Button>}
              </div>
            </div>)}</div>
      </Card>
    </div>
  </div></Layout>;
}
