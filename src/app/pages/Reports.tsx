import { useEffect, useMemo, useState } from 'react';
import { Activity, BarChart3, CalendarDays, CircleDollarSign, Download, Package, RefreshCw, TrendingUp } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { toastError } from '../utils/notifications';
import { Layout } from '../components/Layout';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { AnimatedCounter } from '../components/motion/AnimatedCounter';
import { dataService, colombiaDateKey, type SaleRecord } from '../services/dataService';
import { saleNetTotal, saleNetRevenue, saleCost, returnedUnits } from '../utils/saleMetrics';

import { formatMoney as money } from '../utils/restaurantFormat';
import { downloadCsv } from '../utils/csv';

const daysAgo = (days: number) => colombiaDateKey(new Date(Date.now() - days * 86400000));
const formatDate = (value: string) => new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));

export function Reports() {
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [start, setStart] = useState(daysAgo(29));
  const [end, setEnd] = useState(colombiaDateKey());
  const [status, setStatus] = useState<'completed' | 'all'>('completed');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try { setSales(await dataService.getSales()); }
    catch (error) { toastError(error, 'No se pudieron cargar los reportes.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const reportSales = useMemo(() => sales.filter(sale => {
    const day = colombiaDateKey(new Date(sale.date));
    const inRange = (!start || day >= start) && (!end || day <= end);
    const correctStatus = status === 'all' || sale.status === 'completed';
    return inRange && correctStatus;
  }), [sales, start, end, status]);
  const validSales = reportSales.filter(sale => sale.status === 'completed');
  const revenue = validSales.reduce((sum, sale) => sum + saleNetRevenue(sale), 0);
  const cost = validSales.reduce((sum, sale) => sum + saleCost(sale), 0);
  const profit = revenue - cost;
  const averageTicket = validSales.length ? validSales.reduce((sum, sale) => sum + saleNetTotal(sale), 0) / validSales.length : 0;

  const chartData = useMemo(() => {
    const grouped = new Map<string, { date: string; sales: number; revenue: number }>();
    validSales.forEach(sale => {
      const day = colombiaDateKey(new Date(sale.date));
      const current = grouped.get(day) || { date: day, sales: 0, revenue: 0 };
      current.sales += 1;
      current.revenue += saleNetRevenue(sale);
      grouped.set(day, current);
    });
    return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-31).map(row => ({ ...row, label: row.date.slice(5).replace('-', '/') }));
  }, [validSales]);

  const exportCsv = () => {
    downloadCsv(`manager-stock-reporte-${start || 'inicio'}-${end || 'hoy'}.csv`, [
      ['Venta', 'Fecha', 'Cliente', 'Estado', 'Productos', 'Unidades', 'Subtotal', 'Descuento línea', 'Descuento general', 'Impuesto', 'Total original', 'Devuelto', 'Venta neta con impuesto', 'Ingreso neto sin impuesto', 'Costo estimado', 'Utilidad estimada'],
      ...reportSales.map(sale => [sale.id, sale.date, sale.customer, sale.status, sale.productName, sale.quantity, sale.subtotal, sale.lineDiscount, sale.globalDiscount, sale.tax, sale.totalPrice, sale.returnedTotal || 0, saleNetTotal(sale), saleNetRevenue(sale), saleCost(sale), saleNetRevenue(sale) - saleCost(sale)]),
    ]);
  };

  return <Layout><div className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div><p className="text-sm font-semibold uppercase tracking-[.16em] text-orange-600">Análisis del negocio</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Reportes y rentabilidad</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Agrupa por fecha de venta y descuenta todas las devoluciones registradas hasta hoy. Los movimientos de caja conservan la fecha real del reembolso. Puedes exportar los registros para analizarlos en Excel.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" className="rounded-xl" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4"/>Actualizar</Button><Button disabled={!reportSales.length} onClick={exportCsv} className="rounded-xl bg-orange-600 text-white hover:bg-orange-700"><Download className="mr-2 h-4 w-4"/>Exportar CSV</Button></div>
    </header>
    <Card className="rounded-2xl border-border/70 p-4 shadow-sm"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_200px_auto]"><div className="space-y-1.5"><label htmlFor="reportStart" className="text-xs font-semibold text-muted-foreground">Desde</label><Input id="reportStart" type="date" value={start} max={end || undefined} onChange={event => setStart(event.target.value)} className="h-11 rounded-xl"/></div><div className="space-y-1.5"><label htmlFor="reportEnd" className="text-xs font-semibold text-muted-foreground">Hasta</label><Input id="reportEnd" type="date" value={end} min={start || undefined} onChange={event => setEnd(event.target.value)} className="h-11 rounded-xl"/></div><div className="space-y-1.5"><label htmlFor="reportStatus" className="text-xs font-semibold text-muted-foreground">Estado de ventas</label><select id="reportStatus" value={status} onChange={event => setStatus(event.target.value as 'completed' | 'all')} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"><option value="completed">Solo completadas</option><option value="all">Todos los estados</option></select></div><div className="flex items-end"><Button variant="outline" onClick={() => { setStart(daysAgo(29)); setEnd(colombiaDateKey()); setStatus('completed'); }} className="h-11 w-full rounded-xl">Últimos 30 días</Button></div></div></Card>
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <Card className="min-w-0 rounded-2xl border-border/70 p-5 shadow-sm"><div className="flex items-center justify-between gap-2"><span className="text-sm text-muted-foreground">Ventas completadas</span><Activity className="h-5 w-5 text-orange-600"/></div><p className="mt-3 text-3xl font-bold tabular-nums"><AnimatedCounter value={validSales.length}/></p><p className="mt-1 text-xs text-muted-foreground">Transacciones del período</p></Card>
      <Card className="rounded-2xl border-border/70 p-5 shadow-sm"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Ingreso neto estimado</span><CircleDollarSign className="h-5 w-5 text-emerald-600"/></div><p className="mt-3 text-2xl font-bold tabular-nums"><AnimatedCounter value={revenue} format={money}/></p><p className="mt-1 text-xs text-muted-foreground">Descontadas devoluciones e impuesto</p></Card>
      <Card className="rounded-2xl border-border/70 p-5 shadow-sm"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Costo de producto vendido</span><Package className="h-5 w-5 text-amber-600"/></div><p className="mt-3 text-2xl font-bold tabular-nums"><AnimatedCounter value={cost} format={money}/></p><p className="mt-1 text-xs text-muted-foreground">Basado en costos guardados al vender</p></Card>
      <Card className="rounded-2xl border-border/70 p-5 shadow-sm"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Utilidad bruta estimada</span><TrendingUp className={`h-5 w-5 ${profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}/></div><p className={`mt-3 text-2xl font-bold tabular-nums ${profit < 0 ? 'text-rose-600' : ''}`}><AnimatedCounter value={profit} format={money}/></p><p className="mt-1 text-xs text-muted-foreground">Ticket promedio: <AnimatedCounter value={averageTicket} format={money}/></p></Card>
    </div>
    <div className="grid gap-5 xl:grid-cols-[1.4fr_.8fr]">
      <Card className="rounded-2xl border-border/70 p-5 shadow-sm"><div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="font-semibold">Ingresos por día</h2><p className="mt-1 text-sm text-muted-foreground">Ventas netas de devoluciones, sin impuestos</p></div><BarChart3 className="h-5 w-5 text-orange-600"/></div>{loading ? <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">Cargando reporte…</div> : chartData.length ? <div className="h-64 w-full"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)"/><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}/><YAxis width={72} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} tickFormatter={value => `${Math.round(value / 1000)}k`}/><Tooltip formatter={(value) => money(Number(value))} labelFormatter={label => `Fecha ${label}`} contentStyle={{ borderRadius: 12, borderColor: 'var(--border)', background: 'var(--card)', color: 'var(--card-foreground)' }}/><Bar dataKey="revenue" name="Ingreso neto" fill="var(--chart-1)" radius={[8, 8, 0, 0]} maxBarSize={44} animationBegin={150} animationDuration={800} animationEasing="ease-out">{chartData.map((entry, index) => <Cell key={`${entry.label}-${index}`} fill={index % 2 === 0 ? 'var(--chart-2)' : 'var(--chart-1)'}/>)}</Bar></BarChart></ResponsiveContainer></div> : <div className="flex h-64 flex-col items-center justify-center text-center"><CalendarDays className="mb-2 h-9 w-9 text-muted-foreground/50"/><p className="font-medium">Sin ventas en este período</p><p className="mt-1 text-sm text-muted-foreground">Cuando registres ventas aparecerán en este gráfico.</p></div>}</Card>
      <Card className="rounded-2xl border-border/70 p-5 shadow-sm"><div className="mb-4"><h2 className="font-semibold">Mejores productos</h2><p className="mt-1 text-sm text-muted-foreground">Por unidades conservadas por el cliente</p></div>{(() => { const products = new Map<string, { name: string; units: number; revenue: number }>(); validSales.forEach(sale => sale.items.forEach(item => { const row = products.get(item.productId) || { name: item.productName, units: 0, revenue: 0 }; const units = Math.max(0, item.quantity - returnedUnits(sale, item)); row.units += units; row.revenue += item.quantity > 0 ? item.subtotal * units / item.quantity : 0; products.set(item.productId, row); })); const best = [...products.values()].filter(p => p.units > 0).sort((a, b) => b.units - a.units).slice(0, 6); return best.length ? <div className="space-y-4">{best.map((product, index) => <div key={product.name} className="flex items-center gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-sm font-bold text-orange-700 dark:bg-orange-950/40 dark:text-orange-300">{index + 1}</div><div className="min-w-0 flex-1"><div className="flex justify-between gap-3"><p className="truncate text-sm font-medium">{product.name}</p><span className="shrink-0 text-sm font-semibold">{product.units} un.</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="bar-fill h-full rounded-full bg-orange-500" style={{ width: `${Math.max(4, product.units / best[0].units * 100)}%` }}/></div><p className="mt-1 text-xs text-muted-foreground">{money(product.revenue)} antes de descuento general e impuestos</p></div></div>)}</div> : <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Aún no hay productos vendidos.</div>; })()}</Card>
    </div>
    <Card className="overflow-hidden rounded-2xl border-border/70 shadow-sm"><div className="flex items-center justify-between border-b border-border/70 px-5 py-4"><div><h2 className="font-semibold">Detalle de operaciones</h2><p className="mt-1 text-sm text-muted-foreground">{reportSales.length} registros encontrados · {status === 'all' ? 'incluye anuladas y pendientes' : 'solo ventas completadas'}</p></div><Badge variant="outline" className="rounded-lg">COP</Badge></div><div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm"><thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-5 py-3">Venta</th><th className="px-5 py-3">Fecha</th><th className="px-5 py-3">Cliente / productos</th><th className="px-5 py-3 text-right">Ingreso neto</th><th className="px-5 py-3 text-right">Costo estimado</th><th className="px-5 py-3 text-right">Utilidad bruta</th><th className="px-5 py-3">Estado</th></tr></thead><tbody className="divide-y divide-border/60">{loading ? <tr><td colSpan={7} className="px-5 py-12 text-center text-muted-foreground">Cargando operaciones…</td></tr> : reportSales.map(sale => { const net = saleNetRevenue(sale); const cogs = saleCost(sale); const profitValue = net - cogs; return <tr key={sale.id} className="hover:bg-muted/20"><td className="whitespace-nowrap px-5 py-4 font-mono text-xs font-semibold text-orange-700">{sale.id}</td><td className="whitespace-nowrap px-5 py-4 text-muted-foreground">{formatDate(sale.date)}</td><td className="px-5 py-4"><p className="font-medium">{sale.customer || 'Cliente general'}</p><p className="mt-1 max-w-56 truncate text-xs text-muted-foreground">{sale.productName}</p></td><td className="px-5 py-4 text-right font-medium">{money(net)}</td><td className="px-5 py-4 text-right">{money(cogs)}</td><td className={`px-5 py-4 text-right font-semibold ${profitValue < 0 ? 'text-rose-600' : 'text-emerald-700 dark:text-emerald-400'}`}>{money(profitValue)}</td><td className="px-5 py-4"><Badge variant="outline" className={sale.status === 'completed' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : sale.status === 'pending' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-rose-200 bg-rose-50 text-rose-700'}>{sale.status === 'completed' ? 'Completada' : sale.status === 'pending' ? 'Pendiente' : 'Anulada'}</Badge></td></tr>; })}</tbody></table></div>{!loading && reportSales.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground">No hay registros para los filtros elegidos.</div>}<div className="border-t border-border/70 px-5 py-3 text-xs leading-5 text-muted-foreground">La utilidad es una estimación bruta. Solo los artículos devueltos y repuestos al inventario revierten su costo; los dañados o preparados conservan ese costo. En ventas antiguas sin costo histórico guardado, el costo se considera $0; no representa utilidad neta contable ni reemplaza la liquidación tributaria.</div></Card>
  </div></Layout>;
}
