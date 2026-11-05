import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, CirclePlus, Scale, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { dataService, type InventoryMovementRecord } from '../../services/dataService';
import { dateTime, fmtQty, PageTitle, ProductSelect, useWarehouseRefs } from './shared';

type AdjustmentLine = { key: string; productId: string; quantityDelta: string; unit: string };
const newLine = (): AdjustmentLine => ({ key: `${Date.now()}-${Math.random().toString(36).slice(2)}`, productId: '', quantityDelta: '', unit: '' });
const quickReasons = ['Conteo físico', 'Producto dañado', 'Error de digitación', 'Corrección de lote', 'Vencimiento'];

export function WarehouseAdjustments() {
  const { products, loading, reload } = useWarehouseRefs();
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<AdjustmentLine[]>([newLine()]);
  const [recent, setRecent] = useState<InventoryMovementRecord[]>([]);
  const [saving, setSaving] = useState(false);

  const loadRecent = async () => {
    try { setRecent(await dataService.getInventoryMovements(300, undefined, { types: 'adjustment,count_adjustment' })); }
    catch { /* informativo */ }
  };
  useEffect(() => { void loadRecent(); }, []);

  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const validLines = lines.filter(line => line.productId && Number.isFinite(Number(line.quantityDelta)) && Math.abs(Number(line.quantityDelta)) > 0);
  const totalDelta = validLines.reduce((sum, line) => sum + Number(line.quantityDelta), 0);

  const updateLine = (key: string, patch: Partial<AdjustmentLine>) => setLines(current => current.map(line => line.key === key ? { ...line, ...patch } : line));
  const removeLine = (key: string) => setLines(current => current.length === 1 ? current : current.filter(line => line.key !== key));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (reason.trim().length < 3) { toast.error('El motivo del ajuste es obligatorio (mínimo 3 caracteres).'); return; }
    if (!validLines.length) { toast.error('Agrega al menos una línea con una variación distinta de cero.'); return; }
    setSaving(true);
    try {
      const operation = await dataService.createInventoryAdjustment({
        reason: reason.trim(),
        notes: notes.trim(),
        items: validLines.map(line => ({ productId: line.productId, quantityDelta: Number(line.quantityDelta), unit: line.unit || undefined })),
      });
      toast.success(`Ajuste ${operation.id} registrado con ${operation.items.length} movimiento(s).`);
      setReason(''); setNotes(''); setLines([newLine()]);
      await Promise.all([reload(), loadRecent()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar el ajuste.');
    } finally { setSaving(false); }
  };

  return <Layout><div className="mx-auto max-w-7xl space-y-6">
    <PageTitle eyebrow="Bodega · Ajustes" title="Ajustar existencias" description="Registra diferencias con un motivo obligatorio. Cada ajuste conserva existencias anteriores y posteriores, usuario, fecha y trazabilidad."/>

    <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <Card className="rounded-2xl border-border/70 p-5 shadow-sm sm:p-6">
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2"><Label htmlFor="reason">Motivo del ajuste *</Label><Input id="reason" value={reason} onChange={event => setReason(event.target.value)} maxLength={300} required minLength={3} placeholder="Explica por qué cambia el inventario" className="h-11 rounded-xl"/><div className="flex flex-wrap gap-2 pt-1">{quickReasons.map(item => <button key={item} type="button" onClick={() => setReason(item)} className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition hover:border-orange-300 hover:text-orange-700">{item}</button>)}</div></div>

          <div className="rounded-2xl border border-border/70 p-4"><div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="font-semibold">Productos y variación</h2><p className="mt-1 text-xs text-muted-foreground">Usa valores positivos para aumentar y negativos para disminuir, por ejemplo -2 o 1.5.</p></div><Button type="button" variant="outline" onClick={() => setLines(current => [...current, newLine()])} className="h-9 shrink-0 rounded-lg"><CirclePlus className="mr-2 h-4 w-4"/>Agregar línea</Button></div>
            <div className="space-y-3">{lines.map(line => {
              const product = productById.get(line.productId);
              const delta = Number(line.quantityDelta) || 0;
              const after = product ? product.stock + delta : null;
              return <div key={line.key} className="rounded-xl border border-border/70 bg-muted/20 p-3"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Producto *</Label><ProductSelect products={products} value={line.productId} onChange={value => { const selected = productById.get(value); updateLine(line.key, { productId: value, unit: selected?.unit || '' }); }}/></div>
                <div className="space-y-1"><Label className="text-xs">Variación *</Label><Input type="number" step="0.001" value={line.quantityDelta} onChange={event => updateLine(line.key, { quantityDelta: event.target.value })} placeholder="Ej. -2 o 3" className="h-11 rounded-xl bg-card"/></div>
                <div className="space-y-1"><Label className="text-xs">Unidad</Label><Input value={line.unit} onChange={event => updateLine(line.key, { unit: event.target.value })} placeholder={product?.unit || 'unidad'} className="h-11 rounded-xl bg-card"/></div>
                <div className="flex items-end justify-between gap-2 sm:col-span-2 lg:col-span-4"><div className="text-xs text-muted-foreground">{product ? <>Stock actual: <strong>{fmtQty(product.stock)} {product.unit}</strong>{after !== null && <> · Después del ajuste: <strong className={after < 0 ? 'text-rose-600' : ''}>{fmtQty(after)} {product.unit}</strong></>}</> : 'Selecciona un producto para ver el efecto.'}</div><Button type="button" variant="ghost" size="icon" onClick={() => removeLine(line.key)} disabled={lines.length === 1} aria-label="Quitar línea" className="text-rose-600"><Trash2 className="h-4 w-4"/></Button></div>
              </div></div>;
            })}</div>
          </div>

          <div className="space-y-2"><Label htmlFor="notes">Notas (opcional)</Label><Textarea id="notes" value={notes} onChange={event => setNotes(event.target.value)} rows={3} maxLength={1000} placeholder="Soporte del ajuste, novedades encontradas, responsable del conteo…" className="rounded-xl"/></div>

          <div className="flex flex-col gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between"><div className="text-sm text-muted-foreground">{validLines.length} línea(s) · Variación neta: <span className={`font-semibold ${totalDelta < 0 ? 'text-rose-600' : totalDelta > 0 ? 'text-emerald-700' : 'text-foreground'}`}>{totalDelta > 0 ? '+' : ''}{fmtQty(totalDelta)}</span></div><Button type="submit" disabled={saving || loading} className="rounded-xl bg-orange-600 text-white hover:bg-orange-700"><Save className="mr-2 h-4 w-4"/>{saving ? 'Registrando…' : 'Registrar ajuste'}</Button></div>
        </form>
      </Card>

      <div className="space-y-5">
        <Card className="rounded-2xl border-border/70 p-5 shadow-sm"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600 dark:bg-orange-950/40"><Scale className="h-5 w-5"/></div><div><h2 className="font-semibold">Ajustes y conteos recientes</h2><p className="text-xs text-muted-foreground">Trazabilidad de las últimas correcciones</p></div></div></Card>
        <Card className="overflow-hidden rounded-2xl border-border/70 shadow-sm"><div className="max-h-[520px] divide-y divide-border/60 overflow-y-auto">{recent.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No hay ajustes registrados.</p> : recent.slice(0, 25).map(movement => <div key={movement.id} className="flex items-start gap-3 p-4"><span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${movement.quantityDelta >= 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40' : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40'}`}><ArrowDownUp className="h-4 w-4"/></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{movement.productName}</p><p className="truncate text-xs text-muted-foreground">{movement.reason || movement.note} · {dateTime(movement.createdAt)}{movement.createdByName ? ` · ${movement.createdByName}` : ''}</p></div><div className="shrink-0 text-right"><p className={`text-sm font-semibold ${movement.quantityDelta >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{movement.quantityDelta > 0 ? '+' : ''}{fmtQty(movement.quantityDelta)}</p><p className="text-xs text-muted-foreground">{fmtQty(movement.stockAfter)}</p></div></div>)}</div></Card>
      </div>
    </div>
  </div></Layout>;
}
