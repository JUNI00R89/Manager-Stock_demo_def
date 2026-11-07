import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Minus, Plus, Save, ShoppingCart, Trash2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../utils/notifications';
import { Layout } from '../components/Layout';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { dataService, type PaymentMethod } from '../services/dataService';
import { useBusiness } from '../context/BusinessContext';
import type { Product } from '../utils/mockData';

type CartItem = { product: Product; quantity: number };
const money = (v: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);

export function NewSale() {
  const navigate = useNavigate();
  const { config } = useBusiness();
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<CartItem[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [customer, setCustomer] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [taxEnabled, setTaxEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const taxRate = taxEnabled ? (config?.taxRate ?? dataService.defaultTaxRate) : 0;
  const subtotal = useMemo(() => items.reduce((sum, item) => sum + item.product.price * item.quantity, 0), [items]);
  const tax = subtotal * taxRate;
  const total = subtotal + tax;

  useEffect(() => { void dataService.getProducts().then(list => setProducts(list.filter(p => p.productType !== 'ingredient' && p.productType !== 'supplies'))).catch(error => toastError(error, 'No fue posible cargar el catálogo.')); }, []);
  const addItem = () => {
    const product = products.find(p => p.id === selectedProductId);
    const qty = Number(quantity);
    if (!product) { toast.error('Selecciona un producto.'); return; }
    if (!Number.isFinite(qty) || qty <= 0) { toast.error('La cantidad debe ser mayor que cero.'); return; }
    const current = items.find(item => item.product.id === product.id)?.quantity || 0;
    if (current + qty > product.stock) { toast.error(`Stock insuficiente. Disponible: ${Math.max(0, product.stock - current)}.`); return; }
    setItems(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      return existing ? prev.map(item => item.product.id === product.id ? { ...item, quantity: item.quantity + qty } : item) : [...prev, { product, quantity: qty }];
    });
    setSelectedProductId(''); setQuantity('1');
  };
  const updateQuantity = (productId: string, next: number) => {
    const current = items.find(item => item.product.id === productId);
    if (!current) return;
    if (next <= 0) { setItems(prev => prev.filter(item => item.product.id !== productId)); return; }
    if (next > current.product.stock) { toast.error(`Stock insuficiente. Disponible: ${current.product.stock}.`); return; }
    setItems(prev => prev.map(item => item.product.id === productId ? { ...item, quantity: next } : item));
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!items.length) { toast.error('Agrega al menos un producto a la venta.'); return; }
    setSaving(true);
    try {
      const sale = await dataService.createSale({ items: items.map(item => ({ productId: item.product.id, quantity: item.quantity })), customer: customer.trim() || 'Cliente general', paymentMethod, taxRate });
      toast.success('Venta registrada correctamente.', { description: `${sale.id} · ${money(sale.totalPrice)}` });
      navigate(`/sales/${sale.id}`);
    } catch (error) { toastError(error, 'No fue posible registrar la venta.'); }
    finally { setSaving(false); }
  };

  return <Layout><div className="mx-auto max-w-6xl space-y-6">
    <div className="flex items-center gap-3"><Button variant="outline" size="icon" onClick={() => navigate('/sales')} className="rounded-xl"><ArrowLeft className="h-4 w-4"/></Button><div><p className="text-sm font-semibold uppercase tracking-[.16em] text-orange-600">Punto de venta</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Registrar venta</h1><p className="mt-1 text-muted-foreground">El inventario se descuenta automáticamente al confirmar la operación.</p></div></div>
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_350px]">
      <div className="space-y-5"><Card className="rounded-2xl border-border/70 p-5 shadow-sm sm:p-6"><div className="mb-5 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600 dark:bg-orange-950/40"><ShoppingCart className="h-5 w-5"/></div><div><h2 className="font-semibold">Agregar productos</h2><p className="text-sm text-muted-foreground">Selecciona una referencia y la cantidad.</p></div></div><div className="grid gap-3 sm:grid-cols-[1fr_120px_auto]"><div className="space-y-2"><Label htmlFor="product">Producto</Label><select id="product" value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"><option value="">Selecciona un producto…</option>{products.map(product => <option key={product.id} value={product.id} disabled={product.stock <= 0}>{product.name} · {money(product.price)} · {`Stock ${product.stock}`}</option>)}</select></div><div className="space-y-2"><Label htmlFor="quantity">Cantidad</Label><Input id="quantity" type="number" min="1" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} className="h-11 rounded-xl"/></div><div className="flex items-end"><Button type="button" onClick={addItem} className="h-11 w-full rounded-xl bg-orange-600 text-white hover:bg-orange-700 sm:w-auto"><Plus className="mr-1 h-4 w-4"/>Agregar</Button></div></div></Card>
        <Card className="overflow-hidden rounded-2xl border-border/70 shadow-sm"><div className="border-b border-border/70 px-5 py-4"><h2 className="font-semibold">Detalle de la venta</h2><p className="mt-1 text-sm text-muted-foreground">{items.length} referencias · {items.reduce((s, i) => s + i.quantity, 0)} unidades</p></div>{items.length === 0 ? <div className="p-12 text-center"><ShoppingCart className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50"/><p className="font-medium">El carrito está vacío</p><p className="mt-1 text-sm text-muted-foreground">Agrega productos para calcular el total.</p></div> : <div className="divide-y divide-border/60">{items.map(({ product, quantity: qty }) => <div key={product.id} className="flex items-center gap-3 px-5 py-4"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"><ShoppingCart className="h-4 w-4"/></div><div className="min-w-0 flex-1"><p className="truncate font-medium">{product.name}</p><p className="mt-1 text-xs text-muted-foreground">{money(product.price)} por {product.unit || 'unidad'} · {`stock ${product.stock}`}</p></div><div className="flex items-center gap-1"><Button type="button" variant="outline" size="icon" onClick={() => updateQuantity(product.id, qty - 1)} className="h-8 w-8 rounded-lg"><Minus className="h-3 w-3"/></Button><span className="w-8 text-center text-sm font-semibold">{qty}</span><Button type="button" variant="outline" size="icon" onClick={() => updateQuantity(product.id, qty + 1)} className="h-8 w-8 rounded-lg"><Plus className="h-3 w-3"/></Button></div><div className="w-28 text-right"><p className="font-semibold">{money(product.price * qty)}</p></div><Button type="button" variant="ghost" size="icon" onClick={() => setItems(prev => prev.filter(item => item.product.id !== product.id))} className="text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4"/></Button></div>)}</div>}</Card>
      </div>
      <div className="space-y-5"><Card className="rounded-2xl border-border/70 p-5 shadow-sm"><div className="mb-5 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Wallet className="h-5 w-5"/></div><div><h2 className="font-semibold">Resumen y pago</h2><p className="text-sm text-muted-foreground">Verifica los datos antes de guardar.</p></div></div><div className="space-y-2"><Label htmlFor="customer">Cliente (opcional)</Label><Input id="customer" value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Cliente general" maxLength={120} className="h-11 rounded-xl"/></div><div className="mt-4 space-y-2"><Label htmlFor="payment">Método de pago</Label><select id="payment" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"><option value="cash">Efectivo</option><option value="card">Tarjeta</option><option value="digital">Billetera digital</option><option value="transfer">Transferencia</option><option value="split">Pago dividido</option></select></div><label className="mt-4 flex items-center gap-2 rounded-xl bg-muted/40 p-3 text-sm"><input type="checkbox" checked={taxEnabled} onChange={e => setTaxEnabled(e.target.checked)} className="h-4 w-4 accent-orange-600"/><span>Aplicar impuesto configurado ({Math.round((config?.taxRate ?? dataService.defaultTaxRate) * 100)}%)</span></label><div className="my-5 space-y-3 border-y border-border/70 py-5"><div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span><span>{money(subtotal)}</span></div><div className="flex justify-between text-sm"><span className="text-muted-foreground">Impuesto</span><span>{money(tax)}</span></div><div className="flex items-end justify-between gap-4 pt-2"><span className="font-semibold">Total a cobrar</span><span className="text-2xl font-bold tracking-tight text-orange-600">{money(total)}</span></div></div><p className="mb-4 text-xs leading-5 text-muted-foreground">Al confirmar, se registra una única transacción con todos sus productos, se guarda el detalle histórico de precios y se descuenta el stock en una operación atómica.</p><Button type="submit" disabled={saving || items.length === 0} className="h-12 w-full rounded-xl bg-orange-600 text-base font-semibold text-white hover:bg-orange-700"><Save className="mr-2 h-4 w-4"/>{saving ? 'Registrando venta…' : 'Confirmar venta'}</Button><Button type="button" variant="outline" onClick={() => navigate('/sales')} className="mt-2 w-full rounded-xl">Cancelar</Button></Card></div>
    </form>
  </div></Layout>;
}
