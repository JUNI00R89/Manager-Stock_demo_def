import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  CheckCircle2,
  ChefHat,
  Clock3,
  Flame,
  MapPin,
  Play,
  Timer,
  UtensilsCrossed,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Layout } from '../../components/Layout';
import { StaffSwitcher } from '../../components/restaurant/StaffSwitcher';
import { PedidoStatusBadge } from '../../components/restaurant/PedidoStatusBadge';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Switch } from '../../components/ui/switch';
import { useAuth } from '../../context/AuthContext';
import { useBusiness } from '../../context/BusinessContext';
import { useRestaurantScope } from '../../utils/restaurantScope';
import { useRestaurantStaff } from '../../utils/restaurantStaffStore';
import { useRestaurantSettings } from '../../utils/restaurantSettingsStore';
import { useNow, useRestaurantOrders } from '../../utils/restaurantOrdersHook';
import { formatDayMonth, formatMoney, formatTime, minutesSince } from '../../utils/restaurantFormat';
import { getJornadaKey } from '../../utils/restaurantFormat';
import { isKitchenOrder, kitchenItems } from '../../utils/restaurantPedidosRepository';
import { PedidoConflictoError, type Pedido } from '../../utils/restaurantTypes';
import { playNewOrderChime, primeRestaurantAudio } from '../../utils/restaurantAudio';

type KitchenTab = 'en_curso' | 'finalizados';

