import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, Boxes, Edit3, Package, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Layout } from '../components/Layout';
import { ConfirmActionDialog } from '../components/ConfirmActionDialog';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { dataService } from '../services/dataService';
import { useBusiness } from '../context/BusinessContext';
import { useAuth } from '../context/AuthContext';
import type { Product } from '../utils/mockData';

const money = (value: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);

export function Products() {
  const navigate = useNavigate();
  const { isFoodBusiness } = useBusiness();
  const { user } = useAuth();
  const isCustomRole = Boolean(user?.customRoleId);
  const canCreateProduct = isCustomRole ? Boolean(user?.permissions?.includes('catalog.create')) : user?.role === 'owner' || user?.role === 'business_admin';
  const canEditProduct = isCustomRole ? Boolean(user?.permissions?.includes('catalog.edit')) : user?.role === 'owner' || user?.role === 'business_admin';
  const [products, setProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Todas');
  const [loading, setLoading] = useState(true);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);

  const load = async () => {
    try { setProducts(await dataService.getProducts()); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'No fue posible cargar los productos.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const businessProducts = useMemo(() => isFoodBusiness ? products.filter(product => product.productType !== 'ingredient') : products, [products, isFoodBusiness]);
  const categories = useMemo(() => ['Todas', ...Array.from(new Set(businessProducts.map(p => p.category))).sort((a, b) => a.localeCompare(b, 'es'))], [businessProducts]);
  const filteredProducts = useMemo(() => businessProducts.filter(product => {
    const term = searchTerm.toLocaleLowerCase('es');
    return (!term || `${product.name} ${product.sku} ${product.category}`.toLocaleLowerCase('es').includes(term)) && (selectedCategory === 'Todas' || product.category === selectedCategory);
  }), [businessProducts, searchTerm, selectedCategory]);
  const lowStock = businessProducts.filter(p => p.stock <= p.minStock).length;
  const inventoryValue = businessProducts.reduce((sum, p) => sum + p.stock * p.price, 0);

  const deleteProduct = (product: Product) => setProductToDelete(product);
  const confirmDeleteProduct = async () => {
    if (!productToDelete) return;
    try {
      await dataService.deleteProduct(productToDelete.id);
      setProducts(await dataService.getProducts());
      toast.success('Producto retirado del catálogo.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No fue posible retirar el producto.');
      throw error;
    }
  };

  return <Layout>
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-sm font-semibold uppercase tracking-[.16em] text-orange-600">Catálogo e inventario</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">Productos</h1><p className="mt-1 text-muted-foreground">Controla tus productos, existencias y precios desde un solo lugar.</p></div>
        {canCreateProduct && <Button onClick={() => navigate('/products/new')} className="h-11 bg-orange-600 text-white shadow-sm hover:bg-orange-700"><Plus className="mr-2 h-4 w-4"/>Nuevo producto</Button>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <Card className="min-w-0 rounded-2xl border-border/70 p-5 shadow-sm"><div className="flex items-center justify-between gap-2"><span className="text-sm text-muted-foreground">Productos activos</span><Package className="h-5 w-5 shrink-0 text-orange-600"/></div><p className="mt-3 text-3xl font-bold">{products.length}</p><p className="mt-1 text-xs text-muted-foreground">Referencias en el catálogo</p></Card>
        <Card className="min-w-0 rounded-2xl border-border/70 p-5 shadow-sm"><div className="flex items-center justify-between gap-2"><span className="text-sm text-muted-foreground">Inventario por debajo del mínimo</span><AlertTriangle className={`h-5 w-5 shrink-0 ${lowStock ? 'text-rose-500' : 'text-emerald-600'}`}/></div><p className={`mt-3 text-3xl font-bold ${lowStock ? 'text-rose-600' : 'text-emerald-600'}`}>{lowStock}</p><p className="mt-1 text-xs text-muted-foreground">Requieren revisión o reposición</p></Card>
        <Card className="col-span-2 min-w-0 rounded-2xl border-border/70 p-5 shadow-sm sm:col-span-1"><div className="flex items-center justify-between gap-2"><span className="text-sm text-muted-foreground">Valor de venta del stock</span><Boxes className="h-5 w-5 shrink-0 text-orange-600"/></div><p className="mt-3 text-2xl font-bold">{money(inventoryValue)}</p><p className="mt-1 text-xs text-muted-foreground">Estimado según precio de venta</p></Card>
      </div>

      <Card className="rounded-2xl border-border/70 p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/><Input className="h-11 rounded-xl pl-9" placeholder="Buscar producto, SKU o categoría…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/></div>
          <div className="flex gap-2 overflow-x-auto pb-1">{categories.map(category => <Button key={category} variant={selectedCategory === category ? 'default' : 'outline'} onClick={() => setSelectedCategory(category)} className={selectedCategory === category ? 'rounded-xl bg-orange-600 text-white hover:bg-orange-700' : 'rounded-xl'}>{category}</Button>)}</div>
        </div>
      </Card>

      {loading ? <Card className="rounded-2xl p-12 text-center text-muted-foreground">Cargando inventario…</Card> : filteredProducts.length === 0 ? <Card className="rounded-2xl border-dashed p-12 text-center"><Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50"/><h2 className="font-semibold">No hay productos para mostrar</h2><p className="mt-1 text-sm text-muted-foreground">Cambia la búsqueda o registra tu primer producto.</p>{canCreateProduct && <Button onClick={() => navigate('/products/new')} className="mt-4 bg-orange-600 hover:bg-orange-700">Agregar producto</Button>}</Card> :
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{filteredProducts.map(product => {
          const isLow = product.stock <= product.minStock;
          const ratio = product.minStock > 0 ? Math.min(100, product.stock / product.minStock * 100) : 100;
          return <Card key={product.id} className="group rounded-2xl border-border/70 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex items-start gap-3"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600 dark:bg-orange-950/40"><Package className="h-6 w-6"/></div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><h2 className="font-semibold leading-5">{product.name}</h2><Badge variant="outline" className={isLow ? 'shrink-0 border-rose-200 bg-rose-50 text-rose-700' : 'shrink-0 border-emerald-200 bg-emerald-50 text-emerald-700'}>{isLow ? 'Stock bajo' : 'Disponible'}</Badge></div><p className="mt-1 text-xs text-muted-foreground">SKU {product.sku}</p></div></div>
            <div className="mt-5 flex items-end justify-between gap-3"><div><p className="text-xs text-muted-foreground">Precio de venta</p><p className="mt-1 text-2xl font-bold tracking-tight">{money(product.price)}</p></div><Badge variant="secondary" className="max-w-[50%] truncate rounded-lg">{product.category}</Badge></div>
            <div className="mt-5"><div className="mb-2 flex justify-between text-sm"><span className="text-muted-foreground">Existencias</span><span className={`font-semibold ${isLow ? 'text-rose-600' : ''}`}>{product.stock} <span className="font-normal text-muted-foreground">{product.stock === 1 ? 'unidad' : 'unidades'}</span></span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className={`bar-fill h-full rounded-full transition-all ${isLow ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${ratio}%` }}/></div><p className="mt-2 text-xs text-muted-foreground">Mínimo recomendado: {product.minStock}</p></div>
            {canEditProduct && <div className="mt-5 flex gap-2 border-t border-border/60 pt-4"><Button variant="outline" onClick={() => navigate(`/products/${product.id}/edit`)} className="flex-1 rounded-xl"><Edit3 className="mr-2 h-4 w-4"/>Editar</Button><Button variant="outline" onClick={() => void deleteProduct(product)} aria-label={`Retirar ${product.name}`} className="rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4"/></Button></div>}
          </Card>;
        })}</div>}
    </div>
    <ConfirmActionDialog
      open={Boolean(productToDelete)}
      onOpenChange={open => { if (!open) setProductToDelete(null); }}
      title="Retirar producto del catálogo"
      description={productToDelete ? `¿Deseas retirar “${productToDelete.name}” del catálogo? Las ventas anteriores conservarán los datos históricos del producto.` : ''}
      confirmLabel="Retirar producto"
      destructive
      onConfirm={confirmDeleteProduct}
    />
  </Layout>;
}
