import { useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, ChefHat, Info, Package, Search, UtensilsCrossed } from 'lucide-react';
import { Link } from 'react-router';
import { Layout } from '../../components/Layout';
import { StaffSwitcher } from '../../components/restaurant/StaffSwitcher';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Switch } from '../../components/ui/switch';
import { useAuth } from '../../context/AuthContext';
import { useBusiness } from '../../context/BusinessContext';
import { useRestaurantScope } from '../../utils/restaurantScope';
import { useRestaurantCatalog } from '../../utils/restaurantCatalogStore';
import { formatMoney, normalizeText } from '../../utils/restaurantFormat';

type CatalogTab = 'productos' | 'ingredientes';
type ActiveFilter = 'todos' | 'activos';

export function Catalog() {
  const { user } = useAuth();
  const { config } = useBusiness();
  const scope = useRestaurantScope();
  const { products, loading, error, setActive, setDirectSale } = useRestaurantCatalog(scope);
  const [tab, setTab] = useState<CatalogTab>('productos');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ActiveFilter>('todos');

  const saleProducts = useMemo(() => products.filter(product => product.isSaleItem), [products]);
  const ingredients = useMemo(() => products.filter(product => !product.isSaleItem), [products]);
  const base = tab === 'productos' ? saleProducts : ingredients;
  const term = normalizeText(search.trim());
  const visible = base.filter(product => {
    if (filter === 'activos' && !product.active) return false;
    if (!term) return true;
    return normalizeText(`${product.name} ${product.category} ${product.description}`).includes(term);
  });

  const activeCount = base.filter(product => product.active).length;
  const directCount = saleProducts.filter(product => product.active && product.directSale).length;

  return (
    <Layout>
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Administración · Catálogo</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Catálogo del restaurante
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Activa productos y define cuáles se entregan directo, sin pasar por cocina.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StaffSwitcher scope={scope} role="admin" currentUserName={user?.name || ''} />
          <Button variant="outline" className="h-11" asChild>
            <Link to="/products">
              <Package size={17} /> Editar productos
            </Link>
          </Button>
        </div>
      </header>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <SummaryCard
          icon={<Package size={20} />}
          label="Productos de venta"
          value={saleProducts.length}
          detail={`${activeCount} activos en la pestaña actual`}
        />
        <SummaryCard
          icon={<UtensilsCrossed size={20} />}
          label="Venta directa"
          value={directCount}
          detail="No aparecen en cocina"
        />
        <SummaryCard
          icon={<BookOpen size={20} />}
          label="Ingredientes"
          value={ingredients.length}
          detail="Recetas: segunda etapa"
        />
      </div>

      {error && (
        <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="mt-5 rounded-2xl border border-border bg-card p-3 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex rounded-xl bg-muted p-1">
            <button
              type="button"
              onClick={() => {
                setTab('productos');
                setFilter('todos');
              }}
              className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === 'productos' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <UtensilsCrossed size={17} /> Productos{' '}
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                {saleProducts.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('ingredientes');
                setFilter('todos');
              }}
              className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === 'ingredientes' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <ChefHat size={17} /> Ingredientes{' '}
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {ingredients.length}
              </span>
            </button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex rounded-xl border border-border p-1">
              {(['todos', 'activos'] as ActiveFilter[]).map(item => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setFilter(item)}
                  className={`min-h-11 rounded-xl px-3 text-xs font-semibold capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${filter === item ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="relative sm:w-72">
              <Search
                size={17}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Buscar producto"
                className="h-11 pl-9"
                aria-label="Buscar en el catálogo"
              />
            </div>
          </div>
        </div>
      </div>

      {tab === 'productos' && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-sky-500/25 bg-sky-500/5 p-3 text-sm text-sky-800 dark:text-sky-200">
          <Info size={18} className="mt-0.5 shrink-0" />
          <p>
            Un producto de <strong>venta directa</strong> no se envía a cocina. Al crear un pedido solo con estos
            productos, queda listo para llevar de inmediato. Un pedido mixto muestra en cocina únicamente los productos
            que sí se preparan.
          </p>
        </div>
      )}

      {loading ? (
        <div className="mt-4 space-y-2">
          {[1, 2, 3, 4].map(item => (
            <div key={item} className="h-24 animate-pulse rounded-2xl border border-border bg-muted/50" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-border p-10 text-center">
          <Search size={28} className="mx-auto text-muted-foreground" />
          <p className="mt-3 font-semibold text-foreground">No hay productos en esta vista</p>
          <p className="mt-1 text-sm text-muted-foreground">Cambia el filtro o busca otro término.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-2.5">
          {visible.map(product => (
            <article key={product.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold text-foreground">{product.name}</h2>
                    <Badge variant="outline">{product.category || 'Otros'}</Badge>
                    {product.directSale && product.isSaleItem && (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      >
                        Venta directa
                      </Badge>
                    )}
                    {!product.active && (
                      <Badge
                        variant="outline"
                        className="border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                      >
                        Inactivo
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{product.description || 'Sin descripción.'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatMoney(product.price, config?.currency)} · Stock {product.stock} {product.unit || 'unidad'} ·
                    SKU {product.sku || '—'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
                    <Switch
                      checked={product.active}
                      onCheckedChange={checked => setActive(product.id, checked)}
                      aria-label={`Activar ${product.name}`}
                    />
                    {product.active ? 'Activo' : 'Inactivo'}
                  </label>
                  {product.isSaleItem && (
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
                      <Switch
                        checked={product.directSale}
                        onCheckedChange={checked => setDirectSale(product.id, checked)}
                        aria-label={`Marcar ${product.name} como venta directa`}
                      />
                      Venta directa
                    </label>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {tab === 'ingredientes' && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
          <Info size={18} className="mt-0.5 shrink-0" />
          <p>
            Los ingredientes y las recetas se conectarán en la segunda etapa. Por ahora puedes revisar existencias y
            abrir el editor de productos. Los ingredientes nunca se venden directamente.
          </p>
        </div>
      )}
    </Layout>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-primary">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">{icon}</span>
        <span className="text-sm font-semibold text-foreground">{label}</span>
      </div>
      <p className="mt-3 text-2xl font-bold text-foreground">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
