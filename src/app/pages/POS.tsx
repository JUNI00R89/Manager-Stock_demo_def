import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import {
  Search, Plus, Minus, Trash2, ShoppingCart, CreditCard, Banknote, Package,
  Smartphone, Receipt, X, Check, Barcode, ScanLine, Users, Percent,
  Lock, Unlock, DollarSign, Split, Printer, MessageCircle, Mail
} from 'lucide-react';
import { findProductByBarcode, type Product } from '../utils/mockData';
import { dataService, type CashSessionRecord, type PaymentPartRecord } from '../services/dataService';
import { useAuth } from '../context/AuthContext';
import { useBusiness } from '../context/BusinessContext';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '../components/ui/dialog';
import { BarcodeScanner } from '../components/BarcodeScanner';

const money = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);

interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  sku: string;
  discount: number; // percentage 0-100
}

interface SplitPayment {
  method: 'cash' | 'card' | 'digital';
  amount: number;
}

type PosMode = 'open' | 'closed';

export function POS() {
  const { config } = useBusiness();
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'digital' | 'split' | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [cashReceived, setCashReceived] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [globalDiscount, setGlobalDiscount] = useState(0);
  const [splitPayments, setSplitPayments] = useState<SplitPayment[]>([]);
  const [posMode, setPosMode] = useState<PosMode>('open');
  const [openingAmount, setOpeningAmount] = useState('');
  const [showOpenTurn, setShowOpenTurn] = useState(true);
  const [showCloseTurn, setShowCloseTurn] = useState(false);
  const [closingAmount, setClosingAmount] = useState('');
  const [cashSession, setCashSession] = useState<CashSessionRecord | null>(null);
  const [savingSession, setSavingSession] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState<string | null>(null);
  const [discountInput, setDiscountInput] = useState('');
  const [showGlobalDiscount, setShowGlobalDiscount] = useState(false);
  const [activeCategory, setActiveCategory] = useState('Todos');

  const TAX_RATE = config?.taxRate ?? dataService.defaultTaxRate;

  useEffect(() => {
    let active = true;
    void dataService.getProducts().then((list) => {
      if (!active) return;
      setProducts(list.filter(p => p.productType !== 'ingredient' && p.productType !== 'supplies'));
    }).catch(error => toast.error(error instanceof Error ? error.message : 'No se pudo cargar el catálogo.'));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void dataService.getCurrentCashSession().then(session => {
      if (!active) return;
      setCashSession(session);
      setShowOpenTurn(!session || session.status !== 'open');
    }).catch(error => toast.error(error instanceof Error ? error.message : 'No se pudo consultar el turno de caja.'));
    return () => { active = false; };
  }, []);

  const handleOpenTurn = async () => {
    const amount = Number(openingAmount);
    if (!Number.isFinite(amount) || amount < 0) { toast.error('Ingresa un monto inicial válido.'); return; }
    setSavingSession(true);
    try {
      const session = await dataService.openCashSession(amount, user?.name || 'Usuario local');
      setCashSession(session); setShowOpenTurn(false); setPosMode('open');
      toast.success('Turno de caja abierto.', { description: `Base inicial: ${money(amount)}` });
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo abrir el turno.'); }
    finally { setSavingSession(false); }
  };

  const handleCloseTurn = async () => {
    if (!cashSession) { toast.error('No hay un turno abierto.'); return; }
    if (cart.length) { toast.error('Termina o vacía la venta actual antes de cerrar caja.'); return; }
    const amount = Number(closingAmount);
    if (!Number.isFinite(amount) || amount < 0) { toast.error('Ingresa el efectivo contado en caja.'); return; }
    setSavingSession(true);
    try {
      const result = await dataService.closeCashSession(cashSession.id, amount);
      toast.success('Turno de caja cerrado.', { description: `Esperado: ${money(result.expectedAmount || 0)} · Diferencia: ${money(result.difference || 0)}` });
      setCashSession(null); setShowCloseTurn(false); setShowOpenTurn(true); setOpeningAmount(''); setClosingAmount(''); setPosMode('closed'); clearCart();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo cerrar caja.'); }
    finally { setSavingSession(false); }
  };

  const categories = ['Todos', ...Array.from(new Set(products.map(p => p.category)))];

  const filteredProducts = products.filter(product => {
    const matchSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
      product.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchCat = activeCategory === 'Todos' || product.category === activeCategory;
    return matchSearch && matchCat;
  });

  const addToCart = (product: Product, quantity = 1) => {
    const existing = cart.find(item => item.productId === product.id);
    if (existing) {
      if (existing.quantity + quantity > product.stock) {
        toast.error('Sin stock suficiente');
        return;
      }
      setCart(cart.map(item =>
        item.productId === product.id
          ? { ...item, quantity: item.quantity + quantity }
          : item
      ));
    } else {
      if (product.stock < 1) { toast.error('Producto sin stock'); return; }
      setCart([...cart, { productId: product.id, name: product.name, price: product.price, quantity, sku: product.sku, discount: 0 }]);
    }
  };

  const updateQuantity = (productId: string, delta: number) => {
    const product = products.find(p => p.id === productId);
    const cartItem = cart.find(item => item.productId === productId);
    if (!product || !cartItem) return;
    const newQty = cartItem.quantity + delta;
    if (newQty < 1) { removeFromCart(productId); return; }
    if (newQty > product.stock) { toast.error('Sin stock suficiente'); return; }
    setCart(cart.map(item => item.productId === productId ? { ...item, quantity: newQty } : item));
  };

  const removeFromCart = (productId: string) => setCart(cart.filter(item => item.productId !== productId));
  const clearCart = () => { setCart([]); setPaymentMethod(null); setCashReceived(''); setCustomerName(''); setGlobalDiscount(0); setSplitPayments([]); };

  const setItemDiscount = (productId: string, discount: number) => {
    setCart(cart.map(item => item.productId === productId ? { ...item, discount: Math.min(100, Math.max(0, discount)) } : item));
  };

  const itemSubtotal = (item: CartItem) => item.price * item.quantity * (1 - item.discount / 100);
  const subtotal = cart.reduce((sum, item) => sum + itemSubtotal(item), 0);
  const discountAmount = subtotal * (globalDiscount / 100);
  const afterDiscount = subtotal - discountAmount;
  const tax = afterDiscount * TAX_RATE;
  const total = afterDiscount + tax;

  const splitTotal = splitPayments.reduce((sum, p) => sum + p.amount, 0);
  const splitRemaining = total - splitTotal;

  const handlePayment = async () => {
    if (!paymentMethod) { toast.error('Selecciona un método de pago'); return; }
    if (cart.length === 0) { toast.error('El carrito está vacío'); return; }
    if (paymentMethod === 'cash') {
      const received = parseFloat(cashReceived);
      if (isNaN(received) || received < total) { toast.error('Monto recibido insuficiente'); return; }
    }
    if (paymentMethod === 'split' && Math.abs(splitTotal - total) > 0.01) {
      toast.error('El pago dividido no cubre el total');
      return;
    }

    setProcessingPayment(true);
    try {
      const sale = await dataService.createSale({
        items: cart.map(item => ({ productId: item.productId, quantity: item.quantity, discountPercent: item.discount })),
        customer: customerName || 'Cliente general',
        paymentMethod,
        globalDiscountPercent: globalDiscount,
        taxRate: TAX_RATE,
        cashSessionId: cashSession?.id,
        payments: paymentMethod === 'split' ? splitPayments : undefined,
      });
      const refreshedProducts = await dataService.getProducts();
      setProducts(refreshedProducts.filter(p => p.productType !== 'ingredient' && p.productType !== 'supplies'));
      const receipt = {
        id: sale.id,
        invoiceNumber: sale.id,
        date: sale.date,
        customer: customerName || 'Cliente general',
        items: cart,
        subtotal, discountAmount, globalDiscount, afterDiscount, tax: sale.tax, total: sale.totalPrice,
        paymentMethod,
        splitPayments: paymentMethod === 'split' ? splitPayments : [],
        cashReceived: paymentMethod === 'cash' ? parseFloat(cashReceived) : total,
        change: paymentMethod === 'cash' ? parseFloat(cashReceived) - total : 0,
      };
      setReceiptData(receipt);
      setShowReceipt(true);
      toast.success('Venta guardada correctamente', { description: `${sale.id} · ${money(sale.totalPrice)}` });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No fue posible guardar la venta.');
    } finally {
      setProcessingPayment(false);
    }
  };

  const handleNewSale = () => {
    setShowReceipt(false);
    clearCart();
    setReceiptData(null);
  };

  const handleBarcodeScanned = (code: string, product: Product | null) => {
    if (product) addToCart(product);
  };

  const handleManualBarcode = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const code = searchTerm.trim();
      const product = products.find(p => p.sku.toLowerCase() === code.toLowerCase() || p.codigosBarras?.includes(code)) || findProductByBarcode(code);
      if (product) {
        addToCart(product);
        setSearchTerm('');
        toast.success(`${product.name} añadido por código de barras`);
      }
    }
  };

  // Open turn dialog
  if (showOpenTurn) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Card className="w-full max-w-md p-8 border border-border text-center space-y-6">
            <div className="w-16 h-16 bg-orange-100 dark:bg-orange-950/40 rounded-2xl flex items-center justify-center mx-auto">
              <Lock className="text-orange-500" size={32} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Apertura de turno</h2>
              <p className="text-sm text-muted-foreground mt-1">Ingresa el monto inicial en caja para abrir el turno</p>
            </div>
            <div className="text-left space-y-2">
              <label className="text-sm font-medium text-foreground">Monto inicial en caja</label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                <Input
                  type="number"
                  placeholder="2,000.00"
                  value={openingAmount}
                  onChange={e => setOpeningAmount(e.target.value)}
                  className="pl-8 h-12 text-lg"
                  autoFocus
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {['500', '1000', '2000', '5000'].map(amt => (
                <button key={amt} onClick={() => setOpeningAmount(amt)} className="py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent transition-colors">
                  {money(parseInt(amt))}
                </button>
              ))}
            </div>
            <Button
              onClick={() => void handleOpenTurn()}
              disabled={savingSession}
              className="w-full h-12 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white"
            >
              <Unlock size={18} className="mr-2" />
              {savingSession ? 'Abriendo caja…' : 'Abrir turno'}
            </Button>
          </Card>
        </div>
      </Layout>
    );
  }

  if (showCloseTurn && cashSession) {
    return <Layout><div className="flex min-h-[60vh] items-center justify-center"><Card className="w-full max-w-xl rounded-2xl border-border p-7 shadow-sm sm:p-9"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"><Lock size={27}/></div><div className="mt-4 text-center"><p className="text-xs font-semibold uppercase tracking-[.16em] text-orange-600">Cierre de caja</p><h1 className="mt-1 text-2xl font-bold">Contar efectivo del turno</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">El sistema calculará el efectivo esperado con la base inicial y las ventas en efectivo vinculadas a este turno. El registro del cierre quedará guardado en la base de datos.</p></div><div className="mt-6 grid grid-cols-2 gap-3"><div className="rounded-xl bg-muted/40 p-4"><p className="text-xs text-muted-foreground">Base inicial</p><p className="mt-1 text-xl font-bold">{money(cashSession.openingAmount)}</p></div><div className="rounded-xl bg-muted/40 p-4"><p className="text-xs text-muted-foreground">Turno</p><p className="mt-1 truncate text-sm font-bold">{cashSession.id}</p></div></div><div className="mt-5 space-y-2"><label htmlFor="closingAmount" className="text-sm font-medium">Efectivo contado (COP)</label><Input id="closingAmount" type="number" min="0" step="1" autoFocus value={closingAmount} onChange={e => setClosingAmount(e.target.value)} placeholder="Ej. 185000" className="h-12 rounded-xl text-lg"/></div><div className="mt-5 flex gap-3"><Button type="button" variant="outline" disabled={savingSession} onClick={() => setShowCloseTurn(false)} className="flex-1 rounded-xl">Volver a la caja</Button><Button type="button" disabled={savingSession} onClick={() => void handleCloseTurn()} className="flex-1 rounded-xl bg-orange-600 text-white hover:bg-orange-700">{savingSession ? 'Cerrando…' : 'Confirmar cierre'}</Button></div></Card></div></Layout>;
  }

  return (
    <Layout>
      {/* Barcode Scanner fullscreen */}
      {showScanner && (
        <BarcodeScanner
          products={products}
          onScan={handleBarcodeScanned}
          onSell={p => { addToCart(p); }}
          mode="continuous"
          context="pos"
          onClose={() => setShowScanner(false)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ── Products panel ── */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-bold text-foreground">Punto de Venta</h2>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowScanner(true)}
                className="justify-center border-orange-300 text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-950/30"
              >
                <ScanLine size={16} className="mr-1.5" />
                Escanear
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { if (cart.length) { toast.error('Termina o vacía la venta actual antes de cerrar caja.'); return; } setClosingAmount(''); setShowCloseTurn(true); }}
                className="justify-center border-gray-300 text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <Lock size={16} className="mr-1.5" />
                Cerrar turno
              </Button>
            </div>
          </div>

          {/* Search + categories */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
              <Barcode className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
              <Input
                placeholder="Buscar producto, SKU o escanear código..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                onKeyDown={handleManualBarcode}
                className="pl-10 pr-10 h-11"
              />
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                    activeCategory === cat
                      ? 'bg-orange-500 text-white'
                      : 'bg-accent text-muted-foreground hover:bg-orange-50 dark:hover:bg-orange-950/30 hover:text-orange-600'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Product grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[520px] overflow-y-auto pr-1">
            {filteredProducts.length === 0 ? (
              <div className="col-span-2 py-12 text-center text-muted-foreground sm:col-span-3">
                <Package size={40} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">No se encontraron productos</p>
              </div>
            ) : (
              filteredProducts.map(product => {
                const inCart = cart.find(item => item.productId === product.id);
                const outOfStock = product.stock < 1;
                return (
                  <Card
                    key={product.id}
                    className={`p-4 border cursor-pointer transition-all select-none ${
                      outOfStock ? 'border-border opacity-50 cursor-not-allowed'
                      : inCart ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary'
                    }`}
                    onClick={() => !outOfStock && addToCart(product)}
                  >
                    <div className="space-y-2">
                      <div className="flex justify-between items-start">
                        <h3 className="text-sm font-semibold text-foreground line-clamp-2 leading-tight">{product.name}</h3>
                        {inCart && (
                          <span className="ml-1 w-5 h-5 bg-primary text-white text-[10px] rounded-full flex items-center justify-center font-bold flex-shrink-0">
                            {inCart.quantity}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">SKU: {product.sku}</p>
                      <div className="flex items-end justify-between">
                        <Badge variant="outline" className="text-[10px] border-orange-200 text-orange-700 dark:border-orange-800 dark:text-orange-400">
                          {product.category}
                        </Badge>
                        <span className="text-base font-bold text-orange-600">{money(product.price)}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className={`font-medium ${product.stock < product.minStock ? 'text-amber-500' : 'text-muted-foreground'}`}>
                          {`Stock: ${product.stock}`}
                        </span>
                        {outOfStock && <span className="text-red-500 font-semibold">Sin stock</span>}
                      </div>
                    </div>
                  </Card>
                );
              })
            )}
          </div>
        </div>

        {/* ── Cart panel ── */}
        <div className="space-y-4">
          <Card className="p-5 border border-border sticky top-4">
            <div className="flex items-center gap-2 mb-4">
              <ShoppingCart className="text-orange-600" size={20} />
              <h3 className="font-bold text-foreground">Carrito</h3>
              <Badge className="ml-auto bg-orange-500 text-white text-xs">
                {cart.reduce((s, i) => s + i.quantity, 0)} items
              </Badge>
            </div>

            {/* Customer */}
            <div className="relative mb-3">
              <Users className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
              <Input
                placeholder="Cliente (opcional)"
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                className="pl-8 h-9 text-sm"
              />
            </div>

            <Separator className="mb-3" />

            {/* Cart items */}
            <div className="space-y-2 max-h-[280px] overflow-y-auto mb-3">
              {cart.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ShoppingCart className="mx-auto mb-2 opacity-30" size={40} />
                  <p className="text-sm">Carrito vacío</p>
                  <p className="text-xs mt-1 text-muted-foreground">Haz clic en un producto o escanea un código</p>
                </div>
              ) : (
                cart.map(item => (
                  <div key={item.productId} className="bg-accent/50 rounded-lg p-3 border border-border">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">{item.name}</p>
                        <p className="text-[10px] text-muted-foreground">{item.sku}</p>
                      </div>
                      <button onClick={() => removeFromCart(item.productId)} className="ml-1 p-1 hover:text-red-500 text-muted-foreground">
                        <X size={14} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <button onClick={() => updateQuantity(item.productId, -1)} className="w-6 h-6 rounded border border-border flex items-center justify-center hover:bg-orange-50 dark:hover:bg-orange-950/30 text-foreground"><Minus size={12} /></button>
                        <span className="w-7 text-center text-sm font-bold text-foreground">{item.quantity}</span>
                        <button onClick={() => updateQuantity(item.productId, 1)} className="w-6 h-6 rounded border border-border flex items-center justify-center hover:bg-orange-50 dark:hover:bg-orange-950/30 text-foreground"><Plus size={12} /></button>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Per-item discount */}
                        {editingDiscount === item.productId ? (
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              value={discountInput}
                              onChange={e => setDiscountInput(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  setItemDiscount(item.productId, parseFloat(discountInput) || 0);
                                  setEditingDiscount(null);
                                }
                                if (e.key === 'Escape') setEditingDiscount(null);
                              }}
                              className="w-14 h-6 text-xs text-center p-1"
                              autoFocus
                              min={0} max={100}
                              placeholder="0"
                            />
                            <span className="text-xs text-muted-foreground">%</span>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingDiscount(item.productId); setDiscountInput(String(item.discount)); }}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 hover:bg-amber-200"
                          >
                            {item.discount > 0 ? `-${item.discount}%` : 'Dto.'}
                          </button>
                        )}
                        <span className="text-sm font-bold text-orange-600">{money(itemSubtotal(item))}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {cart.length > 0 && (
              <Button variant="outline" size="sm" onClick={clearCart} className="w-full mb-3 text-xs border-red-200 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 h-8">
                <Trash2 size={12} className="mr-1" /> Vaciar carrito
              </Button>
            )}

            <Separator className="mb-3" />

            {/* Totals */}
            <div className="space-y-1.5 mb-3 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span><span>{money(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <button
                  onClick={() => setShowGlobalDiscount(v => !v)}
                  className="flex items-center gap-1 text-amber-600 text-xs hover:underline"
                >
                  <Percent size={12} />
                  {globalDiscount > 0 ? `Descuento (${globalDiscount}%)` : 'Agregar descuento'}
                </button>
                <span className="text-amber-600">-{money(discountAmount)}</span>
              </div>
              {showGlobalDiscount && (
                <div className="flex gap-1.5 flex-wrap">
                  {[5, 10, 15, 20].map(d => (
                    <button key={d} onClick={() => { setGlobalDiscount(d); setShowGlobalDiscount(false); }} className={`px-2 py-1 text-xs rounded-md border ${globalDiscount === d ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/30 text-orange-600' : 'border-border text-muted-foreground hover:bg-accent'}`}>
                      {d}%
                    </button>
                  ))}
                  <button onClick={() => { setGlobalDiscount(0); setShowGlobalDiscount(false); }} className="px-2 py-1 text-xs rounded-md border border-border text-muted-foreground hover:bg-accent">
                    Sin dto.
                  </button>
                </div>
              )}
              <div className="flex justify-between text-muted-foreground">
                <span>IVA ({(TAX_RATE * 100).toFixed(0)}%)</span><span>{money(tax)}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-bold text-base">
                <span className="text-foreground">Total</span>
                <span className="text-orange-600">{money(total)}</span>
              </div>
            </div>

            <Separator className="mb-3" />

            {/* Payment method */}
            <div className="space-y-2 mb-4">
              <p className="text-xs font-semibold text-foreground">Método de pago</p>
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  { id: 'cash', icon: Banknote, label: 'Efectivo', color: 'bg-green-600 hover:bg-green-700' },
                  { id: 'card', icon: CreditCard, label: 'Tarjeta', color: 'bg-blue-600 hover:bg-blue-700' },
                  { id: 'digital', icon: Smartphone, label: 'Digital', color: 'bg-purple-600 hover:bg-purple-700' },
                  { id: 'split', icon: Split, label: 'Dividido', color: 'bg-orange-600 hover:bg-orange-700' },
                ] as const).map(({ id, icon: Icon, label, color }) => (
                  <Button
                    key={id}
                    size="sm"
                    variant={paymentMethod === id ? 'default' : 'outline'}
                    onClick={() => { setPaymentMethod(id); }}
                    className={`h-9 text-xs ${paymentMethod === id ? color + ' text-white' : 'border-border'}`}
                  >
                    <Icon size={14} className="mr-1" /> {label}
                  </Button>
                ))}
              </div>

              {paymentMethod === 'cash' && (
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Efectivo recibido</label>
                  <Input type="number" placeholder="0.00" value={cashReceived} onChange={e => setCashReceived(e.target.value)} className="h-10" />
                  {cashReceived && parseFloat(cashReceived) >= total && (
                    <div className="text-xs bg-green-50 dark:bg-green-950/30 p-2 rounded border border-green-200 dark:border-green-800 flex justify-between">
                      <span className="text-muted-foreground">Cambio:</span>
                      <span className="font-bold text-green-600">{money(parseFloat(cashReceived) - total)}</span>
                    </div>
                  )}
                </div>
              )}

              {paymentMethod === 'split' && (
                <div className="space-y-2 bg-accent/50 rounded-lg p-3">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Pagado: {money(splitTotal)}</span>
                    <span className={splitRemaining > 0.01 ? 'text-red-500' : 'text-green-500'}>
                      Restante: {money(Math.max(0, splitRemaining))}
                    </span>
                  </div>
                  {splitPayments.map((sp, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="capitalize text-foreground w-16">{sp.method === 'cash' ? 'Efectivo' : sp.method === 'card' ? 'Tarjeta' : 'Digital'}</span>
                      <span className="font-semibold text-foreground">{money(sp.amount)}</span>
                      <button onClick={() => setSplitPayments(splitPayments.filter((_, j) => j !== i))} className="ml-auto text-red-400 hover:text-red-600"><X size={12} /></button>
                    </div>
                  ))}
                  {splitRemaining > 0.01 && (
                    <div className="flex gap-1">
                      {(['cash', 'card', 'digital'] as const).map(m => (
                        <button key={m} onClick={() => setSplitPayments([...splitPayments, { method: m, amount: splitRemaining }])} className="flex-1 text-[10px] py-1 rounded bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 hover:bg-orange-200 font-medium">
                          + {m === 'cash' ? 'Efect.' : m === 'card' ? 'Tarj.' : 'Dig.'}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <Button
              onClick={handlePayment}
              disabled={cart.length === 0 || !paymentMethod || processingPayment}
              className="w-full h-12 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:opacity-40 text-white text-base font-semibold"
            >
              <Check size={20} className="mr-2" />
              {processingPayment ? 'Guardando venta…' : `Cobrar ${money(total)}`}
            </Button>
          </Card>
        </div>
      </div>

      {/* Receipt dialog */}
      <Dialog open={showReceipt} onOpenChange={setShowReceipt}>
        <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <Check size={20} /> Venta completada
            </DialogTitle>
            <DialogDescription>Recibo generado correctamente</DialogDescription>
          </DialogHeader>

          {receiptData && (
            <div className="space-y-4">
              <div className="border-2 border-dashed border-border rounded-xl p-5 bg-white dark:bg-card font-mono text-sm">
                <div className="text-center mb-3">
                  <p className="font-bold text-base text-foreground">{config?.name || 'Manager Stock Pro'}</p>
                  <p className="text-xs text-muted-foreground">{new Date(receiptData.date).toLocaleString('es-CO')}</p>
                  <p className="text-xs text-muted-foreground">Factura: {receiptData.invoiceNumber}</p>
                  {receiptData.customer !== 'Cliente general' && (
                    <p className="text-xs font-medium text-foreground mt-1">Cliente: {receiptData.customer}</p>
                  )}
                </div>

                <Separator className="my-3" />

                <div className="space-y-1.5 mb-3">
                  {receiptData.items.map((item: CartItem) => (
                    <div key={item.productId}>
                      <div className="flex justify-between text-xs">
                        <span className="text-foreground truncate mr-2">{item.name}</span>
                        <span className="text-foreground flex-shrink-0">{money(itemSubtotal(item))}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {item.quantity} × {money(item.price)}
                        {item.discount > 0 && ` (-${item.discount}%)`}
                      </p>
                    </div>
                  ))}
                </div>

                <Separator className="my-2" />

                <div className="space-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="text-foreground">{money(receiptData.subtotal)}</span></div>
                  {receiptData.discountAmount > 0 && <div className="flex justify-between text-amber-600"><span>Descuento ({receiptData.globalDiscount}%)</span><span>-{money(receiptData.discountAmount)}</span></div>}
                  <div className="flex justify-between"><span className="text-muted-foreground">IVA</span><span className="text-foreground">{money(receiptData.tax)}</span></div>
                  <Separator className="my-1" />
                  <div className="flex justify-between font-bold text-base"><span className="text-foreground">Total</span><span className="text-orange-600">{money(receiptData.total)}</span></div>
                  {receiptData.paymentMethod === 'cash' && (
                    <>
                      <div className="flex justify-between"><span className="text-muted-foreground">Recibido</span><span className="text-foreground">{money(receiptData.cashReceived)}</span></div>
                      <div className="flex justify-between text-green-600 font-semibold"><span>Cambio</span><span>{money(receiptData.change)}</span></div>
                    </>
                  )}
                </div>

                <div className="text-center mt-4 text-[10px] text-muted-foreground">
                  <p>¡Gracias por su compra!</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => window.print()} className="border-border text-foreground text-xs">
                  <Printer size={14} className="mr-1" /> Imprimir
                </Button>
                <Button variant="outline" onClick={() => toast.info('Enviando por WhatsApp...')} className="border-green-200 text-green-700 dark:border-green-800 dark:text-green-400 text-xs">
                  <MessageCircle size={14} className="mr-1" /> WhatsApp
                </Button>
                <Button variant="outline" onClick={() => toast.info('Enviando por email...')} className="border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-400 text-xs col-span-2">
                  <Mail size={14} className="mr-1" /> Enviar por correo
                </Button>
              </div>

              <Button onClick={handleNewSale} className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white">
                Nueva venta
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
