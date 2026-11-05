import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  AlertTriangle, ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Boxes, ClipboardCheck,
  ClipboardList, FileBarChart, PackageMinus, RefreshCw, Scale, ShoppingCart, Warehouse,
} from 'lucide-react';
import { toast } from 'sonner';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { dataService, type InventoryAlertRecord, type InventoryOverviewRecord } from '../../services/dataService';
import { dateOnly, dateTime, EmptyState, fmtQty, money, PageTitle, StatCard } from './shared';

const alertTone: Record<InventoryAlertRecord['severity'], string> = {
  high: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200',
  medium: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  low: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200',
};

const quickActions = [
  { to: '/warehouse/entries', label: 'Registrar entrada', icon: ArrowDownToLine },
  { to: '/warehouse/exits', label: 'Registrar salida', icon: ArrowUpFromLine },
  { to: '/warehouse/waste', label: 'Registrar merma', icon: PackageMinus },
  { to: '/warehouse/adjustments', label: 'Ajustar existencias', icon: Scale },
  { to: '/warehouse/purchase-orders', label: 'Órdenes de compra', icon: ShoppingCart },
  { to: '/warehouse/counts', label: 'Conteo físico', icon: ClipboardCheck },
  { to: '/warehouse/transfers', label: 'Trasladar stock', icon: ArrowLeftRight },
  { to: '/warehouse/reports', label: 'Ver reportes', icon: FileBarChart },
];