export function Kitchen() {
  const { user } = useAuth();
  const { config } = useBusiness();
  const scope = useRestaurantScope();
  const { settings } = useRestaurantSettings(scope);
  const { activeStaff, toEmployee } = useRestaurantStaff(scope, user?.name || '');
  const active = activeStaff('cocina');
  const { orders, loading, repository } = useRestaurantOrders(scope);
  const now = useNow(15_000);
  const [tab, setTab] = useState<KitchenTab>('en_curso');
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const soundKey = `manager_stock_restaurant_cocina_sonido_${scope}`;
  const [soundOn, setSoundOn] = useState(() => {
    try {
      return localStorage.getItem(soundKey) !== 'off';
    } catch {
      return true;
    }
  });

  const jornada = getJornadaKey(now, settings.startTime);
  const kitchenOrders = useMemo(
    () => orders.filter((order) => order.jornada === jornada && isKitchenOrder(order)),
    [orders, jornada],
  );
  const pending = useMemo(
    () => kitchenOrders.filter((order) => order.estado === 'pendiente').sort((a, b) => a.creadoEn.localeCompare(b.creadoEn)),
    [kitchenOrders],
  );
  const preparing = useMemo(
    () => kitchenOrders.filter((order) => order.estado === 'en_preparacion').sort((a, b) => (a.tomadoEn || '').localeCompare(b.tomadoEn || '')),
    [kitchenOrders],
  );
  const finalized = useMemo(
    () => kitchenOrders.filter((order) => order.estado === 'finalizado').sort((a, b) => (b.finalizadoEn || '').localeCompare(a.finalizadoEn || '')),
    [kitchenOrders],
  );
  const inProgressCount = pending.length + preparing.length;

  const seenPendingRef = useRef<{ key: string; ids: Set<string> } | null>(null);
  const realtimeKey = `${scope}:${jornada}`;

  useEffect(() => {
    try {
      localStorage.setItem(soundKey, soundOn ? 'on' : 'off');
    } catch {
      // La preferencia sigue en esta sesión.
    }
  }, [soundKey, soundOn]);

  useEffect(() => {
    const handler = () => primeRestaurantAudio();
    window.addEventListener('pointerdown', handler, { once: true });
    return () => window.removeEventListener('pointerdown', handler);
  }, []);

  useEffect(() => {
    if (loading) return;
    const ids = new Set(pending.map((order) => order.id));
    const previous = seenPendingRef.current;
    if (!previous || previous.key !== realtimeKey) {
      seenPendingRef.current = { key: realtimeKey, ids };
      return;
    }
    const nuevos = [...ids].filter((id) => !previous.ids.has(id));
    seenPendingRef.current = { key: realtimeKey, ids };
    if (nuevos.length > 0 && soundOn) playNewOrderChime();
  }, [pending, soundOn, realtimeKey, loading]);

  const takeOrder = async (order: Pedido) => {
    if (!active) {
      toast.error('Selecciona el usuario de cocina antes de tomar un pedido.');
      return;
    }
    primeRestaurantAudio();
    setBusyOrderId(order.id);
    try {
      await repository.tomarPedido(order.id, scope, toEmployee(active));
      toast.success(`Pedido #${order.numero}: Tomado por ${active.name}`);
    } catch (reason) {
      if (reason instanceof PedidoConflictoError) toast.error(reason.message);
      else toast.error(reason instanceof Error ? reason.message : 'No se pudo tomar el pedido.');
    } finally {
      setBusyOrderId(null);
    }
  };

  const finishOrder = async (order: Pedido) => {
    if (!active) {
      toast.error('Selecciona el usuario de cocina antes de finalizar un pedido.');
      return;
    }
    setBusyOrderId(order.id);
    try {
      await repository.finalizarPedido(order.id, scope, toEmployee(active));
      toast.success(`Pedido #${order.numero} finalizado por ${active.name}.`);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'No se pudo finalizar el pedido.');
    } finally {
      setBusyOrderId(null);
    }
  };

  return (
    <Layout>
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Cocina · {formatDayMonth(now)} · {formatTime(now)}</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Pedidos en curso</h1>
            <Badge className="border-transparent bg-primary/10 text-primary">{inProgressCount} activo{inProgressCount === 1 ? '' : 's'}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Entrantes y preparación en tiempo real. La alerta visual aparece a los {settings.expectedMinutes} min.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-3 text-sm font-semibold text-foreground shadow-sm">
            <Switch
              checked={soundOn}
              onCheckedChange={(checked) => {
                setSoundOn(checked);
                if (checked) {
                  primeRestaurantAudio();
                  playNewOrderChime();
                }
              }}
              aria-label="Activar sonido de nuevos pedidos"
            />
            {soundOn ? <Bell size={16} className="text-primary" /> : <BellOff size={16} className="text-muted-foreground" />}
            Sonido
          </label>
          <StaffSwitcher scope={scope} role="cocina" currentUserName={user?.name || ''} />
        </div>
      </header>

      {!active && (
        <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          No hay un usuario de cocina activo. Asígnalo en Ajustes &gt; Usuarios.
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-1.5 shadow-sm">
        <button
          type="button"
          onClick={() => setTab('en_curso')}
          className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === 'en_curso' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
        >
          <Flame size={18} /> En curso
          <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${tab === 'en_curso' ? 'bg-white/20' : 'bg-muted'}`}>{inProgressCount}</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('finalizados')}
          className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === 'finalizados' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
        >
          <CheckCircle2 size={18} /> Finalizados
          <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${tab === 'finalizados' ? 'bg-white/20' : 'bg-muted'}`}>{finalized.length}</span>
        </button>
      </div>

      {loading ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {[1, 2].map((item) => <div key={item} className="h-64 animate-pulse rounded-3xl border border-border bg-muted/50" />)}
        </div>
      ) : tab === 'en_curso' ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <KitchenColumn
            title="Entrantes"
            subtitle="Pedidos esperando que alguien los tome"
            count={pending.length}
            tone="amber"
            icon={<Clock3 size={20} />}
          >
            {pending.length === 0 ? (
              <KitchenEmpty title="Sin pedidos entrantes" text="Cuando el mesero envíe un pedido, aparecerá aquí al instante." />
            ) : pending.map((order) => (
              <KitchenOrderCard
                key={order.id}
                order={order}
                mode="pending"
                busy={busyOrderId === order.id}
                delayed={minutesSince(order.creadoEn, now) >= settings.expectedMinutes}
                expectedMinutes={settings.expectedMinutes}
                currency={config?.currency}
                now={now}
                onTake={() => takeOrder(order)}
              />
            ))}
          </KitchenColumn>

          <KitchenColumn
            title="En preparación"
            subtitle="Pedidos tomados por cocina"
            count={preparing.length}
            tone="sky"
            icon={<ChefHat size={20} />}
          >
            {preparing.length === 0 ? (
              <KitchenEmpty title="Nada en preparación" text="Toma un pedido de Entrantes para empezar a cocinarlo." />
            ) : preparing.map((order) => (
              <KitchenOrderCard
                key={order.id}
                order={order}
                mode="preparing"
                busy={busyOrderId === order.id}
                delayed={minutesSince(order.creadoEn, now) >= settings.expectedMinutes}
                expectedMinutes={settings.expectedMinutes}
                currency={config?.currency}
                now={now}
                onFinish={() => finishOrder(order)}
              />
            ))}
          </KitchenColumn>
        </div>
      ) : (
        <div className="mt-5">
          {finalized.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border p-10 text-center">
              <CheckCircle2 size={30} className="mx-auto text-muted-foreground" />
              <p className="mt-3 font-semibold text-foreground">Todavía no hay pedidos finalizados</p>
              <p className="mt-1 text-sm text-muted-foreground">Los pedidos que termines aparecerán aquí hasta que se entreguen.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {finalized.map((order) => (
                <KitchenOrderCard
                  key={order.id}
                  order={order}
                  mode="finalized"
                  busy={false}
                  delayed={false}
                  expectedMinutes={settings.expectedMinutes}
                  currency={config?.currency}
                  now={now}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </Layout>
  );
}

function KitchenColumn({
  title,
  subtitle,
  count,
  tone,
  icon,
  children,
}: {
  title: string;
  subtitle: string;
  count: number;
  tone: 'amber' | 'sky';
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const toneClass = tone === 'amber'
    ? 'border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-300'
    : 'border-sky-500/25 bg-sky-500/5 text-sky-700 dark:text-sky-300';
  return (
    <section className="rounded-3xl border border-border bg-card/60 p-3 shadow-sm sm:p-4">
      <div className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 ${toneClass}`}>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-background/70">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold leading-tight">{title}</h2>
          <p className="truncate text-xs opacity-80">{subtitle}</p>
        </div>
        <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-background/80 px-2 text-sm font-bold">{count}</span>
      </div>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function KitchenEmpty({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-6 text-center">
      <ChefHat size={26} className="mx-auto text-muted-foreground" />
      <p className="mt-2 text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

function KitchenOrderCard({
  order,
  mode,
  busy,
  delayed,
  expectedMinutes,
  currency,
  now,
  onTake,
  onFinish,
}: {
  order: Pedido;
  mode: 'pending' | 'preparing' | 'finalized';
  busy: boolean;
  delayed: boolean;
  expectedMinutes: number;
  currency?: string;
  now: Date;
  onTake?: () => void;
  onFinish?: () => void;
}) {
  const age = minutesSince(order.creadoEn, now);
  const isNew = age < 1;
  const visibleItems = kitchenItems(order);
  const hasDirectItems = order.items.some((item) => item.ventaDirecta);
  return (
    <article className={`rounded-2xl border bg-card p-4 shadow-sm transition-colors ${delayed ? 'border-rose-500/50 ring-1 ring-rose-500/15' : 'border-border'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xl font-bold leading-none text-foreground">#{order.numero}</span>
            {isNew && mode === 'pending' && <Badge className="border-transparent bg-primary text-primary-foreground">NUEVO</Badge>}
            {delayed && <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300">Demorado · {age} min</Badge>}
            <Badge variant="outline" className="text-muted-foreground">Local</Badge>
          </div>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Clock3 size={12} /> {formatTime(order.creadoEn)} · hace {age < 1 ? 'menos de 1 min' : `${age} min`}
          </p>
        </div>
        <div className="text-right">
          <p className="flex items-center justify-end gap-1 text-sm font-semibold text-foreground">
            <MapPin size={14} className="text-primary" /> {order.mesaNombre}
          </p>
          <p className="text-xs text-muted-foreground">{order.meseroNombre}</p>
        </div>
      </div>

      <ul className="mt-3 space-y-2 border-y border-border/70 py-3">
        {visibleItems.map((item) => (
          <li key={item.id}>
            <div className="flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0 text-foreground"><strong className="text-base">{item.cantidad}×</strong> {item.nombre}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatMoney(item.precioUnitario * item.cantidad, currency)}</span>
            </div>
            {item.nota && <p className="mt-0.5 rounded-lg bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-800 dark:text-amber-200">Nota: {item.nota}</p>}
          </li>
        ))}
      </ul>

      {hasDirectItems && (
        <p className="mt-2 text-[11px] font-medium text-muted-foreground">Incluye productos de venta directa; no se preparan en cocina.</p>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="min-w-0 text-xs text-muted-foreground">
          {mode === 'preparing' && order.tomadoPorNombre && (
            <span className="flex items-center gap-1"><Users size={12} /> Tomado por {order.tomadoPorNombre}</span>
          )}
          {mode === 'finalized' && order.finalizadoEn && (
            <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300"><CheckCircle2 size={13} /> {order.finalizadoEn ? `Listo a las ${formatTime(order.finalizadoEn)}` : 'Listo'}</span>
          )}
          {mode === 'pending' && <span className="flex items-center gap-1"><Timer size={12} /> Objetivo: {expectedMinutes} min</span>}
        </div>
        <span className="shrink-0 text-sm font-bold text-foreground">{formatMoney(order.total, currency)}</span>
      </div>

      {mode === 'pending' && onTake && (
        <Button className="mt-3 h-12 w-full" onClick={onTake} disabled={busy}>
          <Play size={18} /> {busy ? 'Tomando…' : 'Tomar'}
        </Button>
      )}
      {mode === 'preparing' && onFinish && (
        <Button className="mt-3 h-12 w-full bg-emerald-600 text-white hover:bg-emerald-700" onClick={onFinish} disabled={busy}>
          <CheckCircle2 size={18} /> {busy ? 'Finalizando…' : 'Finalizado'}
        </Button>
      )}
      {mode === 'finalized' && (
        <div className="mt-3 flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-500/10 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
          <PedidoStatusBadge estado={order.estado} />
          <span>Listo para llevar</span>
        </div>
      )}
    </article>
  );
}
