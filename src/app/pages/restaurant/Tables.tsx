import { canPerformAction } from '../../security/permissions';
import { useCallback, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Separator } from '../../components/ui/separator';
import {
  Users,
  Clock,
  CheckCircle2,
  XCircle,
  Plus,
  UtensilsCrossed,
  Search,
  Minus,
  ShoppingCart,
  Receipt,
  X,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../utils/notifications';
import { dataService, type OrderRecord, type RestaurantTableRecord } from '../../services/dataService';
import { findProductByBarcode, type Product } from '../../utils/mockData';
import { useAuth } from '../../context/AuthContext';
import { useBusiness } from '../../context/BusinessContext';

const money = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);

const NON_KITCHEN_CATEGORIES = ['bebidas', 'gaseosas', 'aguas', 'jugos', 'café', 'te', 'cervezas', 'vinos', 'licores', 'refrescos', 'sodas'];
const goesToKitchen = (category: string) => !NON_KITCHEN_CATEGORIES.some((c) => category.toLowerCase().includes(c));

const nextFreeNumber = (rows: RestaurantTableRecord[]) => {
  const taken = new Set(rows.map((table) => table.number));
  let candidate = 1;
  while (taken.has(candidate)) candidate += 1;
  return candidate;
};

interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  sku: string;
  sendToKitchen: boolean;
}

interface TableView {
  table: RestaurantTableRecord;
  orders: OrderRecord[];
  items: number;
  total: number;
  occupied: boolean;
  inactive: boolean;
  since: string | null;
}

const elapsedLabel = (iso: string | null) => {
  if (!iso) return '';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
};

