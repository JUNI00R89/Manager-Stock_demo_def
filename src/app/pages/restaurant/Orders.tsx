import { canPerformAction } from '../../security/permissions';
import { useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  MapPin,
  Minus,
  Plus,
  Receipt,
  Search,
  ShoppingCart,
  UtensilsCrossed,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../utils/notifications';
import { Layout } from '../../components/Layout';
import { StaffSwitcher } from '../../components/restaurant/StaffSwitcher';
import { PedidoStatusBadge } from '../../components/restaurant/PedidoStatusBadge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Label } from '../../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { useAuth } from '../../context/AuthContext';
import { useBusiness } from '../../context/BusinessContext';
import { useRestaurantScope, useRestaurantBusinessId } from '../../utils/restaurantScope';
import { useRestaurantStaff } from '../../utils/restaurantStaffStore';
import { useRestaurantSettings } from '../../utils/restaurantSettingsStore';
import { useRestaurantCatalog } from '../../utils/restaurantCatalogStore';
import { useNow, useRestaurantOrders, useRestaurantTables } from '../../utils/restaurantOrdersHook';
import {
  formatElapsed,
  formatJornadaTitle,
  formatMoney,
  formatTime,
  getJornadaKey,
  minutesSince,
  orderItemSummary,
  normalizeText,
} from '../../utils/restaurantFormat';
import { deliverRestaurantOrder } from '../../utils/restaurantOrdersService';
import { PedidoConflictoError, type Pedido } from '../../utils/restaurantTypes';

type OrdersTab = 'activos' | 'entregados';

interface NewOrderLine {
  productId: string;
  cantidad: number;
}

function tableName(table: { id: string; number: number }, names: Record<string, string>) {
  return names[table.id] || `Mesa ${table.number}`;
}

export function Orders() {
  const { user } = useAuth();
  const canCollect = canPerformAction(user, 'sales.create');
  const { config } = useBusiness();
  const scope = useRestaurantScope();
  const businessId = useRestaurantBusinessId();
  const ordersScope = import.meta.env.VITE_RESTAURANT_BACKEND === 'firebase' ? businessId : scope;
  const { settings } = useRestaurantSettings(scope);
  const { activeStaff, toEmployee } = useRestaurantStaff(scope, user?.name || '');
  const active = activeStaff('admin');
  const { orders, loading, error: ordersError, repository } = useRestaurantOrders(ordersScope);
  const { tables } = useRestaurantTables();
  const { activeMenu, setActive, setDirectSale, loading: menuLoading } = useRestaurantCatalog(scope);
  const now = useNow(30_000);

  const [tab, setTab] = useState<OrdersTab>('activos');
  const [search, setSearch] = useState('');
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Pedido | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [newTableId, setNewTableId] = useState('');
  const [newSearch, setNewSearch] = useState('');
  const [newCart, setNewCart] = useState<NewOrderLine[]>([]);
  const [creating, setCreating] = useState(false);

  const jornada = getJornadaKey(now, settings.startTime);
  const jornadaOrders = useMemo(() => orders.filter(order => order.jornada === jornada), [orders, jornada]);
  const activeOrders = useMemo(
    () => jornadaOrders.filter(order => !['entregado', 'cancelado'].includes(order.estado)),
    [jornadaOrders],
  );
  const historyOrders = useMemo(
    () => jornadaOrders.filter(order => ['entregado', 'cancelado'].includes(order.estado)),
    [jornadaOrders],
  );
  const activeTables = useMemo(() => tables.filter(table => table.status === 'active'), [tables]);
  const selectedTable = activeTables.find(table => table.id === newTableId) ?? null;

  const searchTerm = normalizeText(search.trim());
  const matchesSearch = (order: Pedido) => {
    if (!searchTerm) return true;
    return normalizeText(
      [
        `#${order.numero}`,
        order.mesaNombre,
        order.meseroNombre,
        order.estado,
        ...order.items.map(item => item.nombre),
      ].join(' '),
    ).includes(searchTerm);
  };

  const pending = useMemo(
    () =>
      activeOrders
        .filter(order => order.estado === 'pendiente' && matchesSearch(order))
        .sort((a, b) => a.creadoEn.localeCompare(b.creadoEn)),
    [activeOrders, searchTerm],
  );
  const preparing = useMemo(
    () =>
      activeOrders
        .filter(order => order.estado === 'en_preparacion' && matchesSearch(order))
        .sort((a, b) => (a.tomadoEn || '').localeCompare(b.tomadoEn || '')),
    [activeOrders, searchTerm],
  );
  const ready = useMemo(
    () =>
      activeOrders
        .filter(order => order.estado === 'finalizado' && matchesSearch(order))
        .sort((a, b) => (a.finalizadoEn || '').localeCompare(b.finalizadoEn || '')),
    [activeOrders, searchTerm],
  );
  const visibleHistory = useMemo(
    () =>
      historyOrders
        .filter(matchesSearch)
        .sort((a, b) =>
          (b.entregadoEn || b.canceladoEn || b.creadoEn).localeCompare(a.entregadoEn || a.canceladoEn || a.creadoEn),
        ),
    [historyOrders, searchTerm],
  );

  const newCartDetailed = useMemo(
    () =>
      newCart
        .map(line => {
          const product = activeMenu.find(item => item.id === line.productId);
          return product ? { ...line, product } : null;
        })
        .filter(Boolean) as Array<NewOrderLine & { product: (typeof activeMenu)[number] }>,
    [newCart, activeMenu],
  );
  const newSubtotal = newCartDetailed.reduce((sum, line) => sum + line.product.price * line.cantidad, 0);
  const newTaxRate = Math.max(0, Number(config?.taxRate) || 0);
  const newTax = Math.round(newSubtotal * newTaxRate);
  const newTotal = newSubtotal + newTax;
  const newSearchTerm = normalizeText(newSearch.trim());
  const newFilteredMenu = activeMenu.filter(product => {
    if (!newSearchTerm) return true;
    return normalizeText(`${product.name} ${product.category} ${product.description}`).includes(newSearchTerm);
  });

  const resetNewOrder = () => {
    setNewOrderOpen(false);
    setNewTableId('');
    setNewSearch('');
    setNewCart([]);
  };

  const addToNewOrder = (productId: string) => {
    setNewCart(current => {
      const exists = current.find(line => line.productId === productId);
      if (exists)
        return current.map(line => (line.productId === productId ? { ...line, cantidad: line.cantidad + 1 } : line));
      return [...current, { productId, cantidad: 1 }];
    });
  };

  const changeNewQuantity = (productId: string, delta: number) => {
    setNewCart(current =>
      current
        .map(line => (line.productId === productId ? { ...line, cantidad: Math.max(0, line.cantidad + delta) } : line))
        .filter(line => line.cantidad > 0),
    );
  };

  const createOrder = async () => {
    if (!active) {
      toast.error('Selecciona el usuario administrador antes de crear un pedido.');
      return;
    }
    if (!selectedTable) {
      toast.error('Selecciona una mesa.');
      return;
    }
    if (!newCartDetailed.length) {
      toast.error('Agrega al menos un producto.');
      return;
    }
    setCreating(true);
    try {
      const created = await repository.crearPedido({
        negocioId: scope,
        mesaId: selectedTable.id,
        mesaNumero: selectedTable.number,
        mesaNombre: tableName(selectedTable, settings.tableNames),
        mesero: toEmployee(active),
        items: newCartDetailed.map(line => ({
          productId: line.product.id,
          nombre: line.product.name,
          precioUnitario: line.product.price,
          cantidad: line.cantidad,
          ventaDirecta: line.product.directSale,
        })),
        horaInicioJornada: settings.startTime,
        taxRate: newTaxRate,
      });
      toast.success(
        created.estado === 'finalizado'
          ? `Pedido #${created.numero} listo para llevar.`
          : `Pedido #${created.numero} enviado a cocina.`,
      );
      resetNewOrder();
    } catch (reason) {
      toastError(reason, 'No se pudo crear el pedido.');
    } finally {
      setCreating(false);
    }
  };

  const takeOrder = async (order: Pedido) => {
    if (!active) return toast.error('Selecciona un usuario administrador.');
    setBusyOrderId(order.id);
    try {
      await repository.tomarPedido(order.id, scope, toEmployee(active));
      toast.success(`Pedido #${order.numero}: Tomado por ${active.name}`);
    } catch (reason) {
      toastError(reason, 'No se pudo tomar el pedido.');
    } finally {
      setBusyOrderId(null);
    }
  };

  const finishOrder = async (order: Pedido) => {
    if (!active) return toast.error('Selecciona un usuario administrador.');
    setBusyOrderId(order.id);
    try {
      await repository.finalizarPedido(order.id, scope, toEmployee(active));
      toast.success(`Pedido #${order.numero} finalizado.`);
    } catch (reason) {
      toastError(reason, 'No se pudo finalizar el pedido.');
    } finally {
      setBusyOrderId(null);
    }
  };

  const deliverOrder = async (order: Pedido) => {
    if (!active) return toast.error('Selecciona un usuario administrador.');
    setBusyOrderId(order.id);
    try {
      const result = await deliverRestaurantOrder(repository, order, toEmployee(active));
      toast.success(
        `Pedido #${order.numero} entregado. Venta ${result.sale?.id ? result.sale.id : 'registrada'} y stock actualizado.`,
      );
    } catch (reason) {
      toastError(reason, 'No se pudo entregar el pedido.');
    } finally {
      setBusyOrderId(null);
    }
  };

  const confirmCancel = async () => {
    if (!cancelTarget || !active) return;
    setBusyOrderId(cancelTarget.id);
    try {
      await repository.cancelarPedido(cancelTarget.id, scope, toEmployee(active), cancelReason);
      toast.success(`Pedido #${cancelTarget.numero} cancelado.`);
      setCancelTarget(null);
      setCancelReason('');
    } catch (reason) {
      toastError(reason, 'No se pudo cancelar el pedido.');
    } finally {
      setBusyOrderId(null);
    }
  };

  return (
    <Layout>
      {ordersError && (
        <p role="alert" className="mb-3 rounded border border-red-200 p-3 text-red-600">
          {ordersError}
        </p>
      )}
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Administración · {formatJornadaTitle(jornada, settings.startTime)}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Pedidos</h1>
            <Badge className="border-transparent bg-primary/10 text-primary">
              {activeOrders.length} abierto{activeOrders.length === 1 ? '' : 's'}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Tablero del local sincronizado con mesero y cocina.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StaffSwitcher scope={scope} role="admin" currentUserName={user?.name || ''} />
          <Button className="h-11" onClick={() => setNewOrderOpen(true)} disabled={activeTables.length === 0}>
            <Plus size={18} /> Nuevo pedido
          </Button>
        </div>
      </header>

      {!active && (
        <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          No hay un usuario de administración activo. Selecciónalo en Ajustes &gt; Usuarios.
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full items-center gap-1 rounded-xl bg-muted p-1 sm:w-auto">
          <button
            type="button"
            onClick={() => setTab('activos')}
            className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === 'activos' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <ClipboardList size={17} /> Activos{' '}
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
              {activeOrders.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setTab('entregados')}
            className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === 'entregados' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <CheckCircle2 size={17} /> Entregados{' '}
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {historyOrders.length}
            </span>
          </button>
        </div>
        <div className="relative w-full sm:max-w-md">
          <Search
            size={17}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Buscar por número, mesa, mesero o producto"
            className="h-11 pl-9"
            aria-label="Buscar pedidos"
          />
        </div>
      </div>

      {loading ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {[1, 2, 3].map(item => (
            <div key={item} className="h-72 animate-pulse rounded-3xl border border-border bg-muted/50" />
          ))}
        </div>
      ) : tab === 'activos' ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <BoardColumn title="Entrantes" count={pending.length} tone="amber" subtitle="Esperando toma">
            {pending.length === 0 ? (
              <BoardEmpty text="Sin pedidos pendientes." />
            ) : (
              pending.map(order => (
                <AdminOrderCard
                  key={order.id}
                  order={order}
                  currency={config?.currency}
                  now={now}
                  busy={busyOrderId === order.id}
                  primaryLabel="Tomar"
                  onPrimary={() => takeOrder(order)}
                  onCancel={() => {
                    setCancelTarget(order);
                    setCancelReason('');
                  }}
                />
              ))
            )}
          </BoardColumn>
          <BoardColumn title="En preparación" count={preparing.length} tone="sky" subtitle="En cocina">
            {preparing.length === 0 ? (
              <BoardEmpty text="Sin pedidos en preparación." />
            ) : (
              preparing.map(order => (
                <AdminOrderCard
                  key={order.id}
                  order={order}
                  currency={config?.currency}
                  now={now}
                  busy={busyOrderId === order.id}
                  primaryLabel="Finalizar"
                  onPrimary={() => finishOrder(order)}
                  onCancel={() => {
                    setCancelTarget(order);
                    setCancelReason('');
                  }}
                />
              ))
            )}
          </BoardColumn>
          <BoardColumn title="Listos" count={ready.length} tone="emerald" subtitle="Para entregar">
            {ready.length === 0 ? (
              <BoardEmpty text="Sin pedidos listos." />
            ) : (
              ready.map(order => (
                <AdminOrderCard
                  key={order.id}
                  order={order}
                  currency={config?.currency}
                  now={now}
                  busy={busyOrderId === order.id}
                  primaryLabel="Entregar"
                  onPrimary={canCollect ? () => deliverOrder(order) : undefined}
                  onCancel={() => {
                    setCancelTarget(order);
                    setCancelReason('');
                  }}
                />
              ))
            )}
          </BoardColumn>
        </div>
      ) : (
        <div className="mt-5">
          {visibleHistory.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border p-10 text-center">
              <Receipt size={30} className="mx-auto text-muted-foreground" />
              <p className="mt-3 font-semibold text-foreground">Aún no hay pedidos cerrados</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Los pedidos entregados o cancelados aparecerán en esta pestaña.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {visibleHistory.map(order => (
                <HistoryCard key={order.id} order={order} currency={config?.currency} />
              ))}
            </div>
          )}
        </div>
      )}

      <Dialog
        open={!!cancelTarget}
        onOpenChange={open => {
          if (!open) {
            setCancelTarget(null);
            setCancelReason('');
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar pedido #{cancelTarget?.numero}</DialogTitle>
            <DialogDescription>
              El pedido no descontará stock ni registrará venta. Escribe el motivo para dejar el registro.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Motivo de la cancelación</Label>
            <Input
              id="cancel-reason"
              value={cancelReason}
              onChange={event => setCancelReason(event.target.value)}
              placeholder="Ej. el cliente se retiró"
              maxLength={180}
              className="h-11"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="h-11"
              onClick={() => {
                setCancelTarget(null);
                setCancelReason('');
              }}
            >
              Volver
            </Button>
            <Button
              variant="destructive"
              className="h-11"
              onClick={confirmCancel}
              disabled={!cancelReason.trim() || !!busyOrderId}
            >
              <Ban size={17} /> Cancelar pedido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={newOrderOpen}
        onOpenChange={open => {
          if (!open) resetNewOrder();
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto max-sm:bottom-0 max-sm:top-auto max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-3xl sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart size={20} className="text-primary" /> Nuevo pedido
            </DialogTitle>
            <DialogDescription>
              Elige la mesa, agrega productos y envía el pedido a cocina o a venta directa.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-w-0">
              <Label htmlFor="new-order-table">Mesa</Label>
              <Select value={newTableId} onValueChange={setNewTableId}>
                <SelectTrigger id="new-order-table" className="mt-1 h-11">
                  <SelectValue placeholder={activeTables.length ? 'Selecciona una mesa' : 'No hay mesas habilitadas'} />
                </SelectTrigger>
                <SelectContent>
                  {activeTables.map(table => (
                    <SelectItem key={table.id} value={table.id}>
                      {tableName(table, settings.tableNames)} · {table.zone || 'Salón'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="relative mt-4">
                <Search
                  size={17}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={newSearch}
                  onChange={event => setNewSearch(event.target.value)}
                  placeholder="Buscar producto"
                  className="h-11 pl-9"
                  aria-label="Buscar producto para el pedido"
                />
              </div>

              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                {menuLoading ? (
                  <div className="h-24 animate-pulse rounded-2xl bg-muted" />
                ) : newFilteredMenu.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    No hay productos que coincidan.
                  </p>
                ) : (
                  newFilteredMenu.map(product => {
                    const inCart = newCart.find(line => line.productId === product.id);
                    return (
                      <div
                        key={product.id}
                        className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">{product.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {product.category || 'Otros'} · {formatMoney(product.price, config?.currency)}
                            {product.directSale ? ' · Venta directa' : ''}
                          </p>
                        </div>
                        {inCart && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                            x{inCart.cantidad}
                          </span>
                        )}
                        <Button
                          size="icon"
                          className="h-11 w-11 shrink-0 rounded-xl"
                          onClick={() => addToNewOrder(product.id)}
                          aria-label={`Agregar ${product.name}`}
                        >
                          <Plus size={18} />
                        </Button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <aside className="rounded-2xl border border-border bg-muted/30 p-3">
              <p className="flex items-center gap-2 text-sm font-bold text-foreground">
                <Receipt size={16} /> Resumen
              </p>
              <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
                {newCartDetailed.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    Agrega productos del menú.
                  </p>
                ) : (
                  newCartDetailed.map(line => (
                    <div key={line.product.id} className="rounded-xl bg-card p-2.5">
                      <p className="truncate text-xs font-semibold text-foreground">{line.product.name}</p>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => changeNewQuantity(line.product.id, -1)}
                            className="flex h-11 w-11 items-center justify-center rounded-xl border border-border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={`Quitar ${line.product.name}`}
                          >
                            <Minus size={16} />
                          </button>
                          <span className="w-6 text-center text-xs font-bold">{line.cantidad}</span>
                          <button
                            type="button"
                            onClick={() => changeNewQuantity(line.product.id, 1)}
                            className="flex h-11 w-11 items-center justify-center rounded-xl border border-border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={`Agregar ${line.product.name}`}
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                        <span className="text-xs font-bold">
                          {formatMoney(line.product.price * line.cantidad, config?.currency)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{formatMoney(newSubtotal, config?.currency)}</span>
                </div>
                {newTaxRate > 0 && (
                  <div className="mt-1 flex justify-between">
                    <span>Impuesto</span>
                    <span>{formatMoney(newTax, config?.currency)}</span>
                  </div>
                )}
                <div className="mt-1 flex justify-between text-sm font-bold text-foreground">
                  <span>Total</span>
                  <span>{formatMoney(newTotal, config?.currency)}</span>
                </div>
              </div>
              <Button
                className="mt-3 h-11 w-full"
                onClick={createOrder}
                disabled={creating || !selectedTable || !newCartDetailed.length || !active}
              >
                <ChevronRight size={17} /> {creating ? 'Creando…' : 'Crear pedido'}
              </Button>
            </aside>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

function BoardColumn({
  title,
  subtitle,
  count,
  tone,
  children,
}: {
  title: string;
  subtitle: string;
  count: number;
  tone: 'amber' | 'sky' | 'emerald';
  children: React.ReactNode;
}) {
  const toneClass = {
    amber: 'border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-300',
    sky: 'border-sky-500/25 bg-sky-500/5 text-sky-700 dark:text-sky-300',
    emerald: 'border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
  }[tone];
  return (
    <section className="rounded-3xl border border-border bg-card/60 p-3 shadow-sm">
      <div className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 ${toneClass}`}>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold leading-tight">{title}</h2>
          <p className="truncate text-xs opacity-80">{subtitle}</p>
        </div>
        <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-background/80 px-2 text-sm font-bold">
          {count}
        </span>
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function BoardEmpty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-6 text-center">
      <Clock3 size={24} className="mx-auto text-muted-foreground" />
      <p className="mt-2 text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

function AdminOrderCard({
  order,
  currency,
  now,
  busy,
  primaryLabel,
  onPrimary,
  onCancel,
}: {
  order: Pedido;
  currency?: string;
  now: Date;
  busy: boolean;
  primaryLabel: string;
  onPrimary?: () => void;
  onCancel: () => void;
}) {
  const itemCount = order.items.reduce((sum, item) => sum + item.cantidad, 0);
  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold text-foreground">#{order.numero}</span>
            <PedidoStatusBadge estado={order.estado} />
            {order.listoParaLlevar && (
              <Badge variant="outline" className="border-emerald-500/30 text-emerald-700 dark:text-emerald-300">
                Venta directa
              </Badge>
            )}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <MapPin size={12} /> {order.mesaNombre}
            </span>
            <span className="flex items-center gap-1">
              <Clock3 size={12} /> {formatTime(order.creadoEn)} · {formatElapsed(order.creadoEn, now)}
            </span>
          </p>
        </div>
        <span className="text-sm font-bold text-foreground">{formatMoney(order.total, currency)}</span>
      </div>

      <p className="mt-2 text-sm text-foreground">
        {order.items
          .slice(0, 3)
          .map(item => `${item.cantidad}× ${item.nombre}`)
          .join(' · ')}
        {order.items.length > 3 ? ` · +${order.items.length - 3} más` : ''}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {order.meseroNombre} · {orderItemSummary(itemCount)}
      </p>
      {order.estado === 'en_preparacion' && order.tomadoPorNombre && (
        <p className="mt-1 text-xs font-medium text-sky-700 dark:text-sky-300">Tomado por {order.tomadoPorNombre}</p>
      )}

      <div className="mt-3 flex gap-2">
        {onPrimary && (
          <Button
            className={`h-11 flex-1 ${primaryLabel === 'Entregar' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : ''}`}
            onClick={onPrimary}
            disabled={busy}
          >
            {primaryLabel === 'Tomar' ? (
              <PlayIcon />
            ) : primaryLabel === 'Finalizar' ? (
              <CheckCircle2 size={17} />
            ) : (
              <CheckCircle2 size={17} />
            )}
            {busy ? 'Procesando…' : primaryLabel}
          </Button>
        )}
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          aria-label={`Cancelar pedido #${order.numero}`}
        >
          <XCircle size={18} />
        </button>
      </div>
    </article>
  );
}

function PlayIcon() {
  return (
    <span className="flex h-4 w-4 items-center justify-center">
      <UtensilsCrossed size={16} />
    </span>
  );
}

function HistoryCard({ order, currency }: { order: Pedido; currency?: string }) {
  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-foreground">#{order.numero}</span>
            <PedidoStatusBadge estado={order.estado} />
          </div>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <MapPin size={12} /> {order.mesaNombre}
            </span>
            <span className="flex items-center gap-1">
              <Clock3 size={12} /> {formatTime(order.creadoEn)}
            </span>
            <span>{order.meseroNombre}</span>
          </p>
          <p className="mt-1 text-sm text-foreground">
            {order.items.map(item => `${item.cantidad}× ${item.nombre}`).join(' · ')}
          </p>
          {order.estado === 'entregado' && order.entregadoEn && (
            <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
              Entregado a las {formatTime(order.entregadoEn)} por {order.entregadoPorNombre || 'administración'} · Venta
              registrada
            </p>
          )}
          {order.estado === 'cancelado' && (
            <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">
              Cancelado por {order.canceladoPorNombre || 'administración'}
              {order.motivoCancelacion ? ` · ${order.motivoCancelacion}` : ''}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-foreground">{formatMoney(order.total, currency)}</p>
          <p className="text-xs text-muted-foreground">
            {orderItemSummary(order.items.reduce((sum, item) => sum + item.cantidad, 0))}
          </p>
        </div>
      </div>
    </article>
  );
}
