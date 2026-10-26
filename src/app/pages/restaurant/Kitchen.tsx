import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bell, CheckCircle2, ChefHat, Clock3, MapPin, PackagePlus, Plus, RefreshCw, ShoppingBag, UtensilsCrossed } from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Layout } from '../../components/Layout';
import { EASE_OUT, RevealGroup, RevealItem } from '../../components/motion/Reveal';
import { AnimatedCounter } from '../../components/motion/AnimatedCounter';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { dataService, type OrderChannel, type OrderRecord, type OrderStatus } from '../../services/dataService';
import type { Product } from '../../utils/mockData';

const money = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
const STATUS_FLOW: OrderStatus[] = ['received', 'preparing', 'ready', 'delivered'];
const STATUS_LABEL: Record<OrderStatus, string> = { received: 'Recibido', preparing: 'En preparación', ready: 'Listo para entregar', delivered: 'Entregado', cancelled: 'Cancelado' };
const STATUS_STYLE: Record<OrderStatus, string> = {
  received: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300',
  preparing: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  delivered: 'border-border bg-muted text-muted-foreground',
  cancelled: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300',
};
const CHANNEL_LABEL: Record<OrderChannel, string> = { counter: 'Mostrador', takeaway: 'Para llevar', delivery: 'Domicilio', table: 'Mesa' };
type DraftLine = { productId: string; quantity: number; notes: string };

function OrderCard({ order, busy, onAdvance, onCancel, reveal = false }: { order: OrderRecord; busy: boolean; onAdvance: (order: OrderRecord) => void; onCancel: (order: OrderRecord) => void; reveal?: boolean }) {
  const ageMinutes = Math.max(0, Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000));
  const delayed = ageMinutes > 20 && ['received', 'preparing'].includes(order.status);
  const next = STATUS_FLOW[STATUS_FLOW.indexOf(order.status) + 1];
  const reduceMotion = useReducedMotion();
  // Entrada tipo Reveal (solo la pide la lista para las primeras ~12 tarjetas:
  // en listas largas el blur se limita), reordenación con layout y hover de -2 px.
  return <motion.div
    layout
    initial={reduceMotion ? false : (reveal ? { opacity: 0, filter: 'blur(12px)', y: 12 } : { opacity: 0, y: 12 })}
    animate={reveal ? { opacity: 1, filter: 'blur(0px)', y: 0 } : { opacity: 1, y: 0 }}
    exit={{ opacity: 0, scale: 0.96 }}
    whileHover={reduceMotion ? undefined : { y: -2 }}
    transition={{ duration: 0.45, ease: EASE_OUT }}
  ><Card className={`rounded-2xl border p-4 shadow-sm transition-shadow hover:shadow-lift ${delayed ? 'border-rose-300 dark:border-rose-900' : 'border-border/80'}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="font-semibold">{order.id}</p><p className="mt-0.5 truncate text-sm text-muted-foreground">{order.customer || 'Cliente general'}</p></div>
      <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLE[order.status]}`}>{STATUS_LABEL[order.status]}</span>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className="rounded-lg bg-muted px-2 py-1">{CHANNEL_LABEL[order.channel]}</span>
      {order.tableNumber != null && <span className="rounded-lg bg-primary/10 px-2 py-1 font-semibold text-primary">Mesa {order.tableNumber}</span>}
      {order.waiter && <span className="rounded-lg bg-muted px-2 py-1">{order.waiter}</span>}
      <span className={`inline-flex items-center gap-1 ${delayed ? 'font-semibold text-rose-600' : ''}`}><Clock3 className="h-3.5 w-3.5" />{ageMinutes} min</span>
      {order.phone && <span>{order.phone}</span>}
    </div>
    <div className="my-3 space-y-2 border-y border-border/70 py-3">
      {order.items.map((item, index) => <div key={`${item.productId}-${index}`} className="flex items-start justify-between gap-3 text-sm"><div className="min-w-0"><p className="font-medium">{item.quantity} × {item.productName}</p>{item.notes && <p className="text-xs text-muted-foreground">{item.notes}</p>}</div><span className="shrink-0 text-muted-foreground">{money(item.unitPrice * item.quantity)}</span></div>)}
      {order.notes && <p className="rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">Nota: {order.notes}</p>}
      {order.channel === 'delivery' && order.address && <p className="flex gap-1.5 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5 shrink-0" />{order.address}</p>}
    </div>
    <div className="flex items-center justify-between gap-3"><div><p className="text-xs text-muted-foreground">Total del pedido</p><p className="text-lg font-bold tracking-tight">{money(order.total)}</p></div><div className="flex gap-2">{['received', 'preparing', 'ready'].includes(order.status) && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onCancel(order)} className="rounded-lg">Cancelar</Button>}{next && <Button type="button" size="sm" disabled={busy} onClick={() => onAdvance(order)} className="rounded-lg">{next === 'preparing' ? 'Preparar' : next === 'ready' ? 'Marcar listo' : 'Entregado'} <CheckCircle2 className="ml-1.5 h-4 w-4" /></Button>}</div></div>
    {delayed && <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-rose-600"><AlertTriangle className="h-3.5 w-3.5" />Revisar demora de preparación</p>}
  </Card></motion.div>;
}

