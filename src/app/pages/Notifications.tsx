import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, Bell, CheckCheck, CircleDollarSign, Package, RefreshCw, SearchX, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../utils/notifications';
import { Layout } from '../components/Layout';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { dataService, type SaleRecord } from '../services/dataService';
import type { Product } from '../utils/types';
import { useAuth } from '../context/AuthContext';

type NotificationType = 'low_stock' | 'sale';
interface NotificationRecord {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  date: string;
  productId?: string;
  saleId?: string;
  read: boolean;
}
interface LocalNotificationState { readIds: string[]; dismissedIds: string[]; }

const money = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value || 0);
const storageKey = (userId: string) => `manager_stock_notifications_v1:${userId}`;

function readLocalState(userId: string): LocalNotificationState {
  try {
    const value = localStorage.getItem(storageKey(userId));
    if (!value) return { readIds: [], dismissedIds: [] };
    const parsed = JSON.parse(value) as Partial<LocalNotificationState>;
    return { readIds: Array.isArray(parsed.readIds) ? parsed.readIds : [], dismissedIds: Array.isArray(parsed.dismissedIds) ? parsed.dismissedIds : [] };
  } catch {
    return { readIds: [], dismissedIds: [] };
  }
}

export function Notifications() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.id ?? 'anonymous-preview';
  const isCustomRole = Boolean(user?.customRoleId);
  const canReadCatalog = !isCustomRole || Boolean(user?.permissions?.includes('catalog.view'));
  const canReadSales = !isCustomRole || Boolean(user?.permissions?.includes('sales.view'));
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [readIds, setReadIds] = useState<string[]>([]);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  useEffect(() => {
    const saved = readLocalState(userId);
    setReadIds(saved.readIds);
    setDismissedIds(saved.dismissedIds);
  }, [userId]);

  const persistLocalState = useCallback((nextRead: string[], nextDismissed: string[]) => {
    setReadIds(nextRead);
    setDismissedIds(nextDismissed);
    try { localStorage.setItem(storageKey(userId), JSON.stringify({ readIds: nextRead, dismissedIds: nextDismissed })); }
    catch (error) { toastError(error, 'No se pudo guardar el estado local de las notificaciones en este navegador.'); }
  }, [userId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextProducts, nextSales] = await Promise.all([
        canReadCatalog ? dataService.getProducts() : Promise.resolve([] as Product[]),
        canReadSales ? dataService.getSales() : Promise.resolve([] as SaleRecord[]),
      ]);
      setProducts(nextProducts);
      setSales(nextSales);
    } catch (error) {
      toastError(error, 'No se pudieron cargar las alertas del negocio.');
    } finally { setLoading(false); }
  }, [canReadCatalog, canReadSales]);

  useEffect(() => { void load(); }, [load]);

  const allNotifications = useMemo(() => {
    const now = Date.now();
    const recentCutoff = now - 3 * 24 * 60 * 60 * 1000;
    const stockAlerts: NotificationRecord[] = canReadCatalog ? products
      .filter(product => product.stock <= product.minStock)
      .map(product => ({
        id: `stock:${product.id}`,
        type: 'low_stock' as const,
        title: `Existencias bajas: ${product.name}`,
        message: `Quedan ${product.stock} unidades; el mínimo configurado es ${product.minStock}.`,
        date: new Date().toISOString(),
        productId: product.id,
        read: readIds.includes(`stock:${product.id}`),
      })) : [];
    const recentSales: NotificationRecord[] = canReadSales ? sales
      .filter(sale => sale.status === 'completed' && new Date(sale.date).getTime() >= recentCutoff)
      .slice(0, 10)
      .map(sale => ({
        id: `sale:${sale.id}`,
        type: 'sale' as const,
        title: `Venta completada: ${sale.id}`,
        message: `${sale.quantity} unidad(es) · ${money(sale.totalPrice)} · ${sale.paymentMethod}`,
        date: sale.date,
        saleId: sale.id,
        read: readIds.includes(`sale:${sale.id}`),
      })) : [];
    return [...stockAlerts, ...recentSales]
      .filter(item => !dismissedIds.includes(item.id))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [products, sales, readIds, dismissedIds, canReadCatalog, canReadSales]);

  const unreadCount = allNotifications.filter(item => !item.read).length;
  const stockCount = allNotifications.filter(item => item.type === 'low_stock').length;
  const markRead = (id: string) => persistLocalState([...new Set([...readIds, id])], dismissedIds);
  const markAllRead = () => persistLocalState([...new Set([...readIds, ...allNotifications.map(item => item.id)])], dismissedIds);
  const clearAll = () => {
    if (!allNotifications.length) return;
    persistLocalState(readIds, [...new Set([...dismissedIds, ...allNotifications.map(item => item.id)])]);
    toast.success('Se ocultaron las notificaciones actuales. Las nuevas alertas aparecerán cuando haya nuevos eventos.');
  };
  const openNotification = (item: NotificationRecord) => {
    markRead(item.id);
    navigate(item.productId ? '/products' : item.saleId ? `/sales/${item.saleId}` : '/dashboard');
  };

  const canSeeAnySource = canReadCatalog || canReadSales;
  return <Layout>
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--brand-primary)]">Centro de alertas</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Notificaciones</h1>
          <p className="mt-2 text-sm text-muted-foreground">Alertas derivadas de los productos y ventas guardados por tu negocio.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading} className="rounded-xl"><RefreshCw size={16} className={`mr-2 ${loading ? 'animate-spin' : ''}`}/>Actualizar</Button>
          <Button type="button" variant="outline" onClick={markAllRead} disabled={!unreadCount} className="rounded-xl"><CheckCheck size={16} className="mr-2"/>Marcar leídas</Button>
          <Button type="button" variant="outline" onClick={clearAll} disabled={!allNotifications.length} className="rounded-xl"><Trash2 size={16} className="mr-2"/>Limpiar</Button>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="rounded-2xl border-border/70 p-5"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Alertas de inventario</span><Package className="h-5 w-5 text-[var(--brand-primary)]"/></div><p className="mt-3 text-3xl font-bold">{stockCount}</p><p className="mt-1 text-xs text-muted-foreground">Productos en el mínimo o por debajo</p></Card>
        <Card className="rounded-2xl border-border/70 p-5"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Sin leer</span><Bell className="h-5 w-5 text-[var(--brand-primary)]"/></div><p className="mt-3 text-3xl font-bold">{unreadCount}</p><p className="mt-1 text-xs text-muted-foreground">Eventos que no has marcado como leídos</p></Card>
        <Card className="rounded-2xl border-border/70 p-5"><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Notificaciones visibles</span><CircleDollarSign className="h-5 w-5 text-[var(--brand-primary)]"/></div><p className="mt-3 text-3xl font-bold">{allNotifications.length}</p><p className="mt-1 text-xs text-muted-foreground">Alertas y ventas de los últimos tres días</p></Card>
      </div>

      {!canSeeAnySource ? <Card className="rounded-2xl border-dashed p-10 text-center"><SearchX className="mx-auto h-9 w-9 text-muted-foreground/50"/><h2 className="mt-3 font-semibold">No tienes permisos para consultar estas alertas</h2><p className="mt-1 text-sm text-muted-foreground">Solicita al propietario acceso al catálogo o a las ventas.</p></Card> : loading ? <Card className="rounded-2xl p-10 text-center text-sm text-muted-foreground">Cargando alertas reales del negocio…</Card> : allNotifications.length === 0 ? <Card className="rounded-2xl border-dashed p-12 text-center"><Bell className="mx-auto h-10 w-10 text-muted-foreground/40"/><h2 className="mt-3 font-semibold">No hay notificaciones pendientes</h2><p className="mt-1 text-sm text-muted-foreground">Las alertas de existencias bajas y las ventas recientes aparecerán aquí cuando correspondan.</p></Card> : <Card className="overflow-hidden rounded-2xl border-border/70 shadow-sm"><div className="divide-y divide-border/70">{allNotifications.map(item => <div key={item.id} className={`flex flex-col gap-3 p-4 transition-colors sm:flex-row sm:items-center ${item.read ? 'bg-card' : 'bg-[var(--brand-soft)]/60'}`}><div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${item.type === 'low_stock' ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-[var(--brand-soft)] text-[var(--brand-primary)]'}`}>{item.type === 'low_stock' ? <AlertTriangle size={20}/> : <CircleDollarSign size={20}/>}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{item.title}</h2><Badge variant="outline" className="rounded-md">{item.type === 'low_stock' ? 'Inventario' : 'Venta'}</Badge>{!item.read && <span className="rounded-full bg-[var(--brand-primary)] px-2 py-0.5 text-[10px] font-semibold text-white">Nueva</span>}</div><p className="mt-1 text-sm text-muted-foreground">{item.message}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(item.date).toLocaleString('es-CO')}</p></div><div className="flex shrink-0 gap-2"><Button type="button" variant="outline" size="sm" onClick={() => openNotification(item)} className="rounded-lg">Ver detalle</Button><Button type="button" variant="ghost" size="icon" aria-label={`Ocultar ${item.title}`} onClick={() => persistLocalState(readIds, [...new Set([...dismissedIds, item.id])])}><Trash2 size={16}/></Button></div></div>)}</div></Card>}
    </div>
  </Layout>;
}
