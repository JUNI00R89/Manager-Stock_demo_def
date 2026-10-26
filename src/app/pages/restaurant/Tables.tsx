import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import {
  CheckCircle2,
  Clock3,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Users,
  UtensilsCrossed,
  XCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { Layout } from '../../components/Layout';
import { RevealGroup, RevealItem } from '../../components/motion/Reveal';
import { AnimatedCounter } from '../../components/motion/AnimatedCounter';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { dataService, type OrderRecord, type RestaurantTableRecord } from '../../services/dataService';

const money = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);

const elapsed = (iso: string) => {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `Hace ${mins} min`;
  return `Hace ${Math.floor(mins / 60)} h ${mins % 60} min`;
};

const STATUS_LABELS: Record<OrderRecord['status'], string> = {
  received: 'Recibido',
  preparing: 'En preparación',
  ready: 'Listo',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};

const nextFreeNumber = (rows: RestaurantTableRecord[]) => {
  const taken = new Set(rows.map((table) => table.number));
  let candidate = 1;
  while (taken.has(candidate)) candidate += 1;
  return candidate;
};

export function Tables() {
  const navigate = useNavigate();
  const [tables, setTables] = useState<RestaurantTableRecord[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<RestaurantTableRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RestaurantTableRecord | null>(null);
  const [number, setNumber] = useState('');
  const [zone, setZone] = useState('');
  const [capacity, setCapacity] = useState('4');
  const [bulkCount, setBulkCount] = useState('8');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tableRows, openOrders] = await Promise.all([dataService.getTables(), dataService.getOpenOrders()]);
      setTables(tableRows);
      setOrders(openOrders);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar el salón.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openOrdersFor = useCallback((tableNumber: number) => orders.filter((order) => order.tableNumber === tableNumber), [orders]);

  const stats = useMemo(() => {
    const occupied = tables.filter((table) => table.status === 'active' && openOrdersFor(table.number).length > 0).length;
    return {
      total: tables.length,
      available: tables.filter((table) => table.status === 'active' && openOrdersFor(table.number).length === 0).length,
      occupied,
      open: orders.length,
    };
  }, [tables, orders, openOrdersFor]);

  const detailOrders = useMemo(
    () => (detail ? orders.filter((order) => order.tableNumber === detail.number) : []),
    [detail, orders]
  );

  const openCreate = () => {
    setEditing(null);
    setNumber(String(nextFreeNumber(tables)));
    setZone('');
    setCapacity('4');
    setConfirmDelete(false);
    setFormOpen(true);
  };

  const openEdit = (table: RestaurantTableRecord) => {
    setEditing(table);
    setNumber(String(table.number));
    setZone(table.zone);
    setCapacity(String(table.capacity));
    setConfirmDelete(false);
    setFormOpen(true);
  };

  const submitForm = async (event: FormEvent) => {
    event.preventDefault();
    const parsedNumber = Number(number);
    const parsedCapacity = Number(capacity) || 4;
    if (!Number.isInteger(parsedNumber) || parsedNumber < 1) {
      toast.error('El número de mesa debe ser un entero mayor a cero.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const updated = await dataService.updateTable(editing.id, { number: parsedNumber, zone: zone.trim(), capacity: parsedCapacity });
        setTables((prev) => prev.map((table) => (table.id === updated.id ? updated : table)).sort((a, b) => a.number - b.number));
        if (detail?.id === updated.id) setDetail(updated);
        toast.success(`Mesa ${updated.number} actualizada.`);
      } else {
        const created = await dataService.createTable({ number: parsedNumber, zone: zone.trim(), capacity: parsedCapacity });
        setTables((prev) => [...prev.filter((table) => table.id !== created.id), created].sort((a, b) => a.number - b.number));
        toast.success(`Mesa ${created.number} creada.`);
      }
      setFormOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la mesa.');
    } finally {
      setSaving(false);
    }
  };

  const bulkCreate = async () => {
    const count = Math.min(50, Math.max(1, Number(bulkCount) || 0));
    setSaving(true);
    try {
      const taken = new Set(tables.map((table) => table.number));
      const created: RestaurantTableRecord[] = [];
      let candidate = 1;
      for (let index = 0; index < count; index += 1) {
        while (taken.has(candidate)) candidate += 1;
        try {
          const table = await dataService.createTable({ number: candidate, zone: zone.trim(), capacity: Number(capacity) || 4 });
          created.push(table);
          taken.add(candidate);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : `No se pudo crear la mesa ${candidate}.`);
          break;
        }
        candidate += 1;
      }
      if (created.length > 0) {
        setTables((prev) => [...prev.filter((table) => !created.some((row) => row.id === table.id)), ...created].sort((a, b) => a.number - b.number));
        toast.success(created.length === 1 ? 'Mesa creada.' : `${created.length} mesas creadas.`);
        setFormOpen(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (table: RestaurantTableRecord) => {
    try {
      const updated = await dataService.updateTable(table.id, { status: table.status === 'active' ? 'inactive' : 'active' });
      setTables((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      toast.success(updated.status === 'active' ? `Mesa ${updated.number} habilitada.` : `Mesa ${updated.number} fuera de servicio.`);
      setFormOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cambiar el estado de la mesa.');
    }
  };

  const removeTable = async (table: RestaurantTableRecord) => {
    try {
      await dataService.deleteTable(table.id);
      setTables((prev) => prev.filter((row) => row.id !== table.id));
      setFormOpen(false);
      if (detail?.id === table.id) setDetail(null);
      toast.success(`Mesa ${table.number} eliminada.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo eliminar la mesa.');
    }
  };

  const resolveOrder = async (order: OrderRecord, status: OrderRecord['status']) => {
    try {
      await dataService.updateOrderStatus(order.id, status);
      setOrders((prev) => prev.filter((row) => row.id !== order.id));
      toast.success(status === 'delivered' ? 'Comanda entregada: la mesa quedó libre.' : 'Comanda cancelada.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la comanda.');
    }
  };

  const takeOrder = (tableNumber: number) => {
    setDetail(null);
    navigate(`/restaurant/waiter?mesa=${tableNumber}`);
  };

  const statCards = [
    { label: 'Total mesas', value: stats.total, icon: UtensilsCrossed, accent: 'text-primary' },
    { label: 'Disponibles', value: stats.available, icon: CheckCircle2, accent: 'text-emerald-400' },
    { label: 'Ocupadas', value: stats.occupied, icon: Users, accent: 'text-amber-400' },
    { label: 'Comandas abiertas', value: stats.open, icon: Clock3, accent: 'text-primary' },
  ];

  return (
    <Layout>
      <div className="space-y-6">
        <RevealGroup>
          <RevealItem className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Operación de salón</p>
              <h1 className="font-display text-4xl font-semibold text-foreground">Gestión de Mesas</h1>
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">Control en tiempo real de tu restaurante</p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Actualizar
              </Button>
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" />
                Nueva mesa
              </Button>
            </div>
          </RevealItem>

          <RevealItem className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {statCards.map((stat) => (
              <Card key={stat.label} className="rounded-2xl p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{stat.label}</p>
                  <stat.icon className={`h-4 w-4 ${stat.accent}`} />
                </div>
                <p className="mt-2 text-2xl font-semibold text-foreground">
                  <AnimatedCounter value={stat.value} />
                </p>
              </Card>
            ))}
          </RevealItem>

          {loading ? (
            <RevealItem>
              <Card className="rounded-2xl p-8 text-center text-sm text-muted-foreground">Cargando mesas…</Card>
            </RevealItem>
          ) : tables.length === 0 ? (
            <RevealItem>
              <Card className="rounded-2xl border-dashed p-10 text-center">
                <UtensilsCrossed className="mx-auto h-8 w-8 text-primary" />
                <p className="mt-3 text-sm text-muted-foreground">Aún no hay mesas. Crea la primera para empezar a tomar pedidos en el salón.</p>
                <Button className="mt-4" onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  Crear mesas
                </Button>
              </Card>
            </RevealItem>
          ) : (
            <RevealItem className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {tables.map((table) => {
                const tableOrders = openOrdersFor(table.number);
                const inactive = table.status !== 'active';
                const occupied = !inactive && tableOrders.length > 0;
                const total = tableOrders.reduce((sum, order) => sum + order.total, 0);
                const items = tableOrders.reduce((sum, order) => sum + order.items.length, 0);
                return (
                  <Card key={table.id} className={`rounded-2xl p-4 ${occupied ? 'border-amber-500/40' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-lg font-semibold text-foreground">Mesa {table.number}</p>
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <Users className="h-3.5 w-3.5" />
                          {table.capacity} puestos{table.zone ? ` · ${table.zone}` : ''}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          inactive ? 'bg-muted text-muted-foreground' : occupied ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'
                        }`}
                      >
                        {inactive ? 'Fuera de servicio' : occupied ? 'Ocupada' : 'Disponible'}
                      </span>
                    </div>

                    {occupied && (
                      <div className="mt-3 space-y-1 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
                        <p className="font-semibold text-foreground">
                          {items} {items === 1 ? 'producto' : 'productos'} · {money(total)}
                        </p>
                        {tableOrders[0]?.waiter && <p>Mesero: {tableOrders[0].waiter}</p>}
                        {tableOrders[0] && <p>{elapsed(tableOrders[0].created_at)}</p>}
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setDetail(table)} disabled={inactive}>
                        Ver comanda
                      </Button>
                      <Button size="sm" onClick={() => takeOrder(table.number)} disabled={inactive}>
                        <Send className="h-3.5 w-3.5" />
                        Tomar pedido
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(table)} aria-label={`Editar mesa ${table.number}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </RevealItem>
          )}
        </RevealGroup>
      </div>

      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              Mesa {detail?.number}
              {detail?.zone ? ` · ${detail.zone}` : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {detailOrders.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">Esta mesa no tiene comandas abiertas.</p>
            ) : (
              detailOrders.map((order) => (
                <Card key={order.id} className="rounded-xl p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full bg-muted px-2 py-1 font-semibold text-foreground">{STATUS_LABELS[order.status]}</span>
                    {order.waiter && <span>Mesero: {order.waiter}</span>}
                    <span>{elapsed(order.created_at)}</span>
                  </div>
                  <ul className="mt-2 space-y-1 text-sm">
                    {order.items.map((item, index) => (
                      <li key={`${order.id}-${item.productId}-${index}`} className="flex justify-between gap-3">
                        <span className="text-foreground">
                          {item.quantity} × {item.productName}
                        </span>
                        <span className="text-muted-foreground">{money(item.unitPrice * item.quantity)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 border-t border-border/60 pt-2 text-right text-sm font-semibold text-foreground">Total {money(order.total)}</p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" className="flex-1" onClick={() => void resolveOrder(order, 'delivered')}>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Entregado
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => void resolveOrder(order, 'cancelled')}>
                      <XCircle className="h-3.5 w-3.5" />
                      Cancelar
                    </Button>
                  </div>
                </Card>
              ))
            )}
            {detail && (
              <Button className="w-full" onClick={() => takeOrder(detail.number)}>
                <Send className="h-4 w-4" />
                Tomar pedido en esta mesa
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Editar mesa ${editing.number}` : 'Nueva mesa'}</DialogTitle>
          </DialogHeader>

          <form onSubmit={submitForm} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="table-number">Número de mesa</Label>
              <Input id="table-number" type="number" min={1} value={number} onChange={(event) => setNumber(event.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="table-zone">
                Zona <span className="text-muted-foreground">(opcional)</span>
              </Label>
              <Input id="table-zone" value={zone} onChange={(event) => setZone(event.target.value)} placeholder="Salón, terraza, barra…" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="table-capacity">Capacidad</Label>
              <Input id="table-capacity" type="number" min={1} max={50} value={capacity} onChange={(event) => setCapacity(event.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear mesa'}
            </Button>
          </form>

          {!editing && (
            <div className="rounded-xl border border-border/60 p-3">
              <p className="text-xs font-semibold text-muted-foreground">Creación rápida de varias mesas</p>
              <div className="mt-2 flex items-center gap-2">
                <Input type="number" min={1} max={50} value={bulkCount} onChange={(event) => setBulkCount(event.target.value)} className="h-9" aria-label="Cantidad de mesas" />
                <Button variant="outline" onClick={() => void bulkCreate()} disabled={saving}>
                  Crear mesas
                </Button>
              </div>
            </div>
          )}

          {editing && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="flex-1" onClick={() => void toggleStatus(editing)}>
                {editing.status === 'active' ? 'Poner fuera de servicio' : 'Habilitar mesa'}
              </Button>
              <Button variant="destructive" className="flex-1" onClick={() => (confirmDelete ? void removeTable(editing) : setConfirmDelete(true))}>
                <Trash2 className="h-4 w-4" />
                {confirmDelete ? 'Confirmar eliminación' : 'Eliminar'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