export function Tables() {
  const { config } = useBusiness();
  const { user } = useAuth();
  const canCollect = canPerformAction(user, 'sales.create');
  const canEditTables = user?.role === 'owner' || user?.role === 'business_admin' || (!!user?.customRoleId && canPerformAction(user, 'orders.manage'));
  const canManage = canPerformAction(user, 'orders.manage');
  const [tables, setTables] = useState<RestaurantTableRecord[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedTable, setSelectedTable] = useState<RestaurantTableRecord | null>(null);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState('Todos');
  const [customerName, setCustomerName] = useState('');
  const [savingOrder, setSavingOrder] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RestaurantTableRecord | null>(null);
  const [tableNumber, setTableNumber] = useState('');
  const [zone, setZone] = useState('');
  const [capacity, setCapacity] = useState('4');
  const [bulkCount, setBulkCount] = useState('8');
  const [savingTable, setSavingTable] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tableRows, orderRows] = await Promise.all([dataService.getTables(), dataService.getOrders()]);
      setTables(tableRows);
      setOrders(orderRows);
    } catch (error) {
      toastError(error, 'No se pudo cargar el salón.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let active = true;
    setProducts([]);
    void dataService.getProducts().then((list) => {
      if (!active) return;
      setProducts(list.filter((p) => p.productType !== 'ingredient' && p.productType !== 'supplies'));
    });
    return () => {
      active = false;
    };
  }, [user?.businessId]);

  const activeOrders = useMemo(
    () => orders.filter((o) => o.status !== 'delivered' && o.status !== 'cancelled'),
    [orders]
  );

  const tableViews = useMemo<TableView[]>(
    () =>
      tables.map((table) => {
        const tableOrders = activeOrders.filter((o) => Number(o.tableNumber) === table.number);
        // Los productos "solo cuenta" viajan dentro del pedido (restaurantMetadata.directProductIds),
        // así que todo el consumo de la mesa sale del backend.
        const items = tableOrders.reduce((sum, order) => sum + order.items.reduce((s, item) => s + item.quantity, 0), 0);
        const inactive = table.status !== 'active';
        return {
          table,
          orders: tableOrders,
          items,
          total: tableOrders.reduce((sum, order) => sum + order.total, 0),
          occupied: !inactive && items > 0,
          inactive,
          since: tableOrders[0]?.created_at ?? null,
        };
      }),
    [tables, activeOrders]
  );

  const stats = useMemo(() => {
    const occupied = tableViews.filter((view) => view.occupied).length;
    return {
      total: tableViews.length,
      available: tableViews.filter((view) => !view.inactive && !view.occupied).length,
      occupied,
      open: activeOrders.length,
    };
  }, [tableViews, activeOrders.length]);

  const selectedView = useMemo(
    () => (selectedTable ? tableViews.find((view) => view.table.id === selectedTable.id) ?? null : null),
    [selectedTable, tableViews]
  );

  const categories = ['Todos', ...Array.from(new Set(products.map((p) => p.category)))];

  const filteredProducts = useMemo(
    () =>
      products.filter((product) => {
        const matchSearch =
          product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          product.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
          product.category.toLowerCase().includes(searchTerm.toLowerCase());
        const matchCat = activeCategory === 'Todos' || product.category === activeCategory;
        return matchSearch && matchCat;
      }),
    [products, searchTerm, activeCategory]
  );

  const addToCart = (product: Product) => {
    const existing = cart.find((item) => item.productId === product.id);
    if (existing) {
      if (existing.quantity + 1 > product.stock) {
        toast.error('Sin stock suficiente');
        return;
      }
      setCart(cart.map((item) => (item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item)));
    } else {
      if (product.stock < 1) {
        toast.error('Producto sin stock');
        return;
      }
      setCart([
        ...cart,
        { productId: product.id, name: product.name, price: product.price, quantity: 1, sku: product.sku, sendToKitchen: goesToKitchen(product.category) },
      ]);
    }
  };

  const updateQuantity = (productId: string, delta: number) => {
    const product = products.find((p) => p.id === productId);
    const cartItem = cart.find((item) => item.productId === productId);
    if (!product || !cartItem) return;
    const newQty = cartItem.quantity + delta;
    if (newQty < 1) {
      setCart(cart.filter((item) => item.productId !== productId));
      return;
    }
    if (newQty > product.stock) {
      toast.error('Sin stock suficiente');
      return;
    }
    setCart(cart.map((item) => (item.productId === productId ? { ...item, quantity: newQty } : item)));
  };

  const removeFromCart = (productId: string) => setCart(cart.filter((item) => item.productId !== productId));

  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const cartItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const openCreate = () => {
    setEditing(null);
    setTableNumber(String(nextFreeNumber(tables)));
    setZone('');
    setCapacity('4');
    setConfirmDelete(false);
    setFormOpen(true);
  };

  const openEdit = (table: RestaurantTableRecord) => {
    setEditing(table);
    setTableNumber(String(table.number));
    setZone(table.zone);
    setCapacity(String(table.capacity));
    setConfirmDelete(false);
    setFormOpen(true);
  };

  const submitForm = async (event: FormEvent) => {
    event.preventDefault();
    const parsedNumber = Number(tableNumber);
    const parsedCapacity = Number(capacity) || 4;
    if (!Number.isInteger(parsedNumber) || parsedNumber < 1) {
      toast.error('El número de mesa debe ser un entero mayor a cero.');
      return;
    }
    setSavingTable(true);
    try {
      if (editing) {
        const updated = await dataService.updateTable(editing.id, { number: parsedNumber, zone: zone.trim(), capacity: parsedCapacity });
        setTables((prev) => prev.map((table) => (table.id === updated.id ? updated : table)).sort((a, b) => a.number - b.number));
        toast.success(`Mesa ${updated.number} actualizada.`);
      } else {
        const created = await dataService.createTable({ number: parsedNumber, zone: zone.trim(), capacity: parsedCapacity });
        setTables((prev) => [...prev.filter((table) => table.id !== created.id), created].sort((a, b) => a.number - b.number));
        toast.success(`Mesa ${created.number} creada.`);
      }
      setFormOpen(false);
    } catch (error) {
      toastError(error, 'No se pudo guardar la mesa.');
    } finally {
      setSavingTable(false);
    }
  };

  const bulkCreate = async () => {
    const count = Math.min(50, Math.max(1, Number(bulkCount) || 0));
    setSavingTable(true);
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
          toastError(error, `No se pudo crear la mesa ${candidate}.`);
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
      setSavingTable(false);
    }
  };

  const toggleStatus = async (table: RestaurantTableRecord) => {
    try {
      const updated = await dataService.updateTable(table.id, { status: table.status === 'active' ? 'inactive' : 'active' });
      setTables((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      toast.success(updated.status === 'active' ? `Mesa ${updated.number} habilitada.` : `Mesa ${updated.number} fuera de servicio.`);
      setFormOpen(false);
    } catch (error) {
      toastError(error, 'No se pudo cambiar el estado de la mesa.');
    }
  };

  const removeTable = async (table: RestaurantTableRecord) => {
    try {
      await dataService.deleteTable(table.id);
      setTables((prev) => prev.filter((row) => row.id !== table.id));
      setFormOpen(false);
      toast.success(`Mesa ${table.number} eliminada.`);
    } catch (error) {
      toastError(error, 'No se pudo eliminar la mesa.');
    }
  };

  const openTable = (view: TableView) => {
    if (!canManage) return;
    if (view.inactive) return;
    setSelectedTable(view.table);
    setCart([]);
    setCustomerName(user?.name || '');
    setSearchTerm('');
    setActiveCategory('Todos');
    setShowOrderModal(true);
  };

  const saveTableOrder = async () => {
    if (!selectedTable) return;
    if (cart.length === 0) {
      toast.error('Agrega al menos un producto nuevo a la mesa');
      return;
    }
    setSavingOrder(true);
    try {
      const kitchenItems = cart.filter(item => item.sendToKitchen);
      const billOnlyItems = cart.filter(item => !item.sendToKitchen);
      await dataService.createOrder({
        channel: 'table', customer: customerName.trim() || `Mesa ${selectedTable.number}`,
        tableId: selectedTable.id, tableNumber: selectedTable.number,
        waiter: user?.name || '',
        items: cart.map(item => ({ productId: item.productId, quantity: item.quantity })),
        restaurantMetadata: { mesaId: selectedTable.id, meseroId: user?.id || '', directProductIds: billOnlyItems.map(item => item.productId) },
      });

      const refreshed = await dataService.getOrders();
      setOrders(refreshed);

      const kitchenCount = kitchenItems.reduce((sum, item) => sum + item.quantity, 0);
      const billCount = billOnlyItems.reduce((sum, item) => sum + item.quantity, 0);
      const parts: string[] = [];
      if (kitchenCount > 0) parts.push(`${kitchenCount} a cocina`);
      if (billCount > 0) parts.push(`${billCount} a cuenta`);
      toast.success(`Mesa ${selectedTable.number} actualizada`, { description: parts.join(' · ') + ` · ${money(cartTotal)}` });
      setShowOrderModal(false);
      setCart([]);
    } catch (error) {
      toastError(error, 'No se pudo guardar el pedido');
    } finally {
      setSavingOrder(false);
    }
  };

  const closeTable = async (view: TableView) => {
    if (!view.occupied) return;
    setClosingId(view.table.id);
    try {
      // Keep the same key after an ambiguous network failure, including bills
      // containing only drinks. Clear it only once the sale is confirmed.
      const keyName = `table_checkout_${view.table.id}`;
      let key = localStorage.getItem(keyName);
      if (!key) {
        key = crypto.randomUUID();
        localStorage.setItem(keyName, key);
      }
      const session = await dataService.getCurrentCashSession();
      const sale = await dataService.createSale({
        orderIds: view.orders.map(order => order.id),
        items: [],
        customer: `Mesa ${view.table.number}`,
        paymentMethod: 'cash',
        taxRate: config?.taxRate,
        cashSessionId: session?.id,
        idempotencyKey: key,
      });
      localStorage.removeItem(`table_bill_only_${view.table.id}`); // limpia restos de versiones anteriores
      localStorage.removeItem(keyName);
      setOrders(prev => prev.filter(order => !view.orders.some(closed => closed.id === order.id)));
      toast.success(`Mesa ${view.table.number} cerrada`, { description: `Total cobrado en efectivo: ${money(sale.totalPrice)}` });
      void dataService.getOrders().then(setOrders).catch(() => undefined);
    } catch (error) {
      toastError(error, 'No se pudo cerrar la mesa');
    } finally {
      setClosingId(null);
    }
  };

  const handleBarcodeSearch = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      const code = searchTerm.trim();
      const product =
        products.find((p) => p.sku.toLowerCase() === code.toLowerCase() || p.codigosBarras?.includes(code)) ||
        findProductByBarcode(code);
      if (product) {
        addToCart(product);
        setSearchTerm('');
        toast.success(`${product.name} añadido`);
      }
    }
  };

  const statusColor = (view: TableView) => {
    if (view.inactive) return 'bg-muted/40 border-border';
    if (view.occupied) return 'bg-rose-500/10 border-rose-500/30';
    return 'bg-emerald-500/10 border-emerald-500/30';
  };

  const statusBadge = (view: TableView) => {
    if (view.inactive) return <Badge className="bg-muted text-muted-foreground">Fuera de servicio</Badge>;
    if (view.occupied) return <Badge className="bg-rose-500 text-white">Ocupada</Badge>;
    return <Badge className="bg-emerald-500 text-white">Disponible</Badge>;
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Gestión de Mesas</h2>
            <p className="text-muted-foreground mt-1">Crea tus mesas, abre una mesa y envía el pedido a cocina</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Actualizar
            </Button>
            <Button style={{ display: canEditTables ? undefined : 'none' }} onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Nueva mesa
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Card className="min-w-0 p-4 border border-border">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">Total mesas</p>
                <p className="text-2xl font-bold text-foreground">{stats.total}</p>
              </div>
              <UtensilsCrossed className="text-muted-foreground" size={32} />
            </div>
          </Card>

          <Card className="min-w-0 p-4 border border-border">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">Disponibles</p>
                <p className="text-2xl font-bold text-emerald-500">{stats.available}</p>
              </div>
              <CheckCircle2 className="text-emerald-500" size={32} />
            </div>
          </Card>

          <Card className="min-w-0 p-4 border border-border">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">Ocupadas</p>
                <p className="text-2xl font-bold text-rose-500">{stats.occupied}</p>
              </div>
              <XCircle className="text-rose-500" size={32} />
            </div>
          </Card>

          <Card className="min-w-0 p-4 border border-border">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">Comandas abiertas</p>
                <p className="text-2xl font-bold text-amber-500">{stats.open}</p>
              </div>
              <Clock className="text-amber-500" size={32} />
            </div>
          </Card>
        </div>

        {loading ? (
          <Card className="p-10 text-center text-sm text-muted-foreground">Cargando mesas…</Card>
        ) : tableViews.length === 0 ? (
          <Card className="border-dashed p-10 text-center">
            <UtensilsCrossed className="mx-auto h-8 w-8 text-primary" />
            <p className="mt-3 text-sm text-muted-foreground">Aún no hay mesas. Crea la primera para empezar a tomar pedidos en el salón.</p>
            <Button style={{ display: canEditTables ? undefined : 'none' }} className="mt-4" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Crear mesas
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {tableViews.map((view) => (
              <Card
                key={view.table.id}
                className={`min-w-0 p-5 border transition-colors ${view.inactive ? 'cursor-default' : 'cursor-pointer'} ${statusColor(view)}`}
                onClick={() => openTable(view)}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-xl font-bold text-foreground">Mesa {view.table.number}</h3>
                      <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground mt-1">
                        <Users size={14} />
                        <span>{view.table.capacity} personas</span>
                        {view.table.zone ? <span>· {view.table.zone}</span> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {statusBadge(view)}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        style={{ display: canEditTables ? undefined : 'none' }}
                        aria-label={`Editar mesa ${view.table.number}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEdit(view.table);
                        }}
                      >
                        <Pencil size={14} />
                      </Button>
                    </div>
                  </div>

                  {view.occupied && (
                    <div className="space-y-2 pt-3 border-t border-border">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Productos:</span>
                        <span className="font-semibold text-foreground">{view.items}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Total:</span>
                        <span className="font-bold text-primary">{money(view.total)}</span>
                      </div>
                      {view.since && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock size={12} />
                          <span>{elapsedLabel(view.since)}</span>
                        </div>
                      )}

                      <Button
                        size="sm"
                        className="w-full bg-rose-600 hover:bg-rose-700"
                        style={{ display: canCollect ? undefined : 'none' }}
                        disabled={closingId === view.table.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          void closeTable(view);
                        }}
                      >
                        <Receipt size={14} className="mr-1" />
                        {closingId === view.table.id ? 'Cobrando...' : 'Cobrar en efectivo'}
                      </Button>
                    </div>
                  )}

                  {!view.inactive && !view.occupied && (
                    <Button size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700">
                      <Plus size={14} className="mr-1" />
                      Abrir Mesa
                    </Button>
                  )}

                  {view.inactive && (
                    <p className="text-xs text-muted-foreground">Habilítala desde el lápiz para volver a usarla.</p>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showOrderModal} onOpenChange={setShowOrderModal}>
        <DialogContent className="w-full sm:w-[96vw] max-w-full sm:max-w-7xl max-h-[100vh] sm:max-h-[92vh] overflow-y-auto p-0 top-0 sm:top-[4%] translate-y-0 rounded-none sm:rounded-lg">
          <DialogHeader className="p-4 sm:p-6 pb-3 sm:pb-4">
            <DialogTitle className="flex items-center gap-2">
              <UtensilsCrossed className="text-primary" size={24} />
              {selectedView?.occupied ? `Mesa ${selectedTable?.number} · Agregar pedido` : `Abrir Mesa ${selectedTable?.number}`}
            </DialogTitle>
            <DialogDescription>Selecciona productos y envíalos a cocina o directo a la cuenta</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-6 sm:gap-8 px-4 sm:px-8 pb-8">
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                <Input
                  placeholder="Buscar producto o código..."
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  onKeyDown={handleBarcodeSearch}
                  className="pl-10 h-12 text-base"
                />
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                      activeCategory === cat ? 'bg-primary text-primary-foreground' : 'bg-accent text-muted-foreground hover:bg-accent/80'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[50vh] sm:max-h-[60vh] overflow-y-auto pr-1">
                {filteredProducts.map((product) => (
                  <Card
                    key={product.id}
                    className="p-5 border cursor-pointer hover:border-primary transition-colors min-h-[80px] outline-none focus:outline-none focus:ring-0"
                    onClick={() => addToCart(product)}
                  >
                    <div className="space-y-1">
                      <p className="text-base font-semibold text-foreground line-clamp-2">{product.name}</p>
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-sm text-muted-foreground">Stock: {product.stock}</span>
                        <span className="text-base font-bold text-primary">{money(product.price)}</span>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <Card className="p-4 border border-border">
                <div className="flex items-center gap-2 mb-3">
                  <ShoppingCart className="text-primary" size={20} />
                  <h3 className="font-bold">Pedido de Mesa {selectedTable?.number}</h3>
                  <Badge className="ml-auto bg-primary text-primary-foreground">{cartItemsCount} nuevos</Badge>
                </div>

                {selectedView && selectedView.items > 0 && (
                  <div className="mb-3 rounded-lg border border-border bg-muted/30 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Consumo actual</p>
                    <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto text-sm">
                      {selectedView.orders.flatMap((order) =>
                        order.items.map((item, index) => (
                          <li key={`${order.id}-${item.productId}-${index}`} className="flex justify-between gap-2">
                            <span className="text-foreground">
                              {item.quantity} × {item.productName}
                            </span>
                            <span className="text-muted-foreground">{money(item.unitPrice * item.quantity)}</span>
                          </li>
                        ))
                      )}
                    </ul>
                    <div className="mt-2 flex justify-between border-t border-border pt-2 text-sm font-semibold">
                      <span>Total actual</span>
                      <span>{money(selectedView.total)}</span>
                    </div>
                  </div>
                )}

                <Input
                  placeholder="Nombre del cliente (opcional)"
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  className="mb-3 h-9"
                />

                <Separator className="mb-3" />

                <div className="space-y-3 max-h-[42vh] overflow-y-auto mb-3">
                  {cart.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <ShoppingCart className="mx-auto mb-2 opacity-30" size={40} />
                      <p className="text-sm">Sin productos nuevos</p>
                      <p className="text-xs">Selecciona productos del menú</p>
                    </div>
                  ) : (
                    cart.map((item) => (
                      <div key={item.productId} className="bg-accent/50 rounded-lg p-3 border border-border">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">{item.name}</p>
                            <p className="text-xs text-muted-foreground">{money(item.price)} c/u</p>
                          </div>
                          <button onClick={() => removeFromCart(item.productId)} className="ml-1 p-1 hover:text-rose-500 text-muted-foreground">
                            <X size={14} />
                          </button>
                        </div>
                        <div className="flex items-center justify-between mb-1">
                          <button
                            onClick={() =>
                              setCart(cart.map((c) => (c.productId === item.productId ? { ...c, sendToKitchen: !c.sendToKitchen } : c)))
                            }
                            className={`text-[11px] px-2 py-1 rounded-md font-medium transition-colors ${
                              item.sendToKitchen ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {item.sendToKitchen ? '🍳 A cocina' : '📋 Solo cuenta'}
                          </button>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => updateQuantity(item.productId, -1)}
                              className="w-8 h-8 rounded border border-border flex items-center justify-center hover:bg-accent"
                            >
                              <Minus size={14} />
                            </button>
                            <span className="w-8 text-center text-base font-bold">{item.quantity}</span>
                            <button
                              onClick={() => updateQuantity(item.productId, 1)}
                              className="w-8 h-8 rounded border border-border flex items-center justify-center hover:bg-accent"
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                          <span className="text-sm font-bold text-primary">{money(item.price * item.quantity)}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <Separator className="mb-3" />

                <div className="flex justify-between font-bold text-base">
                  <span>Nuevo pedido</span>
                  <span className="text-primary">{money(cartTotal)}</span>
                </div>
                {selectedView && selectedView.total > 0 && (
                  <div className="mb-4 mt-1 flex justify-between text-xs text-muted-foreground">
                    <span>Total mesa (actual + nuevo)</span>
                    <span>{money(selectedView.total + cartTotal)}</span>
                  </div>
                )}
                {!(selectedView && selectedView.total > 0) && <div className="mb-4" />}

                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setShowOrderModal(false)} className="flex-1">
                    Cancelar
                  </Button>
                  <Button
                    onClick={() => void saveTableOrder()}
                    disabled={cart.length === 0 || savingOrder}
                    className="flex-1 bg-primary hover:bg-primary-hover"
                  >
                    {savingOrder ? 'Guardando...' : cart.some((i) => i.sendToKitchen) ? 'Enviar a Cocina' : 'Agregar a Cuenta'}
                  </Button>
                </div>
              </Card>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `Editar mesa ${editing.number}` : 'Nueva mesa'}</DialogTitle>
            <DialogDescription>Configura el número, la zona y la capacidad de la mesa.</DialogDescription>
          </DialogHeader>

          <form onSubmit={submitForm} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="table-number">Número de mesa</Label>
              <Input id="table-number" type="number" min={1} value={tableNumber} onChange={(event) => setTableNumber(event.target.value)} required />
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
            <Button type="submit" className="w-full" disabled={savingTable}>
              {savingTable ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear mesa'}
            </Button>
          </form>

          {!editing && (
            <div className="rounded-xl border border-border/60 p-3">
              <p className="text-xs font-semibold text-muted-foreground">Creación rápida de varias mesas</p>
              <div className="mt-2 flex items-center gap-2">
                <Input type="number" min={1} max={50} value={bulkCount} onChange={(event) => setBulkCount(event.target.value)} className="h-9" aria-label="Cantidad de mesas" />
                <Button variant="outline" onClick={() => void bulkCreate()} disabled={savingTable}>
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
