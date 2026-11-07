import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowDownLeft, ArrowUpRight, ClipboardList, Download, PackageMinus, RefreshCw, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../utils/notifications';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { dataService, type InventoryMovementRecord, type InventoryMovementType } from '../../services/dataService';
import { dateTime, fmtQty, money, PageTitle, StatCard, useWarehouseRefs } from '../warehouse/shared';

const typeLabels: Record<InventoryMovementType, string> = {
  opening: 'Existencias iniciales',
  purchase: 'Compra / entrada',
  customer_return: 'Devolución de cliente',
  donation: 'Donación',
  sale: 'Venta',
  sale_cancelled: 'Reversión de venta',
  recipe_consumption: 'Consumo de receta',
  consumption: 'Consumo interno',
  adjustment: 'Ajuste manual',
  transfer_in: 'Traslado recibido',
  transfer_out: 'Traslado enviado',
  waste: 'Merma',
  count_adjustment: 'Ajuste por conteo',
  production: 'Producción',
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const dateFromFor = (range: string) => {
  if (range === 'all') return undefined;
  if (range === 'today') return todayIso();
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
};

const typeTone = (row: InventoryMovementRecord) => {
  if (row.movementType === 'waste') return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300';
  if (row.quantityDelta > 0) return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300';
  if (row.quantityDelta < 0) return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300';
  return 'border-border bg-muted text-muted-foreground';
};

const referenceFor = (row: InventoryMovementRecord) => {
  if (row.referenceType && row.referenceId) return `${row.referenceType} · ${row.referenceId}`;
  return row.saleId || row.referenceId || '—';
};

export function Movements() {
  const { products, locations } = useWarehouseRefs();
  const [searchParams, setSearchParams] = useSearchParams();
  const productId = searchParams.get('productId') || '';
  const [rows, setRows] = useState<InventoryMovementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [range, setRange] = useState('all');
  const [locationId, setLocationId] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await dataService.getInventoryMovements(3000, productId || undefined, {
        types: type !== 'all' ? type : undefined,
        search: search.trim() || undefined,
        dateFrom: dateFromFor(range),
        dateTo: range !== 'all' ? todayIso() : undefined,
        locationId: locationId !== 'all' ? locationId : undefined,
      });
      setRows(data);
    } catch (error) {
      toastError(error, 'No se pudieron cargar los movimientos.');
    } finally {
      setLoading(false);
    }
  }, [productId, search, type, range, locationId]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 300);
    return () => clearTimeout(timer);
  }, [load]);

  const selectedProduct = useMemo(() => products.find(product => product.id === productId), [products, productId]);

  const changeProduct = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('productId', value);
    else next.delete('productId');
    setSearchParams(next, { replace: true });
  };

  const incoming = rows.reduce((sum, row) => row.quantityDelta > 0 ? sum + row.quantityDelta : sum, 0);
  const outgoing = rows.reduce((sum, row) => row.quantityDelta < 0 ? sum - row.quantityDelta : sum, 0);
  const wasteCost = rows.filter(row => row.movementType === 'waste').reduce((sum, row) => sum + Math.abs(row.quantityDelta) * (row.unitCost || 0), 0);

  const exportCsv = () => {
    const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const csv = [
      ['Fecha', 'Producto', 'SKU', 'Tipo', 'Cantidad', 'Unidad', 'Stock antes', 'Stock después', 'Costo unitario', 'Lote', 'Ubicación', 'Usuario', 'Motivo / nota', 'Referencia'],
      ...rows.map(row => [
        new Date(row.createdAt).toISOString(), row.productName, row.sku || '', typeLabels[row.movementType],
        row.quantityDelta, row.productUnit || '', row.stockBefore, row.stockAfter, row.unitCost || 0,
        row.lotCode || '', row.locationCode || '', row.createdByName || '', row.reason || row.note || '', referenceFor(row),
      ]),
    ];
    const blob = new Blob(['\ufeff', csv.map(line => line.map(quote).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `movimientos-inventario-${todayIso()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return <Layout><div className="mx-auto max-w-7xl space-y-6">
    <PageTitle
      eyebrow="Bodega · Trazabilidad"
      title="Historial de movimientos"
      description="Quién, cuándo, qué producto, cuánto y por qué. Cada entrada, salida, merma, ajuste, traslado y consumo de receta queda registrado."
      action={<div className="flex gap-2"><Button variant="outline" onClick={exportCsv} disabled={!rows.length} className="h-11 rounded-xl"><Download className="mr-2 h-4 w-4"/>CSV</Button><Button variant="outline" onClick={() => void load()} disabled={loading} className="h-11 rounded-xl"><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`}/>Actualizar</Button></div>}
    />

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Movimientos" value={rows.length} hint="Con los filtros actuales" icon={ClipboardList} tone="blue"/>
      <StatCard label="Unidades de entrada" value={`+${fmtQty(incoming)}`} hint="Compras, devoluciones, donaciones y traslados recibidos" icon={ArrowDownLeft} tone="emerald"/>
      <StatCard label="Unidades de salida" value={`-${fmtQty(outgoing)}`} hint="Ventas, consumo, mermas y traslados enviados" icon={ArrowUpRight} tone="rose"/>
      <StatCard label="Costo de merma" value={money(wasteCost)} hint="Valor de las unidades dadas de baja" icon={PackageMinus} tone="amber"/>
    </div>

    <Card className="rounded-2xl border-border/70 p-4 shadow-sm">
      <div className="grid gap-3 lg:grid-cols-[1fr_190px_190px_170px_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/>
          <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar producto, SKU, nota, motivo o referencia…" className="h-11 rounded-xl pl-9"/>
        </div>
        <select value={type} onChange={event => setType(event.target.value)} className="h-11 rounded-xl border border-input bg-background px-3 text-sm">
          <option value="all">Todos los tipos</option>
          {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={locationId} onChange={event => setLocationId(event.target.value)} className="h-11 rounded-xl border border-input bg-background px-3 text-sm">
          <option value="all">Todas las ubicaciones</option>
          {locations.map(location => <option key={location.id} value={location.id}>{location.code} · {location.label}</option>)}
        </select>
        <select value={range} onChange={event => setRange(event.target.value)} className="h-11 rounded-xl border border-input bg-background px-3 text-sm">
          <option value="all">Todo el historial</option>
          <option value="today">Hoy</option>
          <option value="7d">Últimos 7 días</option>
          <option value="30d">Últimos 30 días</option>
          <option value="90d">Últimos 90 días</option>
        </select>
        <Button variant="outline" onClick={() => void load()} disabled={loading} className="h-11 rounded-xl"><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`}/>Aplicar</Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex min-w-[240px] items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Producto</span>
          <select value={productId} onChange={event => changeProduct(event.target.value)} className="h-10 flex-1 rounded-xl border border-input bg-background px-3 text-sm">
            <option value="">Todos los productos</option>
            {products.map(product => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}
          </select>
        </div>
        {selectedProduct && <Badge variant="outline" className="gap-1 rounded-lg border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300">Filtrado por {selectedProduct.name}<button type="button" onClick={() => changeProduct('')} aria-label="Quitar filtro de producto" className="ml-1 rounded-full p-0.5 hover:bg-orange-100"><X className="h-3 w-3"/></button></Badge>}
        {rows.length >= 3000 && <span className="text-xs text-muted-foreground">Mostrando los 3.000 movimientos más recientes. Usa los filtros para acotar el resultado.</span>}
      </div>
    </Card>

    <Card className="overflow-hidden rounded-2xl border-border/70 shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-semibold">Fecha</th>
              <th className="px-4 py-3 font-semibold">Producto</th>
              <th className="px-4 py-3 font-semibold">Movimiento</th>
              <th className="px-4 py-3 text-right font-semibold">Cantidad</th>
              <th className="px-4 py-3 text-right font-semibold">Stock</th>
              <th className="px-4 py-3 font-semibold">Lote</th>
              <th className="px-4 py-3 font-semibold">Ubicación</th>
              <th className="px-4 py-3 font-semibold">Usuario</th>
              <th className="px-4 py-3 font-semibold">Motivo / referencia</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {loading ? <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">Cargando movimientos…</td></tr> : rows.length === 0 ? <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">No hay movimientos que coincidan con los filtros.</td></tr> : rows.map(row => <tr key={row.id} className="transition hover:bg-muted/20">
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{dateTime(row.createdAt)}</td>
              <td className="px-4 py-3"><p className="font-semibold">{row.productName}</p><p className="mt-0.5 text-xs text-muted-foreground">SKU {row.sku || '—'}</p></td>
              <td className="px-4 py-3"><Badge variant="outline" className={`rounded-lg ${typeTone(row)}`}>{typeLabels[row.movementType]}</Badge></td>
              <td className={`px-4 py-3 text-right font-semibold tabular-nums ${row.quantityDelta > 0 ? 'text-emerald-700 dark:text-emerald-400' : row.quantityDelta < 0 ? 'text-rose-700 dark:text-rose-400' : ''}`}>{row.quantityDelta > 0 ? '+' : ''}{fmtQty(row.quantityDelta)} <span className="text-xs font-normal text-muted-foreground">{row.productUnit || ''}</span></td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums"><span className="text-muted-foreground">{fmtQty(row.stockBefore)}</span> <span className="text-muted-foreground">→</span> <span className="font-semibold">{fmtQty(row.stockAfter)}</span></td>
              <td className="px-4 py-3 text-muted-foreground">{row.lotCode || '—'}</td>
              <td className="px-4 py-3 text-muted-foreground">{row.locationCode || '—'}</td>
              <td className="px-4 py-3 text-muted-foreground">{row.createdByName || 'Sistema'}</td>
              <td className="max-w-[280px] px-4 py-3"><p className="truncate font-medium" title={row.reason || row.note || ''}>{row.reason || row.note || '—'}</p><p className="mt-0.5 truncate text-xs text-muted-foreground" title={referenceFor(row)}>{referenceFor(row)}</p></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </Card>
  </div></Layout>;
}
