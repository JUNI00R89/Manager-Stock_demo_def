import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, CirclePlus, PackageCheck, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { dataService, type InventoryMovementRecord } from '../../services/dataService';
import type { Product } from '../../utils/mockData';
import { BarcodeScan, dateTime, fmtQty, money, PageTitle, ProductSelect, useWarehouseRefs } from './shared';

type EntryLine = {
  key: string;
  productId: string;
  quantity: string;
  unit: string;
  unitCost: string;
  lotCode: string;
  expiryDate: string;
  locationId: string;
};

const newLine = (): EntryLine => ({ key: `${Date.now()}-${Math.random().toString(36).slice(2)}`, productId: '', quantity: '1', unit: '', unitCost: '', lotCode: '', expiryDate: '', locationId: '' });
const entryTypeLabels = {
  purchase: 'Compra a proveedor',
  customer_return: 'Devolución de cliente',
  donation: 'Donación recibida',
  opening: 'Existencias iniciales',
} as const;

export function WarehouseEntries() {
  const { products, locations, suppliers, loading, reload } = useWarehouseRefs();
  const [entryType, setEntryType] = useState<keyof typeof entryTypeLabels>('purchase');
  const [supplierId, setSupplierId] = useState('');
  const [reference, setReference] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<EntryLine[]>([newLine()]);
  const [saving, setSaving] = useState(false);
  const [recent, setRecent] = useState<InventoryMovementRecord[]>([]);

  const loadRecent = async () => {
    try { setRecent(await dataService.getInventoryMovements(300, undefined, { types: 'purchase,customer_return,donation,opening' })); }
    catch { /* el historial es informativo */ }
  };
  useEffect(() => { void loadRecent(); }, []);

  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const totalUnits = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
  const totalCost = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitCost) || 0), 0);

  const updateLine = (key: string, patch: Partial<EntryLine>) => setLines(current => current.map(line => line.key === key ? { ...line, ...patch } : line));
  const changeProduct = (key: string, productId: string) => {
    const product = productById.get(productId);
    updateLine(key, {
      productId,
      unit: product?.unit || '',
      unitCost: product ? String(product.cost ?? 0) : '',
      locationId: product?.defaultLocationId || '',
    });
  };
  const addLine = () => setLines(current => [...current, newLine()]);
  const removeLine = (key: string) => setLines(current => current.length === 1 ? current : current.filter(line => line.key !== key));
  const addScannedProduct = (scanned: Product[]) => {
    const product = scanned[0];
    if (!product) return;
    setLines(current => [...current, { ...newLine(), productId: product.id, unit: product.unit || '', unitCost: String(product.cost ?? 0), locationId: product.defaultLocationId || '' }]);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!lines.length) { toast.error('Agrega al menos un producto.'); return; }
    const invalid = lines.find(line => !line.productId || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0 || (line.unitCost !== '' && (!Number.isFinite(Number(line.unitCost)) || Number(line.unitCost) < 0)));
    if (invalid) { toast.error('Revisa los productos y cantidades: deben ser mayores que cero y el costo no puede ser negativo.'); return; }
    if (entryType === 'purchase' && !supplierId) { toast.error('Selecciona el proveedor de la compra.'); return; }
    setSaving(true);
    try {
      const operation = await dataService.createInventoryEntry({
        entryType,
        supplierId: entryType === 'purchase' && supplierId ? supplierId : null,
        reference: reference.trim(),
        invoiceRef: invoiceRef.trim(),
        notes: notes.trim(),
        items: lines.map(line => ({
          productId: line.productId,
          quantity: Number(line.quantity),
          unit: line.unit || undefined,
          unitCost: line.unitCost === '' ? undefined : Number(line.unitCost),
          lotCode: line.lotCode.trim().toUpperCase(),
          expiryDate: line.expiryDate || null,
          locationId: line.locationId || null,
        })),
      });
      toast.success(`Entrada ${operation.id} registrada con ${operation.items.length} movimiento(s).`);
      setReference(''); setInvoiceRef(''); setNotes(''); setLines([newLine()]); setSupplierId('');
      await Promise.all([reload(), loadRecent()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar la entrada.');
    } finally { setSaving(false); }
  };

  return <Layout><div className="mx-auto max-w-7xl space-y-6">
    <PageTitle eyebrow="Bodega · Entradas" title="Registrar entrada de inventario" description="Compras, devoluciones de clientes, donaciones y existencias iniciales. Cada línea actualiza el stock y queda trazada con usuario, fecha, lote y costo."/>

    <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <Card className="rounded-2xl border-border/70 p-5 shadow-sm sm:p-6">
        <form onSubmit={submit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="entry-type">Tipo de entrada *</Label><select id="entry-type" value={entryType} onChange={event => setEntryType(event.target.value as keyof typeof entryTypeLabels)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">{Object.entries(entryTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            <div className="space-y-2"><Label htmlFor="supplier">Proveedor {entryType === 'purchase' ? '*' : '(opcional)'}</Label><select id="supplier" value={supplierId} onChange={event => setSupplierId(event.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"><option value="">{entryType === 'purchase' ? 'Selecciona un proveedor…' : 'Sin proveedor'}</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.company || supplier.name}</option>)}</select></div>
            <div className="space-y-2"><Label htmlFor="reference">Referencia / documento</Label><Input id="reference" value={reference} onChange={event => setReference(event.target.value)} maxLength={120} placeholder="Ej. Factura o remisión" className="h-11 rounded-xl"/></div>
            <div className="space-y-2"><Label htmlFor="invoice">Factura del proveedor</Label><Input id="invoice" value={invoiceRef} onChange={event => setInvoiceRef(event.target.value)} maxLength={120} placeholder="Número de factura" className="h-11 rounded-xl"/></div>
          </div>

          <div className="rounded-2xl border border-border/70 p-4"><div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="font-semibold">Productos de la entrada</h2><p className="mt-1 text-xs text-muted-foreground">El costo se actualiza como último costo del producto. Si el producto maneja lotes, registra código y vencimiento.</p></div><Button type="button" variant="outline" onClick={addLine} className="h-9 shrink-0 rounded-lg"><CirclePlus className="mr-2 h-4 w-4"/>Agregar línea</Button></div>
            <div className="space-y-3">{lines.map((line, index) => {
              const product = productById.get(line.productId);
              return <div key={line.key} className="rounded-xl border border-border/70 bg-muted/20 p-3"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1 sm:col-span-2 lg:col-span-4"><Label className="text-xs">Producto *</Label><ProductSelect products={products} value={line.productId} onChange={value => changeProduct(line.key, value)}/></div>
                <div className="space-y-1"><Label className="text-xs">Cantidad *</Label><Input type="number" min="0.001" step="0.001" value={line.quantity} onChange={event => updateLine(line.key, { quantity: event.target.value })} className="h-11 rounded-xl bg-card"/>{product && <p className="text-xs text-muted-foreground">Stock actual: {fmtQty(product.stock)} {product.unit}</p>}</div>
                <div className="space-y-1"><Label className="text-xs">Unidad</Label><Input value={line.unit} onChange={event => updateLine(line.key, { unit: event.target.value })} placeholder={product?.unit || 'unidad'} className="h-11 rounded-xl bg-card"/></div>
                <div className="space-y-1"><Label className="text-xs">Costo unitario (COP)</Label><Input type="number" min="0" step="1" value={line.unitCost} onChange={event => updateLine(line.key, { unitCost: event.target.value })} placeholder={String(product?.cost ?? 0)} className="h-11 rounded-xl bg-card"/></div>
                <div className="space-y-1"><Label className="text-xs">Ubicación</Label><select value={line.locationId} onChange={event => updateLine(line.key, { locationId: event.target.value })} className="h-11 w-full rounded-xl border border-input bg-card px-3 text-sm"><option value="">Ubicación por defecto</option>{locations.map(location => <option key={location.id} value={location.id}>{location.code} · {location.label}</option>)}</select></div>
                <div className="space-y-1"><Label className="text-xs">Lote</Label><Input value={line.lotCode} onChange={event => updateLine(line.key, { lotCode: event.target.value })} placeholder="Ej. L-2026-001" className="h-11 rounded-xl bg-card"/></div>
                <div className="space-y-1"><Label className="text-xs">Vencimiento</Label><Input type="date" value={line.expiryDate} onChange={event => updateLine(line.key, { expiryDate: event.target.value })} className="h-11 rounded-xl bg-card"/></div>
                <div className="flex items-end justify-between gap-2 sm:col-span-2 lg:col-span-4"><p className="text-xs text-muted-foreground">Línea {index + 1}{line.unitCost !== '' ? ` · Total ${money((Number(line.quantity) || 0) * (Number(line.unitCost) || 0))}` : ''}</p><Button type="button" variant="ghost" size="icon" onClick={() => removeLine(line.key)} disabled={lines.length === 1} aria-label="Quitar línea" className="text-rose-600"><Trash2 className="h-4 w-4"/></Button></div>
              </div></div>;
            })}</div>
          </div>

          <div className="space-y-2"><Label htmlFor="notes">Notas (opcional)</Label><Textarea id="notes" value={notes} onChange={event => setNotes(event.target.value)} rows={3} maxLength={1000} placeholder="Observaciones de la recepción, estado de la mercancía…" className="rounded-xl"/></div>

          <div className="flex flex-col gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between"><div className="text-sm text-muted-foreground">{lines.length} línea(s) · {fmtQty(totalUnits)} unidades · <span className="font-semibold text-foreground">{money(totalCost)}</span></div><Button type="submit" disabled={saving || loading} className="rounded-xl bg-orange-600 text-white hover:bg-orange-700"><Save className="mr-2 h-4 w-4"/>{saving ? 'Registrando…' : 'Registrar entrada'}</Button></div>
        </form>
      </Card>

      <div className="space-y-5">
        <Card className="rounded-2xl border-border/70 p-5 shadow-sm"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600 dark:bg-orange-950/40"><PackageCheck className="h-5 w-5"/></div><div><h2 className="font-semibold">Escáner de códigos</h2><p className="text-xs text-muted-foreground">Busca por código de barras o SKU y agrega la línea.</p></div></div><div className="mt-4"><BarcodeScan onProducts={addScannedProduct}/></div></Card>

        <Card className="overflow-hidden rounded-2xl border-border/70 shadow-sm"><div className="border-b border-border p-5"><h2 className="font-semibold">Últimas entradas</h2><p className="mt-1 text-sm text-muted-foreground">Movimientos recientes de compra, devolución, donación o apertura</p></div><div className="max-h-[420px] divide-y divide-border/60 overflow-y-auto">{recent.length === 0 ? <p className="p-6 text-sm text-muted-foreground">Aún no hay entradas registradas.</p> : recent.slice(0, 20).map(movement => <div key={movement.id} className="flex items-start gap-3 p-4"><span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40"><ArrowDownToLine className="h-4 w-4"/></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{movement.productName}</p><p className="truncate text-xs text-muted-foreground">{movement.reason || movement.note || movement.movementType} · {dateTime(movement.createdAt)}</p></div><div className="shrink-0 text-right"><p className="text-sm font-semibold text-emerald-700">+{fmtQty(movement.quantityDelta)}</p><p className="text-xs text-muted-foreground">{movement.createdByName || ''}</p></div></div>)}</div></Card>

        <Card className="rounded-2xl border-border/70 p-5 text-sm text-muted-foreground"><div className="flex items-start gap-3"><ArrowUpFromLine className="mt-0.5 h-4 w-4 shrink-0 text-orange-600"/><p>Las entradas de compra actualizan el último costo y alimentan el historial de precios del proveedor. Los lotes se consumen automáticamente por FEFO en ventas y salidas.</p></div></Card>
      </div>
    </div>
  </div></Layout>;
}
