import { canPerformAction } from '../../security/permissions';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  BellOff,
  CheckCircle2,
  ClipboardList,
  Clock3,
  MapPin,
  Minus,
  Plus,
  Receipt,
  Search,
  Send,
  ShoppingCart,
  Trash2,
  Users,
  UtensilsCrossed,
} from 'lucide-react';
import { toast } from 'sonner';
import { imagesEnabled, productImageUrl } from '../../utils/productImage';
import { mergeableLine } from '../../utils/orderCart';
import { toastError } from '../../utils/notifications';
import { Layout } from '../../components/Layout';
import { StaffSwitcher } from '../../components/restaurant/StaffSwitcher';
import { PedidoStatusBadge } from '../../components/restaurant/PedidoStatusBadge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Switch } from '../../components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { useAuth } from '../../context/AuthContext';
import { useBusiness } from '../../context/BusinessContext';
import { useRestaurantScope, useRestaurantBusinessId } from '../../utils/restaurantScope';
import { useRestaurantStaff } from '../../utils/restaurantStaffStore';
import { useRestaurantSettings } from '../../utils/restaurantSettingsStore';
import { useRestaurantCatalog, type RestaurantCatalogProduct } from '../../utils/restaurantCatalogStore';
import { useNow, useRestaurantOrders, useRestaurantTables } from '../../utils/restaurantOrdersHook';
import { getJornadaKey, formatJornadaTitle, formatMoney, formatTime, minutesSince, orderItemSummary } from '../../utils/restaurantFormat';
import type { Pedido } from '../../utils/restaurantTypes';
import { deliverRestaurantOrder } from '../../utils/restaurantOrdersService';
import { primeRestaurantAudio, playReadyOrderChime, vibrateReadyOrder } from '../../utils/restaurantAudio';
import type { Product } from '../../utils/types';

type WaiterView = 'nuevo' | 'pedidos';
type OrderFilter = 'todos' | 'listos' | 'preparando' | 'pendientes' | 'entregados';

interface CartLine {
  lineId: string;
  productId: string;
  cantidad: number;
  nota: string;
}

const FILTER_LABELS: Record<OrderFilter, string> = {
  todos: 'Todos',
  listos: 'Listos',
  preparando: 'En preparación',
  pendientes: 'Pendientes',
  entregados: 'Entregados',
};

function normalizeText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function tableDisplayName(table: { id: string; number: number }, names: Record<string, string>) {
  return names[table.id] || `Mesa ${table.number}`;
}

