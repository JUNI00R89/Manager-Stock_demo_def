import { SaleReturnsPanel } from '../components/SaleReturnsPanel';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, CalendarDays, CircleDollarSign, Package, Printer, RotateCcw, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../utils/notifications';
import { Layout } from '../components/Layout';
import { ConfirmActionDialog } from '../components/ConfirmActionDialog';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { dataService, type SaleRecord } from '../services/dataService';
import { useAuth } from '../context/AuthContext';
import { formatMoney as money } from '../utils/restaurantFormat';

const labels = { completed: 'Completada', pending: 'Pendiente', cancelled: 'Anulada' } as const;

export function SaleDetail() {
  const { id } = useParams(); const navigate = useNavigate();
  const { user } = useAuth();
  const canCancelSale = user?.customRoleId ? Boolean(user.permissions?.includes('sales.cancel')) : user?.role === 'owner' || user?.role === 'business_admin';
  const [sale, setSale] = useState<SaleRecord | undefined>(); const [loading, setLoading] = useState(true); const [cancelling, setCancelling] = useState(false); const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const load = async () => { try { setSale(await dataService.getSale(id || '')); } catch (error) { toastError(error, 'No se pudo cargar la venta.'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [id]);
  const cancel = async () => {
    if (!sale || sale.status === 'cancelled') return;
    setCancelling(true);
    try { setSale(await dataService.cancelSale(sale.id)); toast.success('Venta anulada y existencias repuestas.'); }
    catch (error) { toastError(error, 'No se pudo anular la venta.'); throw error; }
    finally { setCancelling(false); }
  };
  if (loading) return <Layout><Card className="mx-auto max-w-5xl rounded-2xl p-12 text-center text-muted-foreground">Cargando detalle de venta…</Card></Layout>;
  if (!sale) return <Layout><Card className="mx-auto max-w-xl rounded-2xl p-10 text-center"><Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50"/><h1 className="text-xl font-semibold">Venta no encontrada</h1><p className="mt-1 text-sm text-muted-foreground">No encontramos el registro solicitado.</p><Button onClick={() => navigate('/sales')} className="mt-5 bg-orange-600 hover:bg-orange-700">Volver a ventas</Button></Card></Layout>;
  return <Layout><div className="mx-auto max-w-5xl space-y-6">
    <div className="flex flex-wrap items-center gap-3"><Button variant="outline" size="icon" onClick={() => navigate('/sales')} className="rounded-xl"><ArrowLeft className="h-4 w-4"/></Button><div className="min-w-0 flex-1"><p className="text-sm font-semibold uppercase tracking-[.16em] text-orange-600">Historial de ventas</p><h1 className="mt-1 truncate text-2xl font-bold sm:text-3xl">{sale.id}</h1><p className="mt-1 text-sm text-muted-foreground">{new Date(sale.date).toLocaleString('es-CO',{dateStyle:'medium',timeStyle:'short'})}</p></div><Badge variant="outline" className={sale.status === 'completed' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : sale.status === 'pending' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-rose-200 bg-rose-50 text-rose-700'}>{labels[sale.status]}</Badge></div>
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]"><div className="space-y-5"><Card className="overflow-hidden rounded-2xl border-border/70 shadow-sm"><div className="flex items-center justify-between border-b border-border/70 px-5 py-4"><div><h2 className="font-semibold">Productos vendidos</h2><p className="mt-1 text-sm text-muted-foreground">{sale.items.length} referencias · {sale.quantity} unidades</p></div><Package className="h-5 w-5 text-orange-600"/></div><div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-5 py-3">Producto</th><th className="px-5 py-3">Precio</th><th className="px-5 py-3">Cantidad</th><th className="px-5 py-3 text-right">Subtotal</th></tr></thead><tbody className="divide-y divide-border/60">{sale.items.map((item, i) => <tr key={`${item.productId}-${i}`}><td className="px-5 py-4"><p className="font-medium">{item.productName}</p><p className="mt-1 text-xs text-muted-foreground">SKU {item.sku || '—'}</p></td><td className="px-5 py-4">{money(item.price)}</td><td className="px-5 py-4">{item.quantity}</td><td className="px-5 py-4 text-right font-semibold">{money(item.subtotal)}</td></tr>)}</tbody></table></div></Card>
      <Card className="rounded-2xl border-border/70 p-5 shadow-sm"><div className="flex items-center gap-3"><UserRound className="h-5 w-5 text-orange-600"/><div><h2 className="font-semibold">Información de la operación</h2><p className="mt-1 text-sm text-muted-foreground">Datos de cliente y pago guardados con la venta.</p></div></div><Separator className="my-4"/><div className="grid gap-4 sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">Cliente</p><p className="mt-1 font-medium">{sale.customer || 'Cliente general'}</p></div><div><p className="text-xs text-muted-foreground">Método de pago</p><p className="mt-1 font-medium capitalize">{{cash:'Efectivo',card:'Tarjeta',digital:'Billetera digital',split:'Pago dividido',transfer:'Transferencia'}[sale.paymentMethod] || sale.paymentMethod}</p></div><div><p className="text-xs text-muted-foreground">Moneda</p><p className="mt-1 font-medium">{sale.currency || 'COP'}</p></div><div><p className="text-xs text-muted-foreground">Fecha de registro</p><p className="mt-1 font-medium">{new Date(sale.date).toLocaleString('es-CO',{dateStyle:'medium',timeStyle:'short'})}</p></div></div></Card></div>
      <div className="space-y-5"><Card className="rounded-2xl border-border/70 p-5 shadow-sm"><div className="flex items-center gap-3"><CircleDollarSign className="h-5 w-5 text-orange-600"/><h2 className="font-semibold">Resumen financiero</h2></div><div className="mt-5 space-y-3 text-sm"><div className="flex justify-between gap-3"><span className="text-muted-foreground">Subtotal</span><span>{money(sale.subtotal)}</span></div>{sale.lineDiscount > 0 && <div className="flex justify-between gap-3"><span className="text-muted-foreground">Descuentos por producto</span><span>-{money(sale.lineDiscount)}</span></div>}{sale.globalDiscount > 0 && <div className="flex justify-between gap-3"><span className="text-muted-foreground">Descuento general</span><span>-{money(sale.globalDiscount)}</span></div>}<div className="flex justify-between gap-3"><span className="text-muted-foreground">Impuesto ({Math.round(sale.taxRate * 100)}%)</span><span>{money(sale.tax)}</span></div><Separator/><div className="flex items-end justify-between gap-4"><span className="font-semibold">Total</span><span className="text-2xl font-bold text-orange-600">{money(sale.totalPrice)}</span></div></div><Button variant="outline" onClick={() => window.print()} className="mt-5 w-full rounded-xl"><Printer className="mr-2 h-4 w-4"/>Imprimir detalle</Button>{sale.status !== 'cancelled' && canCancelSale && <Button variant="outline" disabled={cancelling} onClick={() => setShowCancelConfirm(true)} className="mt-2 w-full rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50"><RotateCcw className="mr-2 h-4 w-4"/>{cancelling ? 'Anulando…' : 'Anular venta y reponer stock'}</Button>}</Card><Card className="rounded-2xl border-border/70 p-5 shadow-sm"><div className="flex gap-3"><CalendarDays className="mt-0.5 h-5 w-5 text-muted-foreground"/><div><h3 className="font-semibold">Trazabilidad</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">El detalle conserva el precio y los nombres del momento de la venta. Las anulaciones no borran el registro: lo marcan como anulado y dejan un movimiento de inventario inverso.</p></div></div></Card></div></div>
    <SaleReturnsPanel key={sale.id} sale={sale} onSaved={load} />
  </div>
    <ConfirmActionDialog
      open={showCancelConfirm}
      onOpenChange={setShowCancelConfirm}
      title="Anular venta y reponer inventario"
      description={sale ? `¿Anular la venta ${sale.id}? Se repondrán las cantidades al inventario y la venta permanecerá en el historial como anulada.` : ''}
      confirmLabel="Anular venta"
      destructive
      onConfirm={cancel}
    />
  </Layout>;
}
