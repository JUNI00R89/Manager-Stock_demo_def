import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { CalendarDays, CircleDollarSign, Download, Eye, Plus, Search, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import { Layout } from '../components/Layout';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { colombiaDateKey, dataService, type SaleRecord, type SaleStatus } from '../services/dataService';
import { useAuth } from '../context/AuthContext';

const money = (v: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);
const statusLabel: Record<SaleStatus, string> = { completed: 'Completada', pending: 'Pendiente', cancelled: 'Anulada' };

export function Sales() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canCreateSale = user?.customRoleId ? Boolean(user.permissions?.includes('sales.create')) : user?.role === 'owner' || user?.role === 'business_admin' || user?.role === 'cashier';
  const canExportSales = user?.customRoleId ? Boolean(user.permissions?.includes('reports.view')) : user?.role === 'owner' || user?.role === 'business_admin';
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | SaleStatus>('all');
  const [loading, setLoading] = useState(true);
  const load = async () => { try { setSales(await dataService.getSales()); } catch (error) { toast.error(error instanceof Error ? error.message : 'No fue posible cargar las ventas.'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const filtered = useMemo(() => sales.filter(sale => {
    const term = search.toLowerCase();
    return (!term || `${sale.id} ${sale.customer} ${sale.productName}`.toLowerCase().includes(term)) && (status === 'all' || sale.status === status);
  }), [sales, search, status]);
  const completed = sales.filter(s => s.status === 'completed');
  const today = colombiaDateKey();
  const todaySales = completed.filter(s => colombiaDateKey(new Date(s.date)) === today);
  const revenueToday = todaySales.reduce((sum, sale) => sum + sale.totalPrice, 0);
  const badgeClass: Record<SaleStatus, string> = { completed: 'border-emerald-200 bg-emerald-50 text-emerald-700', pending: 'border-amber-200 bg-amber-50 text-amber-700', cancelled: 'border-rose-200 bg-rose-50 text-rose-700' };
  const exportCsv = () => {
    const quote = (value: unknown) => `\"${String(value ?? '').replaceAll('\"', '\"\"')}\"`;
    const rows = [['Venta', 'Fecha', 'Cliente', 'Productos', 'Unidades', 'Método de pago', 'Subtotal', 'Descuento por línea', 'Descuento general', 'Impuesto', 'Total', 'Estado'], ...filtered.map(sale => [sale.id, sale.date, sale.customer, sale.productName, sale.quantity, sale.paymentMethod, sale.subtotal, sale.lineDiscount, sale.globalDiscount, sale.tax, sale.totalPrice, statusLabel[sale.status]])];
    const csv = rows.map(row => row.map(quote).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url; link.download = `ventas-manager-stock-${colombiaDateKey()}.csv`; link.click(); URL.revokeObjectURL(url);
  };

  return <Layout><div className="mx-auto max-w-7xl space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold uppercase tracking-[.16em] text-orange-600">Operación comercial</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Ventas</h1><p className="mt-1 text-muted-foreground">Historial transaccional con detalle de productos y métodos de pago.</p></div>{canCreateSale && <Button onClick={() => navigate('/sales/new')} className="h-11 rounded-xl bg-orange-600 text-white hover:bg-orange-700"><Plus className="mr-2 h-4 w-4"/>Registrar venta</Button>}</div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4"><Card className="min-w-0 rounded-3xl border-border/70 p-5 shadow-sm"><div className="flex items-center justify-between gap-2"><span className="text-sm text-muted-foreground">Ventas de hoy</span><ShoppingBag className="h-5 w-5 shrink-0 text-orange-600"/></div><p className="mt-3 text-3xl font-bold">{todaySales.length}</p><p className="mt-1 text-xs text-muted-foreground">Transacciones completadas</p></Card><Card className="min-w-0 rounded-3xl border-border/70 p-5 shadow-sm"><div className="flex items-center justify-between gap-2"><span className="text-sm text-muted-foreground">Ingresos de hoy</span><CircleDollarSign className="h-5 w-5 shrink-0 text-emerald-600"/></div><p className="mt-3 text-2xl font-bold">{money(revenueToday)}</p><p className="mt-1 text-xs text-muted-foreground">Sin incluir ventas anuladas</p></Card><Card className="col-span-2 min-w-0 rounded-3xl border-border/70 p-5 shadow-sm sm:col-span-1"><div className="flex items-center justify-between gap-2"><span className="text-sm text-muted-foreground">Historial completo</span><CalendarDays className="h-5 w-5 shrink-0 text-orange-600"/></div><p className="mt-3 text-3xl font-bold">{sales.length}</p><p className="mt-1 text-xs text-muted-foreground">Incluye pendientes y anuladas</p></Card></div>
    <Card className="rounded-3xl border-border/70 p-4 shadow-sm"><div className="flex flex-col gap-3 md:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por número, cliente o producto…" className="h-11 rounded-xl pl-9"/></div><div className="flex flex-wrap gap-2">{([{id:'all',label:'Todas'},{id:'completed',label:'Completadas'},{id:'pending',label:'Pendientes'},{id:'cancelled',label:'Anuladas'}] as const).map(item => <Button key={item.id} variant={status === item.id ? 'default' : 'outline'} onClick={() => setStatus(item.id)} className={status === item.id ? 'rounded-xl bg-orange-600 hover:bg-orange-700' : 'rounded-xl'}>{item.label}</Button>)}</div></div></Card>
    <Card className="overflow-hidden rounded-3xl border-border/70 shadow-sm"><div className="flex items-center justify-between border-b border-border/70 px-5 py-4"><div><h2 className="font-semibold">Registro de transacciones</h2><p className="mt-1 text-sm text-muted-foreground">{filtered.length} registros encontrados</p></div><div className="flex items-center gap-2"><Badge variant="secondary" className="rounded-lg">COP · Colombia</Badge>{canExportSales && <Button type="button" variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length} className="rounded-lg"><Download className="mr-2 h-4 w-4"/>Exportar CSV</Button>}</div></div>{loading ? <div className="p-12 text-center text-muted-foreground">Cargando historial…</div> : filtered.length === 0 ? <div className="p-12 text-center"><ShoppingBag className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50"/><h3 className="font-semibold">Todavía no hay ventas para mostrar</h3><p className="mt-1 text-sm text-muted-foreground">Las ventas aparecerán aquí cuando registres una transacción.</p>{canCreateSale && <Button onClick={() => navigate('/sales/new')} className="mt-4 bg-orange-600 hover:bg-orange-700">Crear primera venta</Button>}</div> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-5 py-3 font-semibold">N.º de venta</th><th className="px-5 py-3 font-semibold">Cliente / productos</th><th className="px-5 py-3 font-semibold">Unidades</th><th className="px-5 py-3 font-semibold">Método</th><th className="px-5 py-3 font-semibold">Fecha</th><th className="px-5 py-3 font-semibold">Total</th><th className="px-5 py-3 font-semibold">Estado</th><th className="px-5 py-3"/></tr></thead><tbody className="divide-y divide-border/60">{filtered.map(sale => <tr key={sale.id} className="transition-colors hover:bg-muted/20"><td className="px-5 py-4 font-mono text-xs font-semibold text-orange-700">{sale.id}</td><td className="px-5 py-4"><p className="font-medium">{sale.customer || 'Cliente general'}</p><p className="mt-1 max-w-[240px] truncate text-xs text-muted-foreground">{sale.productName}</p></td><td className="px-5 py-4">{sale.quantity}</td><td className="px-5 py-4 capitalize">{{cash:'Efectivo',card:'Tarjeta',digital:'Digital',split:'Dividido',transfer:'Transferencia'}[sale.paymentMethod] || sale.paymentMethod}</td><td className="px-5 py-4 text-muted-foreground">{new Date(sale.date).toLocaleString('es-CO',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</td><td className="px-5 py-4 font-semibold">{money(sale.totalPrice)}</td><td className="px-5 py-4"><Badge variant="outline" className={badgeClass[sale.status]}>{statusLabel[sale.status]}</Badge></td><td className="px-5 py-4"><Button variant="ghost" size="icon" onClick={() => navigate(`/sales/${sale.id}`)} aria-label="Ver detalle"><Eye className="h-4 w-4"/></Button></td></tr>)}</tbody></table></div>}</Card>
  </div></Layout>;
}