export function Waiter() {
  const { user } = useAuth();
  const canCollect = canPerformAction(user, 'sales.create');
  const { config } = useBusiness();
  const scope = useRestaurantScope();
  const businessId = useRestaurantBusinessId();
  const ordersScope = import.meta.env.VITE_RESTAURANT_BACKEND === 'firebase' ? businessId : scope;
  const { settings } = useRestaurantSettings(scope);
  const { staff, activeStaff, toEmployee, setActive } = useRestaurantStaff(scope, user?.name || '');
  const active = activeStaff('mesero');
  const { orders, loading: ordersLoading, error: ordersError, repository } = useRestaurantOrders(ordersScope);
  const { tables, loading: tablesLoading } = useRestaurantTables();
  const { activeMenu, loading: menuLoading, error: menuError } = useRestaurantCatalog(scope);
  const now = useNow(30_000);

  const [view, setView] = useState<WaiterView>('nuevo');
  const [selectedTable, setSelectedTable] = useState<(typeof tables)[number] | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Todos');
  const [cart, setCart] = useState<CartLine[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmation, setConfirmation] = useState<Pedido | null>(null);
  const [filter, setFilter] = useState<OrderFilter>('todos');
  const [onlyMine, setOnlyMine] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const alertKey = `manager_stock_restaurant_alerta_${scope}`;
  const [alertEnabled, setAlertEnabled] = useState(() => {
    try {
      return localStorage.getItem(alertKey) !== 'off';
    } catch {
      return true;
    }
  });

  const activeTables = useMemo(
    () => tables.filter((table) => table.status === 'active'),
    [tables],
  );
  const jornada = getJornadaKey(now, settings.startTime);
  const jornadaOrders = useMemo(
    () => orders.filter((order) => order.jornada === jornada),
    [orders, jornada],
  );

  const cartLines = useMemo(() => cart.map((line) => {
    const product = activeMenu.find((item) => item.id === line.productId);
    return product ? { ...line, product } : null;
  }).filter(Boolean) as Array<CartLine & { product: RestaurantCatalogProduct }>, [cart, activeMenu]);

  const cartCount = cartLines.reduce((sum, line) => sum + line.cantidad, 0);
  const subtotal = cartLines.reduce((sum, line) => sum + line.product.price * line.cantidad, 0);
  const taxRate = Math.max(0, Number(config?.taxRate) || 0);
  const impuesto = Math.round(subtotal * taxRate);
  const total = subtotal + impuesto;

  const categories = useMemo(() => {
    const set = new Set(activeMenu.map((product) => product.category || 'Otros'));
    return ['Todos', ...Array.from(set).sort((a, b) => a.localeCompare(b, 'es'))];
  }, [activeMenu]);

  const filteredMenu = useMemo(() => {
    const term = normalizeText(search.trim());
    return activeMenu.filter((product) => {
      const categoryMatch = category === 'Todos' || (product.category || 'Otros') === category;
      if (!categoryMatch) return false;
      if (!term) return true;
      return normalizeText(`${product.name} ${product.category} ${product.description || ''}`).includes(term);
    });
  }, [activeMenu, category, search]);

  const baseOrders = useMemo(
    () => onlyMine && active ? jornadaOrders.filter((order) => order.meseroId === active.id) : jornadaOrders,
    [jornadaOrders, onlyMine, active],
  );

  const counts = useMemo(() => ({
    todos: baseOrders.length,
    listos: baseOrders.filter((order) => order.estado === 'finalizado').length,
    preparando: baseOrders.filter((order) => order.estado === 'en_preparacion').length,
    pendientes: baseOrders.filter((order) => order.estado === 'pendiente').length,
    entregados: baseOrders.filter((order) => order.estado === 'entregado').length,
  }), [baseOrders]);

  const readyOrders = useMemo(
    () => baseOrders
      .filter((order) => order.estado === 'finalizado')
      .sort((a, b) => (a.finalizadoEn || '').localeCompare(b.finalizadoEn || '')),
    [baseOrders],
  );

  const visibleOrders = useMemo(() => baseOrders.filter((order) => {
    if (filter === 'todos') return order.estado !== 'finalizado';
    if (filter === 'listos') return order.estado === 'finalizado';
    if (filter === 'preparando') return order.estado === 'en_preparacion';
    if (filter === 'pendientes') return order.estado === 'pendiente';
    return order.estado === 'entregado';
  }), [baseOrders, filter]);

  const seenReadyRef = useRef<{ key: string; ids: Set<string> } | null>(null);
  const realtimeKey = `${scope}:${jornada}`;

  useEffect(() => {
    try {
      localStorage.setItem(alertKey, alertEnabled ? 'on' : 'off');
    } catch {
      // La alerta sigue activa en esta sesión aunque no se pueda persistir.
    }
  }, [alertEnabled, alertKey]);

  useEffect(() => {
    const handler = () => primeRestaurantAudio();
    window.addEventListener('pointerdown', handler, { once: true });
    return () => window.removeEventListener('pointerdown', handler);
  }, []);

  useEffect(() => {
    const ids = new Set(jornadaOrders.filter((order) => order.estado === 'finalizado').map((order) => order.id));
    const previous = seenReadyRef.current;
    if (!previous || previous.key !== realtimeKey) {
      seenReadyRef.current = { key: realtimeKey, ids };
      return;
    }
    const nuevos = [...ids].filter((id) => !previous.ids.has(id));
    seenReadyRef.current = { key: realtimeKey, ids };
    if (nuevos.length > 0 && alertEnabled) {
      playReadyOrderChime();
      vibrateReadyOrder();
    }
  }, [jornadaOrders, alertEnabled, realtimeKey]);

  const openNewTab = () => {
    if (confirmation) {
      setConfirmation(null);
      setSelectedTable(null);
    }
    setView('nuevo');
    scrollToTop();
  };

  const addProduct = (product: Product) => {
    setCart((current) => {
      const line = mergeableLine(current, product.id, (item) => item.nota);
      if (line) {
        return current.map((item) => item.lineId === line.lineId ? { ...item, cantidad: item.cantidad + 1 } : item);
      }
      return [...current, { lineId: crypto.randomUUID(), productId: product.id, cantidad: 1, nota: '' }];
    });
  };

  const changeQuantity = (lineId: string, delta: number) => {
    setCart((current) => current
      .map((line) => line.lineId === lineId ? { ...line, cantidad: Math.max(0, line.cantidad + delta) } : line)
      .filter((line) => line.cantidad > 0));
  };

  const removeLine = (lineId: string) => {
    setCart((current) => current.filter((line) => line.lineId !== lineId));
  };

  const setLineNote = (lineId: string, nota: string) => {
    setCart((current) => current.map((line) => line.lineId === lineId ? { ...line, nota } : line));
  };

  const scrollToTop = () => {
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    contentRef.current?.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  };

  const resetAfterOrder = () => {
    setConfirmation(null);
    setSelectedTable(null);
    setCart([]);
    setSearch('');
    setCategory('Todos');
    setView('nuevo');
    scrollToTop();
  };

  const sendOrder = async () => {
    if (!selectedTable) {
      toast.error('Selecciona una mesa antes de enviar el pedido.');
      return;
    }
    if (!active) {
      toast.error('Selecciona el mesero activo antes de enviar el pedido.');
      return;
    }
    if (!cartLines.length) return;
    primeRestaurantAudio();
    setSending(true);
    try {
      const order = await repository.crearPedido({
        negocioId: scope,
        mesaId: selectedTable.id,
        mesaNumero: selectedTable.number,
        mesaNombre: tableDisplayName(selectedTable, settings.tableNames),
        mesero: toEmployee(active),
        items: cartLines.map((line) => ({
          productId: line.product.id,
          nombre: line.product.name,
          precioUnitario: line.product.price,
          cantidad: line.cantidad,
          nota: line.nota,
          ventaDirecta: line.product.directSale,
        })),
        horaInicioJornada: settings.startTime,
        taxRate,
      });
      setConfirmation(order);
      setCart([]);
      setCartOpen(false);
      setCategory('Todos');
      setSearch('');
      scrollToTop();
    } catch (reason) {
      toastError(reason, 'No se pudo enviar el pedido.');
    } finally {
      setSending(false);
    }
  };

  const deliverOrder = async (order: Pedido) => {
    if (!active) {
      toast.error('Selecciona el mesero activo antes de entregar el pedido.');
      return;
    }
    primeRestaurantAudio();
    setBusyOrderId(order.id);
    try {
      await deliverRestaurantOrder(repository, order, toEmployee(active));
      toast.success(`Pedido #${order.numero} entregado. Venta registrada.`);
    } catch (reason) {
      toastError(reason, 'No se pudo entregar el pedido.');
    } finally {
      setBusyOrderId(null);
    }
  };

  const activeUserName = active?.name || user?.name || 'equipo';

  return (
    <Layout>
      {ordersError && <p role="alert" className="mb-3 rounded border border-red-200 p-3 text-red-600">{ordersError}</p>}
      <div className="flex h-[calc(100dvh-6rem)] flex-col overflow-hidden lg:h-auto lg:min-h-0 lg:overflow-visible">
        <div ref={contentRef} className="flex-1 overflow-y-auto pb-4 lg:overflow-visible lg:pb-0">
          <header className={`${selectedTable ? 'hidden lg:flex' : 'flex'} flex-col gap-3 sm:flex-row sm:items-start sm:justify-between`}>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Restaurante · {formatJornadaTitle(jornada, settings.startTime)}</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Hola, {activeUserName}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {view === 'nuevo'
                  ? selectedTable
                    ? `${tableDisplayName(selectedTable, settings.tableNames)} · ${selectedTable.zone || 'Salón'}`
                    : 'Elige una mesa para comenzar un pedido.'
                  : `${jornadaOrders.length} pedido${jornadaOrders.length === 1 ? '' : 's'} en la jornada.`}
              </p>
            </div>
            <StaffSwitcher scope={scope} role="mesero" currentUserName={user?.name || ''} />
          </header>

          {!active && (
            <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
              No hay un mesero activo. Abre <strong>Ajustes &gt; Usuarios</strong> o usa el selector de usuario.
            </div>
          )}

          {view === 'nuevo' && (
            <div className="mt-5">
              {confirmation ? (
                <section className="mx-auto max-w-xl rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white">
                    <CheckCircle2 size={32} />
                  </div>
                  <h2 className="mt-4 text-2xl font-bold text-foreground">
                    Pedido #{confirmation.numero} {confirmation.estado === 'finalizado' ? 'listo para llevar' : 'enviado a cocina'}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {confirmation.mesaNombre} · {orderItemSummary(confirmation.items.reduce((sum, item) => sum + item.cantidad, 0))} · {formatMoney(confirmation.total)}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {confirmation.estado === 'finalizado'
                      ? 'No requiere preparación: ya está listo para entregar.'
                      : 'Cocina lo recibió en Entrantes. Te avisaremos cuando esté listo.'}
                  </p>
                  <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                    <Button className="h-12 flex-1" onClick={resetAfterOrder}>
                      Tomar otro pedido
                    </Button>
                    <Button variant="outline" className="h-12 flex-1" onClick={() => { setConfirmation(null); setView('pedidos'); scrollToTop(); }}>
                      Ver pedidos del local
                    </Button>
                  </div>
                </section>
              ) : selectedTable ? (
                <section>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="ghost" className="h-11 px-3" onClick={() => { setSelectedTable(null); setCart([]); scrollToTop(); }}>
                      <ArrowLeft size={18} /> Mesas
                    </Button>
                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
                      <UtensilsCrossed size={16} className="text-primary" /> {tableDisplayName(selectedTable, settings.tableNames)}
                    </span>
                    {selectedTable.zone && <Badge variant="outline">{selectedTable.zone}</Badge>}
                  </div>

                  <div className="relative mt-3">
                    <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Buscar en el menú"
                      className="h-12 rounded-2xl pl-10"
                      aria-label="Buscar en el menú"
                    />
                  </div>

                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {categories.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setCategory(item)}
                        className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${category === item ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:bg-accent'}`}
                      >
                        {item}
                      </button>
                    ))}
                  </div>

                  {menuError && (
                    <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                      {menuError}
                    </div>
                  )}

                  {menuLoading ? (
                    <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {[1, 2, 3, 4].map((item) => <div key={item} className="h-36 animate-pulse rounded-2xl border border-border bg-muted/50" />)}
                    </div>
                  ) : filteredMenu.length === 0 ? (
                    <div className="mt-8 rounded-3xl border border-dashed border-border p-8 text-center">
                      <Search size={28} className="mx-auto text-muted-foreground" />
                      <p className="mt-3 font-semibold text-foreground">No encontramos productos</p>
                      <p className="mt-1 text-sm text-muted-foreground">Prueba con otro término o cambia de categoría.</p>
                    </div>
                  ) : (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {filteredMenu.map((product) => {
                        const inCartQty = cart.reduce((sum, line) => sum + (line.productId === product.id ? line.cantidad : 0), 0);
                        return (
                          <article key={product.id} className="flex min-h-36 flex-col rounded-2xl border border-border bg-card p-4 shadow-sm">
                            {productImageUrl(product.image, imagesEnabled(config)) && (
                              <img src={productImageUrl(product.image, true)!} alt={product.name} loading="lazy" className="mb-3 h-24 w-full rounded-lg object-cover" />
                            )}
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h3 className="font-semibold leading-snug text-foreground">{product.name}</h3>
                                <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{product.category || 'Otros'}</p>
                              </div>
                              {inCartQty > 0 && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">x{inCartQty}</span>}
                            </div>
                            {product.description && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{product.description}</p>}
                            <div className="mt-auto flex items-center justify-between gap-3 pt-3">
                              <span className="text-base font-bold text-foreground">{formatMoney(product.price, config?.currency)}</span>
                              <Button size="icon" className="h-11 w-11 rounded-xl" onClick={() => addProduct(product)} aria-label={`Agregar ${product.name}`}>
                                <Plus size={20} />
                              </Button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              ) : (
                <section>
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-bold text-foreground">Mesas habilitadas</h2>
                      <p className="text-sm text-muted-foreground">{activeTables.length} mesa{activeTables.length === 1 ? '' : 's'} disponible{activeTables.length === 1 ? '' : 's'}.</p>
                    </div>
                    <Badge variant="outline" className="mb-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                      Local
                    </Badge>
                  </div>

                  {tablesLoading ? (
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {[1, 2, 3, 4].map((item) => <div key={item} className="h-32 animate-pulse rounded-3xl border border-border bg-muted/50" />)}
                    </div>
                  ) : activeTables.length === 0 ? (
                    <div className="mt-8 rounded-3xl border border-dashed border-border p-8 text-center">
                      <UtensilsCrossed size={32} className="mx-auto text-muted-foreground" />
                      <p className="mt-3 font-semibold text-foreground">No hay mesas habilitadas</p>
                      <p className="mt-1 text-sm text-muted-foreground">Crea o activa mesas desde Ajustes &gt; Mesas.</p>
                      <Button asChild className="mt-4 h-11">
                        <a href="/restaurant/settings?tab=mesas">Ir a Ajustes</a>
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {activeTables.map((table) => {
                        const openOrders = jornadaOrders.filter((order) => order.mesaId === table.id && !['entregado', 'cancelado'].includes(order.estado)).length;
                        return (
                          <button
                            key={table.id}
                            type="button"
                            onClick={() => { setSelectedTable(table); setCart([]); setSearch(''); setCategory('Todos'); scrollToTop(); }}
                            className="group flex min-h-32 flex-col rounded-3xl border border-border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                              <UtensilsCrossed size={22} />
                            </span>
                            <span className="mt-3 text-lg font-bold leading-tight text-foreground">{tableDisplayName(table, settings.tableNames)}</span>
                            <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                              <MapPin size={12} /> {table.zone || 'Salón'} · {table.capacity} puestos
                            </span>
                            <span className={`mt-2 text-xs font-semibold ${openOrders ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                              {openOrders ? `${openOrders} pedido${openOrders === 1 ? '' : 's'} abierto${openOrders === 1 ? '' : 's'}` : 'Disponible'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}
            </div>
          )}

          {view === 'pedidos' && (
            <section className="mt-5 space-y-5">
              {readyOrders.length > 0 && filter === 'todos' && (
                <div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
                      <Bell size={18} />
                    </span>
                    <div>
                      <h2 className="text-lg font-bold text-foreground">Listos para llevar</h2>
                      <p className="text-sm text-muted-foreground">Avisa al cliente y marca la entrega.</p>
                    </div>
                    <Badge className="ml-auto border-transparent bg-emerald-500 text-white">{readyOrders.length}</Badge>
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {readyOrders.map((order) => (
                      <ReadyOrderCard
                        key={order.id}
                        order={order}
                        busy={busyOrderId === order.id}
                        onDeliver={canCollect ? () => deliverOrder(order) : undefined}
                        currency={config?.currency}
                        now={now}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  {(['todos', 'listos', 'preparando', 'pendientes', 'entregados'] as OrderFilter[]).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setFilter(item)}
                      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${filter === item ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:bg-accent'}`}
                    >
                      {FILTER_LABELS[item]}
                      <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${filter === item ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground'}`}>{counts[item]}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-border pt-3">
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-foreground">
                    <Switch checked={onlyMine} onCheckedChange={setOnlyMine} />
                    Solo míos
                  </label>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-foreground">
                    <Switch
                      checked={alertEnabled}
                      onCheckedChange={(checked) => {
                        setAlertEnabled(checked);
                        if (checked) primeRestaurantAudio();
                      }}
                    />
                    {alertEnabled ? <Bell size={16} className="text-primary" /> : <BellOff size={16} className="text-muted-foreground" />}
                    Alerta
                  </label>
                </div>
              </div>

              {filter === 'listos' ? (
                readyOrders.length === 0 ? (
                  <EmptyOrders title="No hay pedidos listos" text="Cuando cocina termine un pedido aparecerá aquí." />
                ) : (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {readyOrders.map((order) => (
                      <ReadyOrderCard
                        key={order.id}
                        order={order}
                        busy={busyOrderId === order.id}
                        onDeliver={canCollect ? () => deliverOrder(order) : undefined}
                        currency={config?.currency}
                        now={now}
                      />
                    ))}
                  </div>
                )
              ) : visibleOrders.length === 0 ? (
                <EmptyOrders
                  title={ordersLoading ? 'Cargando pedidos…' : 'No hay pedidos en este filtro'}
                  text={onlyMine ? 'Prueba a desactivar “Solo míos”.' : 'Los pedidos nuevos aparecerán aquí en tiempo real.'}
                />
              ) : (
                <div className="space-y-2.5">
                  {visibleOrders.map((order) => (
                    <OrderHistoryCard key={order.id} order={order} currency={config?.currency} now={now} />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        <div className="z-20 -mx-4 shrink-0 border-t border-border bg-background/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          {view === 'nuevo' && selectedTable && !confirmation && cartCount > 0 && (
            <div className="mx-auto mb-2 max-w-md">
              <Button className="h-12 w-full justify-between rounded-2xl px-4" onClick={() => setCartOpen(true)}>
                <span className="flex items-center gap-2"><ShoppingCart size={18} /> {cartCount} · Ver pedido</span>
                <span className="font-bold">{formatMoney(total, config?.currency)}</span>
              </Button>
            </div>
          )}
          <nav aria-label="Navegación de pedidos" className="mx-auto grid max-w-md grid-cols-2 gap-1 rounded-2xl border border-border bg-card p-1 shadow-sm">
            <button
              type="button"
              onClick={openNewTab}
              className={`flex min-h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === 'nuevo' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
            >
              <UtensilsCrossed size={18} /> Nuevo pedido
            </button>
            <button
              type="button"
              onClick={() => { setView('pedidos'); scrollToTop(); }}
              className={`relative flex min-h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === 'pedidos' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
            >
              <ClipboardList size={18} /> Pedidos
              {readyOrders.length > 0 && (
                <span className="absolute right-2 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{readyOrders.length}</span>
              )}
            </button>
          </nav>
        </div>
      </div>

      <Dialog open={cartOpen} onOpenChange={setCartOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto max-sm:bottom-0 max-sm:top-auto max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-3xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt size={20} className="text-primary" /> Pedido de {selectedTable ? tableDisplayName(selectedTable, settings.tableNames) : 'la mesa'}
            </DialogTitle>
            <DialogDescription>Revisa cantidades y agrega una nota por producto si hace falta.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {cartLines.map((line) => (
              <div key={line.lineId} className="rounded-2xl border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold leading-snug text-foreground">{line.product.name}</p>
                    <p className="text-xs text-muted-foreground">{formatMoney(line.product.price, config?.currency)} c/u</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(line.lineId)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Quitar ${line.product.name}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1 rounded-xl border border-border p-1">
                    <button
                      type="button"
                      onClick={() => changeQuantity(line.lineId, -1)}
                      className="flex h-11 w-11 items-center justify-center rounded-xl text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Quitar una unidad de ${line.product.name}`}
                    >
                      <Minus size={16} />
                    </button>
                    <span className="w-7 text-center text-sm font-bold">{line.cantidad}</span>
                    <button
                      type="button"
                      onClick={() => changeQuantity(line.lineId, 1)}
                      className="flex h-11 w-11 items-center justify-center rounded-xl text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Agregar una unidad de ${line.product.name}`}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  <span className="text-sm font-bold">{formatMoney(line.product.price * line.cantidad, config?.currency)}</span>
                </div>
                <Input
                  value={line.nota}
                  onChange={(event) => setLineNote(line.lineId, event.target.value)}
                  placeholder="Nota: sin cebolla, salsa aparte…"
                  maxLength={140}
                  className="mt-3 h-11"
                  aria-label={`Nota para ${line.product.name}`}
                />
              </div>
            ))}
          </div>

          <div className="rounded-2xl bg-muted/60 p-4 text-sm">
            <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{formatMoney(subtotal, config?.currency)}</span></div>
            {taxRate > 0 && <div className="mt-1 flex justify-between text-muted-foreground"><span>Impuesto ({Math.round(taxRate * 100)}%)</span><span>{formatMoney(impuesto, config?.currency)}</span></div>}
            <div className="mt-2 flex justify-between border-t border-border pt-2 text-base font-bold text-foreground"><span>Total</span><span>{formatMoney(total, config?.currency)}</span></div>
          </div>

          <Button className="h-12 w-full" onClick={sendOrder} disabled={sending || !cartLines.length || !active}>
            <Send size={18} /> {sending ? 'Enviando…' : 'Enviar a cocina'}
          </Button>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

function EmptyOrders({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-border p-8 text-center">
      <ClipboardList size={28} className="mx-auto text-muted-foreground" />
      <p className="mt-3 font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function ReadyOrderCard({
  order,
  busy,
  onDeliver,
  currency,
  now,
}: {
  order: Pedido;
  busy: boolean;
  onDeliver?: () => void;
  currency?: string;
  now: Date;
}) {
  const readyMinutes = minutesSince(order.finalizadoEn, now);
  return (
    <article className={`rounded-3xl border p-4 shadow-sm ${readyMinutes >= 5 ? 'border-amber-500/40 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold text-foreground">#{order.numero}</span>
            <Badge className="border-transparent bg-emerald-500 text-white">LISTO</Badge>
            <PedidoStatusBadge estado={order.estado} />
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <UtensilsCrossed size={14} className="text-primary" /> {order.mesaNombre}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock3 size={12} /> {order.finalizadoEn ? formatTime(order.finalizadoEn) : formatTime(order.creadoEn)} · {order.finalizadoEn ? (readyMinutes < 1 ? 'Listo ahora' : `Listo hace ${readyMinutes} min`) : 'Listo'}
          </p>
        </div>
        <span className="text-sm font-bold text-foreground">{formatMoney(order.total, currency)}</span>
      </div>

      <ul className="mt-3 space-y-1 border-t border-border/70 pt-3 text-sm">
        {order.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-3">
            <span className="min-w-0 text-foreground"><strong>{item.cantidad}×</strong> {item.nombre}{item.nota ? <span className="text-muted-foreground"> · {item.nota}</span> : null}</span>
            <span className="shrink-0 text-muted-foreground">{formatMoney(item.precioUnitario * item.cantidad, currency)}</span>
          </li>
        ))}
      </ul>

      {onDeliver && <Button className="mt-4 h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700" onClick={onDeliver} disabled={busy}>
        <CheckCircle2 size={18} /> {busy ? 'Registrando venta…' : 'Marcar como entregado'}
      </Button>}
    </article>
  );
}

function OrderHistoryCard({ order, currency, now }: { order: Pedido; currency?: string; now: Date }) {
  const itemCount = order.items.reduce((sum, item) => sum + item.cantidad, 0);
  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-foreground">#{order.numero}</span>
            <PedidoStatusBadge estado={order.estado} />
            {order.listoParaLlevar && order.estado !== 'entregado' && <Badge variant="outline" className="border-emerald-500/30 text-emerald-700 dark:text-emerald-300">Venta directa</Badge>}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1"><UtensilsCrossed size={13} /> {order.mesaNombre}</span>
            <span className="flex items-center gap-1"><Clock3 size={13} /> {formatTime(order.creadoEn)} · {formatElapsedLocal(order.creadoEn, now)}</span>
            <span className="flex items-center gap-1"><Users size={13} /> {order.meseroNombre}</span>
          </p>
          <p className="mt-1 text-sm text-foreground">
            {order.items.slice(0, 3).map((item) => `${item.cantidad}× ${item.nombre}`).join(' · ')}
            {order.items.length > 3 ? ` · +${order.items.length - 3} más` : ''}
          </p>
          {order.estado === 'entregado' && order.entregadoEn && (
            <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">Entregado a las {formatTime(order.entregadoEn)} · Venta registrada</p>
          )}
          {order.estado === 'cancelado' && order.motivoCancelacion && (
            <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">Motivo: {order.motivoCancelacion}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-foreground">{formatMoney(order.total, currency)}</p>
          <p className="text-xs text-muted-foreground">{orderItemSummary(itemCount)}</p>
        </div>
      </div>
    </article>
  );
}

function formatElapsedLocal(value: string, now: Date) {
  const minutes = minutesSince(value, now);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  return `hace ${Math.floor(minutes / 60)} h`;
}
