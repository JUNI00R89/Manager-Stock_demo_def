import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowDownUp, Boxes, CalendarClock, Download, FileBarChart, PackageMinus, RefreshCw, Timer } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../utils/notifications';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { dataService, type InventoryLotRecord, type InventoryReportsRecord } from '../../services/dataService';
import { dateOnly, dateTime, fmtQty, money, PageTitle, StatCard } from './shared';
import { Label } from '../../components/ui/label';

export function WarehouseReports() {
  const [report, setReport] = useState<InventoryReportsRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [periodDays, setPeriodDays] = useState('30');
  const [noMovementDays, setNoMovementDays] = useState('60');

  const load = async () => {
    setLoading(true);
    try { setReport(await dataService.getInventoryReports(Number(periodDays) || 30, Number(noMovementDays) || 60)); }
    catch (error) { toastError(error, 'No se pudieron cargar los reportes de inventario.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const expiring = (report?.expiringItems || []).filter((item): item is InventoryLotRecord => typeof item !== 'string');

  const exportCritical = () => {
    if (!report) return;
    const rows = [['Producto', 'SKU', 'Stock', 'Mínimo', 'Faltante'], ...report.criticalStock.map(product => [product.name, product.sku, product.stock, product.minStock, Math.max(0, product.minStock - product.stock)])];
    const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const blob = new Blob(['\ufeff', rows.map(row => row.map(quote).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `inventario-reporte-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  };

  return <Layout><div className="mx-auto max-w-7xl space-y-6">
    <PageTitle eyebrow="Bodega · Reportes" title="Reportes de inventario" description="Valor total, stock crítico, vencimientos, merma, rotación, productos sin movimiento y diferencias de conteo." action={<Button variant="outline" onClick={() => void load()} disabled={loading} className="h-11 rounded-xl"><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`}/>Actualizar</Button>}/>

    <Card className="rounded-2xl border-border/70 p-4 shadow-sm"><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="space-y-1"><Label className="text-xs">Periodo de análisis</Label><select value={periodDays} onChange={event => { setPeriodDays(event.target.value); void load(); }} className="h-11 rounded-xl border border-input bg-background px-3 text-sm"><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option><option value="365">Últimos 365 días</option></select></div><div className="space-y-1"><Label className="text-xs">Ventana de sin movimiento</Label><select value={noMovementDays} onChange={event => { setNoMovementDays(event.target.value); void load(); }} className="h-11 rounded-xl border border-input bg-background px-3 text-sm"><option value="30">30 días</option><option value="60">60 días</option><option value="180">180 días</option><option value="365">365 días</option></select></div></div></Card>

    {loading ? <Card className="rounded-2xl p-12 text-center text-muted-foreground">Generando reportes…</Card> : report ? <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Valor total del inventario" value={money(report.totalValue)} hint={`${fmtQty(report.totalUnits)} unidades · ${report.productCount} productos`} icon={Boxes} tone="orange"/>
        <StatCard label="Stock crítico" value={report.criticalStockCount} hint="Bajo, agotado o negativo" icon={AlertTriangle} tone={report.criticalStockCount ? 'rose' : 'emerald'}/>
        <StatCard label="Vencimientos" value={report.expiringCount} hint={`${fmtQty(report.expiringItems?.length ?? 0)} items visibles`} icon={CalendarClock} tone={report.expiringCount ? 'amber' : 'emerald'}/>
        <StatCard label="Merma en el periodo" value={money(report.wasteCost)} hint="Costo de unidades dadas de baja" icon={PackageMinus} tone="violet"/>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="rounded-2xl border-border/70 p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Productos críticos</h2><p className="mt-1 text-sm text-muted-foreground">Faltantes respecto al stock mínimo</p></div><Button variant="outline" size="sm" className="rounded-xl" onClick={exportCritical}><Download className="mr-2 h-4 w-4"/>CSV</Button></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-2 font-semibold">Producto</th><th className="px-3 py-2 text-right font-semibold">Stock</th><th className="px-3 py-2 text-right font-semibold">Mínimo</th><th className="px-3 py-2 text-right font-semibold">Faltante</th></tr></thead><tbody className="divide-y divide-border/60">{report.criticalStock.length === 0 ? <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Sin productos críticos.</td></tr> : report.criticalStock.map(product => <tr key={product.id}><td className="px-3 py-2"><p className="font-medium">{product.name}</p><p className="text-xs text-muted-foreground">{product.sku}</p></td><td className={`px-3 py-2 text-right font-semibold tabular-nums ${product.stock < 0 ? 'text-rose-600' : ''}`}>{fmtQty(product.stock)} {product.unit}</td><td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtQty(product.minStock)}</td><td className="px-3 py-2 text-right font-semibold tabular-nums text-rose-600">{fmtQty(Math.max(0, product.minStock - product.stock))}</td></tr>)}</tbody></table></div></Card>

        <Card className="rounded-2xl border-border/70 p-5 shadow-sm"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><PackageMinus className="h-5 w-5"/></div><div><h2 className="font-semibold">Merma por motivo</h2><p className="mt-1 text-sm text-muted-foreground">Costo acumulado en el periodo</p></div></div><div className="mt-4 space-y-2">{report.wasteByReason.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Sin mermas registradas en el periodo.</p> : report.wasteByReason.map(reason => <div key={reason.reasonCode} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 p-3"><div><p className="font-medium">{reason.reasonLabel || reason.reasonCode}</p><p className="text-xs text-muted-foreground">{fmtQty(reason.quantity)} unidades</p></div><div className="text-right"><p className="font-semibold">{money(reason.cost)}</p><p className="text-xs text-muted-foreground">costo total</p></div></div>)}</div></Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="rounded-2xl border-border/70 p-5 shadow-sm"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><ArrowDownUp className="h-5 w-5"/></div><div><h2 className="font-semibold">Rotación de consumo</h2><p className="mt-1 text-sm text-muted-foreground">Unidades consumidas por producto en el periodo</p></div></div><div className="mt-4 space-y-2">{report.rotation.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Sin consumos registrados.</p> : report.rotation.map(item => <div key={item.productId} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 p-3"><div className="min-w-0"><p className="truncate font-medium">{item.productName}</p><p className="text-xs text-muted-foreground">SKU {item.sku}</p></div><div className="text-right"><p className="font-semibold">{fmtQty(item.quantity)} {item.unit}</p><p className="text-xs text-muted-foreground">{item.movements} movim. · {money(item.cost)} en costo</p></div></div>)}</div></Card>

        <Card className="rounded-2xl border-border/70 p-5 shadow-sm"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Timer className="h-5 w-5"/></div><div><h2 className="font-semibold">Productos sin movimiento</h2><p className="mt-1 text-sm text-muted-foreground">Sin actividad reciente en el inventario</p></div></div><div className="mt-4 space-y-2">{report.noMovement.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Todos los productos tienen movimiento reciente.</p> : report.noMovement.map(item => <div key={item.productId} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 p-3"><div><p className="font-medium">{item.productName}</p><p className="text-xs text-muted-foreground">{item.sku} · Stock: {fmtQty(item.stock)} {item.unit}</p></div><div className="text-right"><p className="text-xs text-muted-foreground">Último movimiento</p><p className="font-semibold">{item.lastMovementAt ? dateTime(item.lastMovementAt) : 'Sin registro'}</p></div></div>)}</div></Card>
      </div>

      <Card className="rounded-2xl border-border/70 p-5 shadow-sm"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600"><FileBarChart className="h-5 w-5"/></div><div><h2 className="font-semibold">Diferencias de conteo</h2><p className="mt-1 text-sm text-muted-foreground">Ajustes pendientes detectados en conteos físicos</p></div></div><div className="mt-4 space-y-2">{report.countDifferences.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No hay diferencias de conteo en el periodo.</p> : report.countDifferences.slice(0, 30).map((item, index) => <div key={`${item.countId}-${item.productId}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 p-3 text-sm"><div><p className="font-medium">{item.productName}</p><p className="text-xs text-muted-foreground">{item.sku} · Conteo {item.countId}</p></div><div className="text-right"><p className={`font-semibold tabular-nums ${item.difference > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{item.difference > 0 ? '+' : ''}{fmtQty(item.difference)}</p><p className="text-xs text-muted-foreground">Sistema vs contado</p></div></div>)}</div></Card>
    </> : <Card className="rounded-2xl border-border/70 p-12 text-center text-muted-foreground">No se pudieron generar los reportes.</Card>}
  </div></Layout>;
}
