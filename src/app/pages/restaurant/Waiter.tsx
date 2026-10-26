import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  ArrowLeft,
  ChefHat,
  Clock3,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShoppingBag,
  Trash2,
  UserRound,
  Users,
  UtensilsCrossed
} from 'lucide-react';
import { toast } from 'sonner';
import { Layout } from '../../components/Layout';
import { RevealGroup, RevealItem } from '../../components/motion/Reveal';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { dataService, type OrderRecord, type RestaurantTableRecord } from '../../services/dataService';
import type { Product } from '../../utils/mockData';

const WAITER_KEY = 'manager_stock_waiter_name';

const money = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);

const STATUS_LABELS: Record<OrderRecord['status'], string> = {
  received: 'Recibido',
  preparing: 'En preparación',
  ready: 'Listo',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};

export function Waiter() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [waiter, setWaiter] = useState(() => localStorage.getItem(WAITER_KEY) || '');
  const [nameDraft, setNameDraft] = useState('');
  const [tables, setTables] = useState<RestaurantTableRecord[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [cart, setCart] = useState<{ productId: string; quantity: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tableRows, openOrders, catalog] = await Promise.all([
        dataService.getTables(),
        dataService.getOpenOrders(),
        dataService.getProducts(),
      ]);
      setTables(tableRows);
      setOrders(openOrders);
      setProducts(catalog.filter((product) => product.productType !== 'ingredient' && product.productType !== 'supplies'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cargar el salón.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const fromUrl = Number(searchParams.get('mesa'));
    if (Number.isInteger(fromUrl) && fromUrl > 0) setSelectedNumber(fromUrl);
  }, [searchParams]);

  const activeTables = useMemo(() => tables.filter((table) => table.status === 'active'), [tables]);
  const selectedTable = useMemo(() => activeTables.find((table) => table.number === selectedNumber) ?? null, [activeTables, selectedNumber]);
  const tableOrders = useMemo(
    () => (selectedNumber == null ? [] : orders.filter((order) => order.tableNumber === selectedNumber)),
    [orders, selectedNumber]
  );
  const openComanda = useMemo(
    () => tableOrders.find((order) => order.status === 'received' || order.status === 'preparing') ?? null,
    [tableOrders]
  );

  const categories = useMemo(() => Array.from(new Set(products.map((product) => product.category).filter(Boolean))).sort(), [products]);
  const visibleProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = !category || product.category === category;
      const matchesTerm = !term || product.name.toLowerCase().includes(term);
      return matchesCategory && matchesTerm;
    });
  }, [products, search, category]);

  const cartLines = useMemo(
    () =>
      cart
        .map((line) => {
          const product = products.find((row) => row.id === line.productId);
          return product ? { product, quantity: line.quantity } : null;
        })
        .filter((line): line is { product: Product; quantity: number } => line !== null),
    [cart, products]
  );
  const cartTotal = cartLines.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
  const cartCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((line) => line.productId === product.id);
      if (existing) return prev.map((line) => (line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line));
      return [...prev, { productId: product.id, quantity: 1 }];
    });
  };

  const changeQuantity = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((line) => (line.productId === productId ? { ...line, quantity: line.quantity + delta } : line))
        .filter((line) => line.quantity > 0)
    );
  };

  const removeLine = (productId: string) => setCart((prev) => prev.filter((line) => line.productId !== productId));

  const startWaiterSession = (event: FormEvent) => {
    event.preventDefault();
    const name = nameDraft.trim();
    if (name.length < 2) {
      toast.error('Escribe tu nombre para identificar la comanda.');
      return;
    }
    localStorage.setItem(WAITER_KEY, name);
    setWaiter(name);
  };

  const changeWaiter = () => {
    localStorage.removeItem(WAITER_KEY);
    setWaiter('');
    setNameDraft('');
    setSelectedNumber(null);
    setCart([]);
  };

  const sendToKitchen = async () => {
    if (selectedNumber == null || cart.length === 0) return;
    setSending(true);
    try {
      const items = cart.map((line) => ({ productId: line.productId, quantity: line.quantity }));
      if (openComanda) {
        await dataService.addOrderItems(openComanda.id, items);
        toast.success('Productos agregados a la comanda de la mesa.');
      } else {
        await dataService.createOrder({
          channel: 'table',
          tableNumber: selectedNumber,
          waiter,
          customer: `Mesa ${selectedNumber}`,
          items,
        });
        toast.success('Comanda enviada a cocina.');
      }
      setCart([]);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo enviar la comanda.');
    } finally {
      setSending(false);
    }
  };

  if (!waiter) {
    return (
      <Layout>
        <RevealGroup className="mx-auto max-w-md space-y-4">
          <RevealItem>
            <Card className="rounded-2xl p-6">
              <div className="flex items-center gap-3">
                <span className="rounded-xl bg-primary/10 p-2 text-primary">
                  <UserRound className="h-5 w-5" />
                </span>
                <div>
                  <h1 className="font-display text-2xl font-semibold text-foreground">Vista de mesero</h1>
                  <p className="text-sm text-muted-foreground">Escribe tu nombre para firmar las comandas.</p>
                </div>
              </div>
              <form onSubmit={startWaiterSession} className="mt-5 space-y-3">
                <div className="grid gap-2">
                  <Label htmlFor="waiter-name">Nombre del mesero</Label>
                  <Input id="waiter-name" value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} placeholder="Ej. Camila" required />
                </div>
                <Button type="submit" className="w-full">
                  Comenzar turno
                </Button>
              </form>
            </Card>
          </RevealItem>
        </RevealGroup>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <RevealGroup>
          <RevealItem className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Servicio en salón</p>
              <h1 className="font-display text-4xl font-semibold text-foreground">{selectedTable ? `Mesa ${selectedTable.number}` : 'Tomar pedido'}</h1>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <UserRound className="h-4 w-4" />
                {waiter}
                {selectedTable?.zone ? ` · ${selectedTable.zone}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {selectedNumber != null && (
                <Button variant="outline" onClick={() => { setSelectedNumber(null); setCart([]); }}>
                  <ArrowLeft className="h-4 w-4" />
                  Cambiar mesa
                </Button>
              )}
              <Button variant="outline" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Actualizar
              </Button>
              <Button variant="ghost" onClick={changeWaiter}>
                Cambiar mesero
              </Button>
            </div>
          </RevealItem>

          {selectedNumber == null ? (
            loading ? (
              <RevealItem>
                <Card className="rounded-2xl p-8 text-center text-sm text-muted-foreground">Cargando mesas…</Card>
              </RevealItem>
            ) : activeTables.length === 0 ? (
              <RevealItem>
                <Card className="rounded-2xl border-dashed p-10 text-center">
                  <UtensilsCrossed className="mx-auto h-8 w-8 text-primary" />
                  <p className="mt-3 text-sm text-muted-foreground">No hay mesas configuradas todavía. Créalas desde Gestión de Mesas.</p>
                  <Button className="mt-4" variant="outline" onClick={() => navigate('/restaurant/tables')}>
                    Ir a Gestión de Mesas
                  </Button>
                </Card>
              </RevealItem>
            ) : (
              <RevealItem className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {activeTables.map((table) => {
                  const rows = orders.filter((order) => order.tableNumber === table.number);
                  const occupied = rows.length > 0;
                  const total = rows.reduce((sum, order) => sum + order.total, 0);
                  return (
                    <Card
                      key={table.id}
                      className={`cursor-pointer rounded-2xl p-4 transition-colors hover:border-primary/50 ${occupied ? 'border-amber-500/40' : ''}`}
                      onClick={() => setSelectedNumber(table.number)}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-lg font-semibold text-foreground">Mesa {table.number}</p>
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            <Users className="h-3.5 w-3.5" />
                            {table.capacity} puestos
                          </p>
                        </div>
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${occupied ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                          {occupied ? 'Ocupada' : 'Disponible'}
                        </span>
                      </div>
                      {occupied && <p className="mt-3 text-xs text-muted-foreground">{rows.length} comanda(s) · {money(total)}</p>}
                    </Card>
                  );
                })}
              </RevealItem>
            )
          ) : (
            <RevealItem className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar en el menú…" className="pl-9" />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant={category ? 'outline' : 'default'} className="rounded-full" onClick={() => setCategory('')}>
                    Todo
                  </Button>
                  {categories.map((name) => (
                    <Button key={name} size="sm" variant={category === name ? 'default' : 'outline'} className="rounded-full" onClick={() => setCategory(name)}>
                      {name}
                    </Button>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {visibleProducts.map((product) => (
                    <Card key={product.id} className="rounded-2xl p-3">
                      <p className="text-sm font-semibold text-foreground">{product.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{product.category || 'Sin categoría'}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-sm font-semibold text-primary">{money(product.price)}</span>
                        <Button size="sm" onClick={() => addToCart(product)} aria-label={`Agregar ${product.name}`}>
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </Card>
                  ))}
                  {visibleProducts.length === 0 && (
                    <Card className="rounded-2xl border-dashed p-6 text-center text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">
                      No hay productos que coincidan con la búsqueda.
                    </Card>
                  )}
                </div>
              </div>

              <div className="space-y-3 lg:sticky lg:top-6 lg:self-start">
                {openComanda && (
                  <Card className="rounded-2xl p-4">
                    <div className="flex items-center justify-between">
                      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <ChefHat className="h-4 w-4 text-primary" />
                        Comanda en cocina
                      </p>
                      <span className="rounded-full bg-muted px-2 py-1 text-xs font-semibold text-foreground">{STATUS_LABELS[openComanda.status]}</span>
                    </div>
                    <ul className="mt-3 space-y-1 text-sm">
                      {openComanda.items.map((item, index) => (
                        <li key={`${item.productId}-${index}`} className="flex justify-between gap-3">
                          <span className="text-foreground">
                            {item.quantity} × {item.productName}
                          </span>
                          <span className="text-muted-foreground">{money(item.unitPrice * item.quantity)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 flex items-center justify-between border-t border-border/60 pt-3 text-sm font-semibold text-foreground">
                      <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                        <Clock3 className="h-3.5 w-3.5" />
                        Lo agregado se suma a esta comanda
                      </span>
                      {money(openComanda.total)}
                    </p>
                  </Card>
                )}

                <Card className="rounded-2xl p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <ShoppingBag className="h-4 w-4 text-primary" />
                    Nuevo pedido {cartCount > 0 ? `(${cartCount})` : ''}
                  </p>
                  {cartLines.length === 0 ? (
                    <p className="mt-3 rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
                      Toca los productos del menú para armar el pedido.
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {cartLines.map((line) => (
                        <li key={line.product.id} className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-foreground">{line.product.name}</p>
                            <p className="text-xs text-muted-foreground">{money(line.product.price * line.quantity)}</p>
                          </div>
                          <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => changeQuantity(line.product.id, -1)} aria-label="Quitar uno">
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-5 text-center text-sm font-semibold text-foreground">{line.quantity}</span>
                          <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => changeQuantity(line.product.id, 1)} aria-label="Agregar uno">
                            <Plus className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeLine(line.product.id)} aria-label="Quitar del pedido">
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3 text-sm font-semibold text-foreground">
                    <span>Total</span>
                    <span>{money(cartTotal)}</span>
                  </div>
                  <Button className="mt-3 w-full" onClick={() => void sendToKitchen()} disabled={sending || cartLines.length === 0}>
                    <Send className="h-4 w-4" />
                    {sending ? 'Enviando…' : openComanda ? 'Agregar a la comanda' : 'Enviar a cocina'}
                  </Button>
                </Card>
              </div>
            </RevealItem>
          )}
        </RevealGroup>
      </div>
    </Layout>
  );
}