export function WarehouseOverview() {
  const [overview, setOverview] = useState<InventoryOverviewRecord | null>(null);
  const [alerts, setAlerts] = useState<InventoryAlertRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    try {
      const [nextOverview, nextAlerts] = await Promise.all([dataService.getInventoryOverview(), dataService.getInventoryAlerts()]);
      setOverview(nextOverview);
      setAlerts(nextAlerts.alerts);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar el resumen de bodega.');
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  return <Layout><div className="mx-auto max-w-7xl space-y-6">
    <PageTitle eyebrow="Bodega" title="Resumen de inventario" description="Existencias, valor, alertas y trazabilidad en tiempo real a partir de cada entrada, salida, venta y ajuste." action={<Button variant="outline" onClick={() => void load()} disabled={loading} className="h-11 rounded-xl"><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`}/>Actualizar</Button>}/>

    {loading ? <Card className="rounded-2xl p-12 text-center text-muted-foreground">Cargando bodega…</Card> : overview ? <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Valor al costo" value={money(overview.totalValue)} hint={`${fmtQty(overview.totalUnits)} unidades · ${overview.productCount} productos`} icon={Warehouse} tone="orange"/>
        <StatCard label="Valor de venta" value={money(overview.totalRetailValue)} hint="Estimado con el precio actual" icon={Boxes} tone="blue"/>
        <StatCard label="Stock crítico" value={overview.lowStockCount} hint={`${overview.outOfStockCount} agotados · ${overview.negativeStockCount} negativos`} icon={AlertTriangle} tone={overview.lowStockCount ? 'rose' : 'emerald'}/>
        <StatCard label="Lotes por vencer" value={overview.expiringCount} hint={`${overview.expiredCount} vencidos`} icon={PackageMinus} tone={overview.expiringCount + overview.expiredCount ? 'amber' : 'emerald'}/>
        <StatCard label="Merma últimos 30 días" value={money(overview.wasteCost)} hint="Costo de unidades dadas de baja" icon={PackageMinus} tone="violet"/>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{quickActions.map(action => <Link key={action.to} to={action.to} className="group flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-md"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600 dark:bg-orange-950/40"><action.icon className="h-5 w-5"/></span><span className="text-sm font-semibold">{action.label}</span></Link>)}</div>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
        <Card className="rounded-2xl border-border/70 p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Alertas de existencias y vencimientos</h2><p className="mt-1 text-sm text-muted-foreground">{alerts.length ? `${alerts.length} alertas requieren revisión` : 'Todo en orden por ahora'}</p></div><AlertTriangle className={`h-5 w-5 ${alerts.length ? 'text-rose-500' : 'text-emerald-600'}`}/></div>
          {alerts.length === 0 ? <div className="mt-6 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No hay alertas activas. El stock y los lotes están dentro de los parámetros configurados.</div> : <div className="mt-4 max-h-[380px] space-y-2 overflow-y-auto pr-1">{alerts.slice(0, 40).map((alert, index) => <div key={`${alert.type}-${alert.productId}-${alert.lotCode ?? index}`} className={`rounded-xl border p-3 text-sm ${alertTone[alert.severity]}`}><div className="flex items-start justify-between gap-2"><p className="font-semibold">{alert.productName}</p><Badge variant="outline" className="shrink-0 bg-white/60 text-[10px] uppercase dark:bg-black/20">{alert.type.replaceAll('_', ' ')}</Badge></div><p className="mt-1 text-xs leading-5 opacity-90">{alert.message}</p></div>)}</div>}
        </Card>

        <Card className="rounded-2xl border-border/70 p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Lotes próximos a vencer</h2><p className="mt-1 text-sm text-muted-foreground">Ordenados por fecha de vencimiento (FEFO)</p></div><Link to="/warehouse/lots" className="text-sm font-semibold text-orange-600 hover:underline">Ver todos</Link></div>
          {overview.expiringLots.length === 0 ? <div className="mt-6 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No hay lotes próximos a vencer.</div> : <div className="mt-4 space-y-2">{overview.expiringLots.slice(0, 10).map(lot => <div key={lot.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{lot.productName}</p><p className="mt-1 text-xs text-muted-foreground">Lote {lot.lotCode || 'sin código'} · {fmtQty(lot.quantity)} {lot.productUnit}</p></div><div className="shrink-0 text-right"><Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">{lot.daysLeft === null ? '—' : `${lot.daysLeft} días`}</Badge><p className="mt-1 text-xs text-muted-foreground">{dateOnly(lot.expiryDate)}</p></div></div>)}</div>}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden rounded-2xl border-border/70 shadow-sm"><div className="flex items-center justify-between gap-3 border-b border-border p-5"><div><h2 className="font-semibold">Stock bajo</h2><p className="mt-1 text-sm text-muted-foreground">Productos en o por debajo del mínimo</p></div><Link to="/products" className="text-sm font-semibold text-orange-600 hover:underline">Catálogo</Link></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-5 py-3 font-semibold">Producto</th><th className="px-5 py-3 text-right font-semibold">Stock</th><th className="px-5 py-3 text-right font-semibold">Mínimo</th><th className="px-5 py-3 text-right font-semibold">Faltan</th></tr></thead><tbody className="divide-y divide-border/60">{overview.lowStockProducts.length === 0 ? <tr><td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">Sin productos en nivel crítico.</td></tr> : overview.lowStockProducts.map(product => <tr key={product.id}><td className="px-5 py-3"><p className="font-medium">{product.name}</p><p className="text-xs text-muted-foreground">{product.sku}</p></td><td className={`px-5 py-3 text-right font-semibold tabular-nums ${product.stock < 0 ? 'text-rose-600' : ''}`}>{fmtQty(product.stock)} {product.unit}</td><td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{fmtQty(product.minStock)}</td><td className="px-5 py-3 text-right font-semibold tabular-nums text-amber-700">{fmtQty(Math.max(0, product.minStock - product.stock))}</td></tr>)}</tbody></table></div>
        </Card>

        <Card className="overflow-hidden rounded-2xl border-border/70 shadow-sm"><div className="flex items-center justify-between gap-3 border-b border-border p-5"><div><h2 className="font-semibold">Últimos movimientos</h2><p className="mt-1 text-sm text-muted-foreground">Quién, cuándo, cuánto y por qué</p></div><Link to="/warehouse/movements" className="text-sm font-semibold text-orange-600 hover:underline">Historial</Link></div>
          <div className="divide-y divide-border/60">{overview.recentMovements.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">Todavía no hay movimientos registrados.</div> : overview.recentMovements.slice(0, 10).map(movement => <div key={movement.id} className="flex items-center gap-3 px-5 py-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${movement.quantityDelta >= 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40' : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40'}`}>{movement.quantityDelta >= 0 ? <ArrowDownToLine className="h-4 w-4"/> : <ArrowUpFromLine className="h-4 w-4"/>}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{movement.productName}</p><p className="truncate text-xs text-muted-foreground">{movement.reason || movement.note || movement.movementType}{movement.createdByName ? ` · ${movement.createdByName}` : ''} · {dateTime(movement.createdAt)}</p></div><span className={`shrink-0 text-sm font-bold tabular-nums ${movement.quantityDelta >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{movement.quantityDelta > 0 ? '+' : ''}{fmtQty(movement.quantityDelta)}</span></div>)}</div>
        </Card>
      </div>

      <Card className="rounded-2xl border-border/70 p-5 text-sm text-muted-foreground"><div className="flex items-start gap-3"><ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-orange-600"/><p>El stock se calcula desde los movimientos y se actualiza al registrar entradas, salidas, mermas, ventas, recetas, conteos y traslados. Las ventas con receta descuentan los ingredientes automáticamente. Configura vencimientos y stock negativo en <Link to="/warehouse/settings" className="font-semibold text-orange-600 hover:underline">Configuración de bodega</Link>.</p></div></Card>
    </> : <EmptyState icon={Warehouse} title="No se pudo cargar la bodega" description="Revisa la conexión con el backend e inténtalo de nuevo."/>}
  </div></Layout>;
}