export function Kitchen() {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [channel, setChannel] = useState<OrderChannel>('counter');
  const [customer, setCustomer] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [lineNotes, setLineNotes] = useState('');
  const [draftItems, setDraftItems] = useState<DraftLine[]>([]);
  const [history, setHistory] = useState(false);

  const sellableProducts = useMemo(() => products.filter(p => p.productType !== 'ingredient' && p.productType !== 'supplies'), [products]);
  const draftTotal = useMemo(() => draftItems.reduce((sum, item) => sum + (sellableProducts.find(p => p.id === item.productId)?.price || 0) * item.quantity, 0), [draftItems, sellableProducts]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [allProducts, allOrders] = await Promise.all([dataService.getProducts(), dataService.getOrders()]);
      setProducts(allProducts); setOrders(allOrders);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los pedidos.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const addDraftItem = () => {
    const amount = Number(quantity);
    const product = sellableProducts.find(p => p.id === selectedProduct);
    if (!product) { toast.error('Selecciona un producto del menú.'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { toast.error('La cantidad debe ser mayor que cero.'); return; }
    setDraftItems(prev => [...prev, { productId: product.id, quantity: amount, notes: lineNotes.trim() }]);
    setSelectedProduct(''); setQuantity('1'); setLineNotes('');
  };
  const saveOrder = async (event: React.FormEvent) => {
    event.preventDefault();
    if (draftItems.length === 0) { toast.error('Agrega al menos un producto.'); return; }
    if (channel === 'delivery' && !address.trim()) { toast.error('Para un domicilio, registra la dirección.'); return; }
    setSaving(true);
    try {
      await dataService.createOrder({ channel, customer: customer.trim() || 'Cliente general', phone: phone.trim(), address: address.trim(), notes: notes.trim(), items: draftItems });
      setDraftItems([]); setCustomer(''); setPhone(''); setAddress(''); setNotes(''); setChannel('counter'); setShowForm(false);
      toast.success('Pedido guardado en la base de datos.'); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo registrar el pedido.'); }
    finally { setSaving(false); }
  };
  const setStatus = async (order: OrderRecord, status: OrderStatus) => {
    setBusyOrderId(order.id);
    try { await dataService.updateOrderStatus(order.id, status); setOrders(prev => prev.map(row => row.id === order.id ? { ...row, status } : row)); toast.success(`Pedido ${STATUS_LABEL[status].toLowerCase()}.`); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el pedido.'); }
    finally { setBusyOrderId(null); }
  };
  const activeOrders = orders.filter(order => !['delivered', 'cancelled'].includes(order.status));
  const visibleOrders = history ? orders.filter(order => ['delivered', 'cancelled'].includes(order.status)) : activeOrders;
  const columns: { status: OrderStatus; title: string; hint: string; icon: React.ElementType; color: string; bg: string }[] = history ? [] : [
    { status: 'received', title: 'Nuevos', hint: 'Por preparar', icon: Bell, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-100 dark:bg-blue-950/40' },
    { status: 'preparing', title: 'En preparación', hint: 'En cocina', icon: Clock3, color: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-950/40' },
    { status: 'ready', title: 'Listos', hint: 'Para entregar', icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-950/40' },
  ];
  const resetForm = () => { setShowForm(false); setDraftItems([]); setCustomer(''); setPhone(''); setAddress(''); setNotes(''); setChannel('counter'); };

  return <Layout><RevealGroup className="mx-auto max-w-7xl space-y-6">
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><RevealItem><div><p className="text-sm font-semibold uppercase tracking-[.16em] text-primary">Operación diaria</p><h1 className="mt-1 flex items-center gap-2 text-3xl font-bold tracking-tight"><ChefHat className="h-7 w-7 text-primary" /> Cocina y pedidos</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Registra pedidos de mostrador, para llevar, mesa o domicilio, y sigue su avance sin depender de comandas simuladas.</p></div></RevealItem><RevealItem className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => void load()} disabled={loading} className="rounded-xl"><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Actualizar</Button><motion.div whileTap={{ scale: 0.95 }}><Button type="button" onClick={() => setShowForm(v => !v)} style={{ background: 'linear-gradient(135deg, var(--accent-from), var(--accent-to))' }} className="rounded-xl hover:opacity-90"><Plus className="mr-2 h-4 w-4" />Nuevo pedido</Button></motion.div></RevealItem></div>
    <div className="grid gap-3 sm:grid-cols-3"><RevealItem><Card className="h-full rounded-2xl border-border/70 p-5 shadow-sm"><p className="text-sm text-muted-foreground">Pedidos activos</p><p className="mt-2 text-3xl font-bold"><AnimatedCounter value={activeOrders.length} /></p><p className="mt-1 text-xs text-muted-foreground">En el flujo de preparación</p></Card></RevealItem><RevealItem><Card className="h-full rounded-2xl border-border/70 p-5 shadow-sm"><p className="text-sm text-muted-foreground">En preparación</p><p className="mt-2 text-3xl font-bold text-amber-700 dark:text-amber-400"><AnimatedCounter value={orders.filter(o => o.status === 'preparing').length} /></p><p className="mt-1 text-xs text-muted-foreground">Pedidos que cocina está atendiendo</p></Card></RevealItem><RevealItem><Card className="h-full rounded-2xl border-border/70 p-5 shadow-sm"><p className="text-sm text-muted-foreground">Listos para entregar</p><p className="mt-2 text-3xl font-bold text-emerald-600"><AnimatedCounter value={orders.filter(o => o.status === 'ready').length} /></p><p className="mt-1 text-xs text-muted-foreground">Pendientes de entrega</p></Card></RevealItem></div>
    {showForm && <Card className="rounded-2xl border-orange-200 p-5 shadow-sm dark:border-orange-900 sm:p-6"><div className="mb-5 flex items-start gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300"><ShoppingBag className="h-5 w-5" /></div><div><h2 className="text-lg font-semibold">Registrar pedido</h2><p className="text-sm text-muted-foreground">Se guardará como recibido; el cobro y el descuento definitivo de inventario se realizan desde el punto de venta.</p></div></div><form onSubmit={saveOrder} className="space-y-5"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><div className="space-y-2"><Label htmlFor="channel">Modalidad</Label><select id="channel" value={channel} onChange={e => setChannel(e.target.value as OrderChannel)} className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm">{Object.entries(CHANNEL_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="space-y-2"><Label htmlFor="customer">Cliente</Label><Input id="customer" value={customer} onChange={e => setCustomer(e.target.value)} maxLength={120} placeholder="Nombre del cliente" className="h-10 rounded-xl" /></div><div className="space-y-2"><Label htmlFor="phone">Teléfono</Label><Input id="phone" value={phone} onChange={e => setPhone(e.target.value)} maxLength={60} placeholder="300 000 0000" className="h-10 rounded-xl" /></div><div className="space-y-2"><Label htmlFor="address">Dirección {channel === 'delivery' ? '*' : '(opcional)'}</Label><Input id="address" value={address} onChange={e => setAddress(e.target.value)} maxLength={240} required={channel === 'delivery'} placeholder="Dirección de entrega" className="h-10 rounded-xl" /></div></div>
    <div className="grid gap-4 rounded-xl border border-border/70 p-4 md:grid-cols-[1fr_130px_1fr_auto]"><div className="space-y-2"><Label htmlFor="orderProduct">Producto</Label><select id="orderProduct" value={selectedProduct} onChange={e => setSelectedProduct(e.target.value)} className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"><option value="">Selecciona del menú…</option>{sellableProducts.map(product => <option key={product.id} value={product.id}>{product.name} · {money(product.price)} · stock {product.stock}</option>)}</select></div><div className="space-y-2"><Label htmlFor="orderQuantity">Cantidad</Label><Input id="orderQuantity" type="number" min="0.001" step="0.001" value={quantity} onChange={e => setQuantity(e.target.value)} className="h-10 rounded-xl" /></div><div className="space-y-2"><Label htmlFor="lineNotes">Indicaciones del producto</Label><Input id="lineNotes" value={lineNotes} onChange={e => setLineNotes(e.target.value)} maxLength={300} placeholder="Sin cebolla, salsa aparte…" className="h-10 rounded-xl" /></div><div className="flex items-end"><Button type="button" variant="outline" onClick={addDraftItem} className="h-10 w-full rounded-xl md:w-auto"><PackagePlus className="mr-2 h-4 w-4" />Agregar</Button></div></div>
    {draftItems.length > 0 && <div className="space-y-2">{draftItems.map((item, index) => { const p = sellableProducts.find(product => product.id === item.productId); return <div key={`${item.productId}-${index}`} className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2 text-sm"><span>{item.quantity} × {p?.name || item.productId}{item.notes && <span className="ml-2 text-xs text-muted-foreground">({item.notes})</span>}</span><div className="flex items-center gap-3"><span className="font-semibold">{money((p?.price || 0) * item.quantity)}</span><button type="button" onClick={() => setDraftItems(prev => prev.filter((_, i) => i !== index))} className="text-xs font-semibold text-rose-600">Quitar</button></div></div>})}<div className="flex justify-end gap-4 border-t border-border pt-3"><span className="text-sm text-muted-foreground">Total estimado</span><span className="text-lg font-bold">{money(draftTotal)}</span></div></div>}
    <div className="space-y-2"><Label htmlFor="orderNotes">Nota general del pedido</Label><Input id="orderNotes" value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000} placeholder="Observaciones para cocina o entrega" className="h-10 rounded-xl" /></div><div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="outline" onClick={resetForm} className="rounded-xl">Cerrar</Button><Button type="submit" disabled={saving || !draftItems.length} style={{ background: 'linear-gradient(135deg, var(--accent-from), var(--accent-to))' }} className="rounded-xl hover:opacity-90">{saving ? 'Guardando…' : 'Guardar pedido'}</Button></div></form></Card>}
    <RevealItem><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">{history ? 'Historial de pedidos' : 'Pedidos en curso'}</h2><p className="text-sm text-muted-foreground">{history ? 'Pedidos entregados o cancelados.' : 'Actualiza cada pedido cuando cambie su estado.'}</p></div><div className="flex rounded-xl border border-border bg-muted/40 p-1"><button type="button" onClick={() => setHistory(false)} className={`relative rounded-lg px-3 py-2 text-sm font-medium transition-colors ${!history ? 'text-foreground' : 'text-muted-foreground'}`}>{!history && <motion.span layoutId="orders-segment" aria-hidden="true" className="absolute inset-0 rounded-lg bg-background shadow-sm" transition={{ type: 'spring', stiffness: 300, damping: 30 }} />}<span className="relative">En curso</span></button><button type="button" onClick={() => setHistory(true)} className={`relative rounded-lg px-3 py-2 text-sm font-medium transition-colors ${history ? 'text-foreground' : 'text-muted-foreground'}`}>{history && <motion.span layoutId="orders-segment" aria-hidden="true" className="absolute inset-0 rounded-lg bg-background shadow-sm" transition={{ type: 'spring', stiffness: 300, damping: 30 }} />}<span className="relative">Historial</span></button></div></div></RevealItem>
    <RevealItem>{loading ? <Card className="rounded-2xl p-10 text-center text-sm text-muted-foreground">Cargando pedidos…</Card> : history ? (visibleOrders.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visibleOrders.map(order => <OrderCard key={order.id} order={order} busy={busyOrderId === order.id} reveal={visibleOrders.indexOf(order) < 12} onAdvance={row => { const next = STATUS_FLOW[STATUS_FLOW.indexOf(row.status) + 1]; if (next) void setStatus(row, next); }} onCancel={row => void setStatus(row, 'cancelled')} />)}</div> : <Card className="rounded-2xl border-dashed p-10 text-center"><CheckCircle2 className="mx-auto h-9 w-9 text-muted-foreground/50"/><p className="mt-3 font-semibold">Sin pedidos en el historial</p><p className="mt-1 text-sm text-muted-foreground">Los pedidos entregados o cancelados aparecerán aquí.</p></Card>) : <div className="grid gap-4 xl:grid-cols-3">{columns.map(column => { const columnOrders = visibleOrders.filter(order => order.status === column.status); const ColIcon = column.icon; return <section key={column.status} className="min-w-0 rounded-2xl bg-muted/30 p-3"><div className={`mb-3 flex items-center justify-between gap-2 rounded-full px-3 py-2 ${column.bg}`}><div className="flex items-center gap-2"><ColIcon size={16} className={column.color} /><div><h3 className={`text-sm font-bold ${column.color}`}>{column.title}</h3><p className="text-xs text-muted-foreground">{column.hint}</p></div></div><span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-background px-2 text-sm font-semibold"><AnimatedCounter value={columnOrders.length} /></span></div><AnimatePresence mode="popLayout">{columnOrders.length === 0 ? <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-xl border border-dashed border-border/70 bg-background/40 p-6 text-center text-sm text-muted-foreground/75">Sin pedidos en esta etapa.</motion.div> : columnOrders.map(order => <OrderCard key={order.id} order={order} busy={busyOrderId === order.id} reveal={visibleOrders.indexOf(order) < 12} onAdvance={row => { const next = STATUS_FLOW[STATUS_FLOW.indexOf(row.status) + 1]; if (next) void setStatus(row, next); }} onCancel={row => void setStatus(row, 'cancelled')} />)}</AnimatePresence></section>})}</div>}</RevealItem>
    <RevealItem><div className="flex items-start gap-2 rounded-xl border border-border/70 bg-muted/20 p-3 text-xs leading-5 text-muted-foreground"><UtensilsCrossed className="mt-0.5 h-4 w-4 shrink-0 text-primary"/><p>El pedido de cocina no equivale a una venta cobrada. El inventario se descuenta al registrar la venta en el punto de venta; esto evita contar dos veces la misma salida de inventario.</p></div></RevealItem>
  </RevealGroup></Layout>;
}
