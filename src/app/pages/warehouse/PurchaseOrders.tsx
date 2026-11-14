import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CirclePlus, PackageCheck, RefreshCw, Save, Send, ShoppingCart, Trash2, Truck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../utils/notifications';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Badge } from '../../components/ui/badge';
import { dataService, type InventoryMovementRecord, type PurchaseOrderRecord, type SupplierPriceHistoryRecord } from '../../services/dataService';
import type { Product } from '../../utils/types';
import { dateOnly, dateTime, fmtQty, money, PageTitle, ProductSelect, useWarehousePermissions, useWarehouseRefs, withoutLine } from './shared';

type ReplenishmentItem = Product & { suggestedQuantity: number; lastCost: number; estimatedCost: number };

type OrderLine = { key: string; productId: string; quantity: string; unitCost: string; unit: string };
type ReceiveLine = { itemId: number; productName: string; productUnit: string; pending: number; quantity: string; unitCost: string; lotCode: string; expiryDate: string; locationId: string };

const newLine = (): OrderLine => ({ key: `${Date.now()}-${Math.random().toString(36).slice(2)}`, productId: '', quantity: '1', unitCost: '', unit: '' });
const statusMeta: Record<PurchaseOrderRecord['status'], { label: string; className: string }> = {
  draft: { label: 'Borrador', className: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300' },
  sent: { label: 'Enviada', className: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300' },
  partial: { label: 'Recibida parcial', className: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300' },
  received: { label: 'Recibida', className: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300' },
  cancelled: { label: 'Cancelada', className: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300' },
};

export function WarehousePurchaseOrders() {
  const { products, locations, suppliers, loading, reload } = useWarehouseRefs();
  const permissions = useWarehousePermissions();
  const [orders, setOrders] = useState<PurchaseOrderRecord[]>([]);
  const [priceHistory, setPriceHistory] = useState<SupplierPriceHistoryRecord[]>([]);
  const [recentPurchases, setRecentPurchases] = useState<InventoryMovementRecord[]>([]);
  const [replenishment, setReplenishment] = useState<ReplenishmentItem[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [supplierId, setSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<OrderLine[]>([newLine()]);
  const [saving, setSaving] = useState(false);

  const [receiving, setReceiving] = useState<PurchaseOrderRecord | null>(null);
  const [receiveLines, setReceiveLines] = useState<ReceiveLine[]>([]);
  const [invoiceRef, setInvoiceRef] = useState('');
  const [receiveNotes, setReceiveNotes] = useState('');
  const [receivingBusy, setReceivingBusy] = useState(false);

  const loadOrders = async () => {
    setLoadingOrders(true);
    try { setOrders(await dataService.getPurchaseOrders()); }
    catch (error) { toastError(error, 'No se pudieron cargar las órdenes de compra.'); }
    finally { setLoadingOrders(false); }
  };
  const loadSecondary = async () => {
    try {
      const [prices, movements, suggestions] = await Promise.all([dataService.getPriceHistory({ limit: 12 }), dataService.getInventoryMovements(200, undefined, { types: 'purchase' }), dataService.getReplenishment()]);
      setPriceHistory(prices); setRecentPurchases(movements); setReplenishment(suggestions);
    } catch { /* información complementaria */ }
  };
  useEffect(() => { void loadOrders(); void loadSecondary(); }, []);

  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const replenishmentTotal = replenishment.reduce((sum, item) => sum + item.estimatedCost, 0);
  const suggestionLine = (item: ReplenishmentItem): OrderLine => ({
    key: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    productId: item.id,
    quantity: String(Math.max(1, Math.ceil(item.suggestedQuantity))),
    unitCost: String(Math.round(item.lastCost || item.cost || 0)),
    unit: item.unit || '',
  });
  const addSuggestion = (item: ReplenishmentItem) => {
    setLines(current => {
      const existing = current.find(line => line.productId === item.id);
      if (existing) return current.map(line => line.productId === item.id ? { ...line, quantity: String((Number(line.quantity) || 0) + Math.max(1, Math.ceil(item.suggestedQuantity))) } : line);
      const filled = current.filter(line => line.productId || line.unitCost !== '' || Number(line.quantity) !== 1);
      return [...filled, suggestionLine(item)];
    });
    if (!supplierId && item.supplierId) setSupplierId(item.supplierId);
    toast.success(`${item.name} agregado a la orden de compra.`);
  };
  const applySuggestions = () => {
    if (!replenishment.length) return;
    setLines(replenishment.map(item => suggestionLine(item)));
    const supplier = replenishment.find(item => item.supplierId)?.supplierId;
    if (!supplierId && supplier) setSupplierId(supplier);
    toast.success(`${replenishment.length} producto(s) agregados a la orden. Revisa cantidades y costos antes de crearla.`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const filteredOrders = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es');
    return orders.filter(order => (statusFilter === 'all' || order.status === statusFilter) && (!term || `${order.id} ${order.supplierName} ${order.notes}`.toLocaleLowerCase('es').includes(term)));
  }, [orders, search, statusFilter]);
  const orderTotal = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitCost) || 0), 0);

  const updateLine = (key: string, patch: Partial<OrderLine>) => setLines(current => current.map(line => line.key === key ? { ...line, ...patch } : line));
  const removeLine = (key: string) => setLines(current => withoutLine(current, key));
  const changeProduct = (key: string, productId: string) => {
    const product = productById.get(productId);
    updateLine(key, { productId, unit: product?.unit || '', unitCost: String(product?.cost ?? 0) });
  };

  const createOrder = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supplierId) { toast.error('Selecciona un proveedor.'); return; }
    const invalid = lines.find(line => !line.productId || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0 || !Number.isFinite(Number(line.unitCost)) || Number(line.unitCost) < 0);
    if (invalid) { toast.error('Revisa las líneas: producto y cantidad son obligatorios y el costo no puede ser negativo.'); return; }
    setSaving(true);
    try {
      const order = await dataService.createPurchaseOrder({ supplierId, expectedDate: expectedDate || null, notes: notes.trim(), items: lines.map(line => ({ productId: line.productId, quantity: Number(line.quantity), unitCost: Number(line.unitCost), unit: line.unit || undefined })) });
      toast.success(`Orden ${order.id} creada en borrador.`);
      setSupplierId(''); setExpectedDate(''); setNotes(''); setLines([newLine()]);
      await loadOrders();
    } catch (error) { toastError(error, 'No se pudo crear la orden de compra.'); }
    finally { setSaving(false); }
  };

  const runAction = async (order: PurchaseOrderRecord, action: 'approve' | 'send' | 'cancel') => {
    setBusyId(order.id);
    try {
      if (action === 'approve') await dataService.approvePurchaseOrder(order.id);
      if (action === 'send') await dataService.sendPurchaseOrder(order.id);
      if (action === 'cancel') await dataService.cancelPurchaseOrder(order.id);
      toast.success(action === 'approve' ? 'Orden aprobada.' : action === 'send' ? 'Orden marcada como enviada al proveedor.' : 'Orden cancelada.');
      await loadOrders();
    } catch (error) { toastError(error, 'No se pudo actualizar la orden.'); }
    finally { setBusyId(null); }
  };

  const startReceiving = (order: PurchaseOrderRecord) => {
    setReceiving(order);
    setInvoiceRef(''); setReceiveNotes('');
    setReceiveLines(order.items.filter(item => item.pendingQuantity > 0).map(item => ({
      itemId: item.id, productName: item.productName, productUnit: item.productUnit, pending: item.pendingQuantity,
      quantity: String(item.pendingQuantity), unitCost: String(item.unitCost), lotCode: '', expiryDate: '', locationId: '',
    })));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const updateReceiveLine = (itemId: number, patch: Partial<ReceiveLine>) => setReceiveLines(current => current.map(line => line.itemId === itemId ? { ...line, ...patch } : line));
  const submitReceive = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!receiving) return;
    const valid = receiveLines.filter(line => Number.isFinite(Number(line.quantity)) && Number(line.quantity) > 0);
    if (!valid.length) { toast.error('Indica al menos una cantidad recibida mayor que cero.'); return; }
    if (valid.some(line => Number(line.quantity) > line.pending + 1e-9)) { toast.error('No puedes recibir más cantidad de la pendiente en una línea.'); return; }
    setReceivingBusy(true);
    try {
      const result = await dataService.receivePurchaseOrder(receiving.id, {
        invoiceRef: invoiceRef.trim(), notes: receiveNotes.trim(),
        items: valid.map(line => ({ itemId: line.itemId, quantity: Number(line.quantity), unitCost: line.unitCost === '' ? undefined : Number(line.unitCost), lotCode: line.lotCode.trim(), expiryDate: line.expiryDate || null, locationId: line.locationId || null })),
      });
      toast.success(result.status === 'received' ? 'Orden recibida completamente. El stock y los lotes se actualizaron.' : 'Recepción parcial registrada. Puedes recibir el resto después.');
      setReceiving(null); setReceiveLines([]);
      await Promise.all([loadOrders(), loadSecondary(), reload()]);
    } catch (error) { toastError(error, 'No se pudo registrar la recepción.'); }
    finally { setReceivingBusy(false); }
  };

  return <Layout><div className="mx-auto max-w-7xl space-y-6">
    <PageTitle eyebrow="Bodega · Compras" title="Órdenes de compra" description="Planifica compras, envíalas al proveedor y recibe mercancía de forma parcial o total. Cada recepción actualiza stock, lotes y el historial de precios." action={<Button variant="outline" onClick={() => { void loadOrders(); void loadSecondary(); }} disabled={loadingOrders} className="h-11 rounded-xl"><RefreshCw className={`mr-2 h-4 w-4 ${loadingOrders ? 'animate-spin' : ''}`}/>Actualizar</Button>}/>

    {replenishment.length > 0 && permissions.canEntry && <Card className="rounded-2xl border-blue-200 bg-blue-50/40 p-5 shadow-sm dark:border-blue-900 dark:bg-blue-950/20 sm:p-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
        <div><h2 className="flex items-center gap-2 font-semibold"><ShoppingCart className="h-5 w-5 text-blue-600"/>Sugerencias de reposición</h2><p className="mt-1 text-sm text-muted-foreground">{replenishment.length} producto(s) en o por debajo del mínimo. Basado en stock actual, mínimo configurado y consumo reciente.</p></div>
        <Button type="button" onClick={applySuggestions} className="rounded-xl bg-blue-600 text-white hover:bg-blue-700"><CirclePlus className="mr-2 h-4 w-4"/>Usar todas en la orden</Button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {replenishment.slice(0, 6).map(item => <div key={item.id} className="rounded-xl border border-blue-200/70 bg-card p-3 dark:border-blue-900/60">
          <p className="truncate font-semibold" title={item.name}>{item.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Stock {fmtQty(item.stock)} {item.unit} · mínimo {fmtQty(item.minStock)} {item.unit}</p>
          <div className="mt-2 flex items-center justify-between text-sm"><span className="text-muted-foreground">Sugerido</span><span className="font-semibold text-blue-700 dark:text-blue-300">{fmtQty(Math.max(1, Math.ceil(item.suggestedQuantity)))} {item.unit}</span></div>
          <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Último costo</span><span>{money(item.lastCost || item.cost || 0)}</span></div>
          <Button type="button" size="sm" variant="outline" onClick={() => addSuggestion(item)} className="mt-2 w-full rounded-lg"><CirclePlus className="mr-1 h-4 w-4"/>Agregar a la orden</Button>
        </div>)}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Costo estimado de todas las sugerencias: <span className="font-semibold text-foreground">{money(replenishmentTotal)}</span>. Ajusta cantidades antes de crear la orden.</p>
    </Card>}

    {receiving && <Card className="rounded-2xl border-orange-200 bg-orange-50/50 p-5 shadow-sm dark:border-orange-900 dark:bg-orange-950/20 sm:p-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row"><div><h2 className="flex items-center gap-2 font-semibold"><PackageCheck className="h-5 w-5 text-orange-600"/>Recibir orden {receiving.id}</h2><p className="mt-1 text-sm text-muted-foreground">{receiving.supplierName} · {receiving.pendingLines} línea(s) pendiente(s). Ajusta las cantidades que llegaron realmente.</p></div><Button type="button" variant="ghost" onClick={() => setReceiving(null)} className="rounded-xl">Cerrar</Button></div>
      <form onSubmit={submitReceive} className="mt-5 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><Label className="text-xs">Factura del proveedor</Label><Input value={invoiceRef} onChange={event => setInvoiceRef(event.target.value)} maxLength={120} placeholder="Número de factura" className="h-10 rounded-xl bg-card"/></div><div className="space-y-1"><Label className="text-xs">Notas de recepción</Label><Input value={receiveNotes} onChange={event => setReceiveNotes(event.target.value)} maxLength={1000} placeholder="Novedades, faltantes, estado…" className="h-10 rounded-xl bg-card"/></div></div>
        <div className="space-y-3">{receiveLines.map(line => <div key={line.itemId} className="rounded-xl border border-border/70 bg-card p-3"><div className="flex flex-wrap items-baseline justify-between gap-2"><p className="font-medium">{line.productName}</p><p className="text-xs text-muted-foreground">Pendiente: {fmtQty(line.pending)} {line.productUnit}</p></div><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1"><Label className="text-xs">Cantidad recibida *</Label><Input type="number" min="0" step="0.001" max={line.pending} value={line.quantity} onChange={event => updateReceiveLine(line.itemId, { quantity: event.target.value })} className="h-10 rounded-xl"/></div>
          <div className="space-y-1"><Label className="text-xs">Costo unitario</Label><Input type="number" min="0" step="1" value={line.unitCost} onChange={event => updateReceiveLine(line.itemId, { unitCost: event.target.value })} className="h-10 rounded-xl"/></div>
          <div className="space-y-1"><Label className="text-xs">Ubicación</Label><select value={line.locationId} onChange={event => updateReceiveLine(line.itemId, { locationId: event.target.value })} className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"><option value="">Por defecto</option>{locations.map(location => <option key={location.id} value={location.id}>{location.code}</option>)}</select></div>
          <div className="space-y-1"><Label className="text-xs">Lote</Label><Input value={line.lotCode} onChange={event => updateReceiveLine(line.itemId, { lotCode: event.target.value })} placeholder="Código de lote" className="h-10 rounded-xl"/></div>
          <div className="space-y-1"><Label className="text-xs">Vencimiento</Label><Input type="date" value={line.expiryDate} onChange={event => updateReceiveLine(line.itemId, { expiryDate: event.target.value })} className="h-10 rounded-xl"/></div>
        </div></div>)}</div>
        <div className="flex justify-end"><Button type="submit" disabled={receivingBusy} className="rounded-xl bg-orange-600 text-white hover:bg-orange-700"><PackageCheck className="mr-2 h-4 w-4"/>{receivingBusy ? 'Recibiendo…' : 'Confirmar recepción'}</Button></div>
      </form>
    </Card>}

    <div className="grid gap-5 xl:grid-cols-[1.05fr_.95fr]">
      <Card className="rounded-2xl border-border/70 p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600 dark:bg-orange-950/40"><ShoppingCart className="h-5 w-5"/></div><div><h2 className="font-semibold">Nueva orden de compra</h2><p className="text-xs text-muted-foreground">Se crea en borrador para revisión y aprobación.</p></div></div>
        {!permissions.canEntry ? <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">Tu rol no tiene permiso para registrar entradas u órdenes de compra.</div> : <form onSubmit={createOrder} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><Label className="text-xs">Proveedor *</Label><select value={supplierId} onChange={event => setSupplierId(event.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"><option value="">Selecciona un proveedor…</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.company || supplier.name}</option>)}</select></div><div className="space-y-1"><Label className="text-xs">Fecha esperada</Label><Input type="date" value={expectedDate} onChange={event => setExpectedDate(event.target.value)} className="h-11 rounded-xl"/></div></div>
          <div className="rounded-xl border border-border/70 p-3"><div className="mb-2 flex items-center justify-between gap-2"><Label className="text-xs">Productos *</Label><Button type="button" variant="outline" size="sm" onClick={() => setLines(current => [...current, newLine()])} className="rounded-lg"><CirclePlus className="mr-1 h-4 w-4"/>Línea</Button></div><div className="space-y-3">{lines.map(line => { const product = productById.get(line.productId); return <div key={line.key} className="grid gap-2 rounded-lg border border-border/60 bg-muted/20 p-2 sm:grid-cols-[1fr_100px_110px_36px]"><ProductSelect products={products} value={line.productId} onChange={value => changeProduct(line.key, value)} className="h-10"/><Input aria-label="Cantidad" type="number" min="0.001" step="0.001" value={line.quantity} onChange={event => updateLine(line.key, { quantity: event.target.value })} placeholder="Cant." className="h-10 rounded-lg"/><Input aria-label="Costo unitario" type="number" min="0" step="1" value={line.unitCost} onChange={event => updateLine(line.key, { unitCost: event.target.value })} placeholder="Costo" className="h-10 rounded-lg"/><Button type="button" variant="ghost" size="icon" onClick={() => removeLine(line.key)} disabled={lines.length === 1} aria-label="Quitar línea" className="text-rose-600"><Trash2 className="h-4 w-4"/></Button>{product && <p className="text-xs text-muted-foreground sm:col-span-4">Stock actual: {fmtQty(product.stock)} {product.unit} · Unidad de compra: {line.unit || product.unit}</p>}</div>; })}</div></div>
          <div className="space-y-1"><Label className="text-xs">Notas</Label><Textarea value={notes} onChange={event => setNotes(event.target.value)} rows={2} maxLength={1000} placeholder="Condiciones, plazo de entrega…" className="rounded-xl"/></div>
          <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-3"><p className="text-sm text-muted-foreground">Total estimado: <span className="font-bold text-foreground">{money(orderTotal)}</span></p><Button type="submit" disabled={saving || loading} className="rounded-xl bg-orange-600 text-white hover:bg-orange-700"><Save className="mr-2 h-4 w-4"/>{saving ? 'Creando…' : 'Crear orden'}</Button></div>
        </form>}
      </Card>

      <div className="space-y-5">
        <Card className="rounded-2xl border-border/70 p-5 shadow-sm"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40"><Truck className="h-5 w-5"/></div><div><h2 className="font-semibold">Últimos precios de proveedor</h2><p className="text-xs text-muted-foreground">Historial generado por entradas y recepciones</p></div></div>{priceHistory.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Aún no hay precios registrados.</p> : <div className="mt-3 space-y-2">{priceHistory.slice(0, 8).map(price => <div key={price.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-2 text-sm"><div className="min-w-0"><p className="truncate font-medium">{price.productName}</p><p className="truncate text-xs text-muted-foreground">{price.supplierName || 'Sin proveedor'} · {dateOnly(price.createdAt)}</p></div><div className="text-right"><p className="font-semibold">{money(price.unitCost)}</p><p className="text-xs text-muted-foreground">/{price.productUnit}</p></div></div>)}</div>}</Card>
        <Card className="rounded-2xl border-border/70 p-5 shadow-sm"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40"><PackageCheck className="h-5 w-5"/></div><div><h2 className="font-semibold">Compras recibidas recientes</h2><p className="text-xs text-muted-foreground">Entradas de inventario por recepción</p></div></div>{recentPurchases.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Aún no se han recibido compras.</p> : <div className="mt-3 space-y-2">{recentPurchases.slice(0, 8).map(movement => <div key={movement.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-2 text-sm"><div className="min-w-0"><p className="truncate font-medium">{movement.productName}</p><p className="truncate text-xs text-muted-foreground">{movement.reason || movement.note} · {dateTime(movement.createdAt)}</p></div><p className="shrink-0 font-semibold text-emerald-700">+{fmtQty(movement.quantityDelta)}</p></div>)}</div>}</Card>
      </div>
    </div>

    <Card className="overflow-hidden rounded-2xl border-border/70 shadow-sm">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center"><div className="flex-1"><h2 className="font-semibold">Órdenes registradas</h2><p className="mt-1 text-xs text-muted-foreground">{filteredOrders.length} orden(es) · {orders.filter(order => order.status === 'sent').length} enviadas · {orders.filter(order => order.status === 'partial').length} parciales</p></div><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar orden o proveedor…" className="h-10 rounded-xl sm:max-w-xs"/><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="h-10 rounded-xl border border-input bg-background px-3 text-sm"><option value="all">Todos los estados</option>{Object.entries(statusMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select></div>
      {loadingOrders ? <div className="p-10 text-center text-sm text-muted-foreground">Cargando órdenes…</div> : filteredOrders.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">No hay órdenes que coincidan con el filtro.</div> : <div className="divide-y divide-border/60">{filteredOrders.map(order => <div key={order.id} className="p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{order.id}</p><Badge variant="outline" className={statusMeta[order.status].className}>{statusMeta[order.status].label}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{order.supplierName || 'Sin proveedor'} · {order.supplierContact || 'Sin contacto'} · Creada {dateTime(order.createdAt)}{order.expectedDate ? ` · Esperada ${dateOnly(order.expectedDate)}` : ''}</p>{order.notes && <p className="mt-1 text-xs text-muted-foreground">{order.notes}</p>}</div><div className="flex flex-wrap items-center gap-2"><p className="mr-2 text-lg font-bold">{money(order.total)}</p>
          {order.status === 'draft' && permissions.canApprovePurchases && <Button size="sm" variant="outline" disabled={busyId === order.id} onClick={() => void runAction(order, 'approve')}><CheckCircle2 className="mr-1 h-4 w-4"/>Aprobar</Button>}
          {order.status === 'draft' && permissions.canApprovePurchases && <Button size="sm" variant="outline" disabled={busyId === order.id} onClick={() => void runAction(order, 'send')}><Send className="mr-1 h-4 w-4"/>Enviar</Button>}
          {(order.status === 'sent' || order.status === 'partial') && permissions.canEntry && <Button size="sm" className="bg-orange-600 text-white hover:bg-orange-700" onClick={() => startReceiving(order)}><PackageCheck className="mr-1 h-4 w-4"/>Recibir</Button>}
          {(order.status === 'draft' || order.status === 'sent') && permissions.canApprovePurchases && <Button size="sm" variant="outline" disabled={busyId === order.id} onClick={() => void runAction(order, 'cancel')} className="border-rose-200 text-rose-700 hover:bg-rose-50"><XCircle className="mr-1 h-4 w-4"/>Cancelar</Button>}
        </div></div>
        <div className="mt-4 overflow-x-auto rounded-xl border border-border/60"><table className="w-full min-w-[640px] text-sm"><thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-2 font-semibold">Producto</th><th className="px-3 py-2 text-right font-semibold">Pedido</th><th className="px-3 py-2 text-right font-semibold">Recibido</th><th className="px-3 py-2 text-right font-semibold">Pendiente</th><th className="px-3 py-2 text-right font-semibold">Costo</th><th className="px-3 py-2 text-right font-semibold">Total</th></tr></thead><tbody className="divide-y divide-border/60">{order.items.map(item => <tr key={item.id}><td className="px-3 py-2"><p className="font-medium">{item.productName}</p><p className="text-xs text-muted-foreground">{item.sku}</p></td><td className="px-3 py-2 text-right tabular-nums">{fmtQty(item.quantityOrdered)} {item.unit}</td><td className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmtQty(item.quantityReceived)}</td><td className={`px-3 py-2 text-right font-semibold tabular-nums ${item.pendingQuantity > 0 ? 'text-amber-700' : 'text-muted-foreground'}`}>{fmtQty(item.pendingQuantity)}</td><td className="px-3 py-2 text-right tabular-nums">{money(item.unitCost)}</td><td className="px-3 py-2 text-right font-semibold tabular-nums">{money(item.lineTotal)}</td></tr>)}</tbody></table></div>
      </div>)}</div>}
    </Card>
  </div></Layout>;
}
