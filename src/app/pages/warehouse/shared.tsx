import { useCallback, useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../utils/notifications';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { dataService, type InventoryLocationRecord, type InventoryLotRecord, type InventorySettingsRecord } from '../../services/dataService';
import type { Product, Supplier } from '../../utils/types';
import { useAuth } from '../../context/AuthContext';

export { formatMoney as money } from '../../utils/restaurantFormat';
export const fmtQty = (value: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 }).format(Number.isFinite(value) ? value : 0);
export const dateOnly = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(`${value.length === 10 ? `${value}T12:00:00` : value}`)) : '—';
export const dateTime = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';

/** Removes a form line but always keeps at least one. */
export const withoutLine = <T extends { key: string }>(lines: T[], key: string): T[] =>
  lines.length === 1 ? lines : lines.filter(line => line.key !== key);

export function useWarehouseRefs() {
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<InventoryLocationRecord[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [settings, setSettings] = useState<InventorySettingsRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [nextProducts, nextLocations, nextSuppliers, nextSettings] = await Promise.all([
        dataService.getProducts(),
        dataService.getInventoryLocations(),
        dataService.getSuppliers(),
        dataService.getInventorySettings(),
      ]);
      setProducts(nextProducts.filter(product => product.name));
      setLocations(nextLocations.filter(location => location.active));
      setSuppliers(nextSuppliers);
      setSettings(nextSettings);
    } catch (error) {
      toastError(error, 'No se pudieron cargar los datos de la bodega.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { products, locations, suppliers, settings, loading, reload };
}

export function useWarehousePermissions() {
  const { user } = useAuth();
  const isCustom = Boolean(user?.customRoleId);
  const can = useCallback((permission: string) => {
    if (!user) return false;
    if (!isCustom) return user.role === 'owner' || user.role === 'business_admin';
    return (user.permissions ?? []).includes(permission);
  }, [user, isCustom]);
  return {
    can,
    canView: can('inventory.view'),
    canEntry: can('inventory.entry'),
    canAdjust: can('inventory.adjust'),
    canEdit: can('inventory.edit'),
    canDelete: can('inventory.delete'),
    canNegative: can('inventory.negative'),
    canApprovePurchases: can('purchases.approve'),
  };
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'orange' }: {
  label: string; value: string | number; hint?: string; icon: LucideIcon;
  tone?: 'orange' | 'emerald' | 'rose' | 'blue' | 'violet' | 'amber';
}) {
  const tones: Record<string, string> = {
    orange: 'bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-300',
    emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300',
    rose: 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300',
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300',
    violet: 'bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  };
  return <Card className="rounded-2xl border-border/70 p-5 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 truncate text-2xl font-bold tracking-tight">{value}</p>{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}</div>
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}><Icon className="h-5 w-5"/></div>
    </div>
  </Card>;
}

export function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div><p className="text-sm font-semibold uppercase tracking-[.16em] text-orange-600">{eyebrow}</p><h1 className="mt-1 text-3xl font-bold tracking-tight">{title}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p></div>
    {action}
  </div>;
}

export function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return <Card className="rounded-2xl border-dashed p-10 text-center">
    <Icon className="mx-auto h-10 w-10 text-muted-foreground/50"/>
    <h2 className="mt-3 font-semibold">{title}</h2>
    <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
  </Card>;
}

export function ProductSelect({ products, value, onChange, placeholder = 'Selecciona un producto…', className = '' }: {
  products: Product[]; value: string; onChange: (value: string) => void; placeholder?: string; className?: string;
}) {
  return <select value={value} onChange={event => onChange(event.target.value)} className={`h-11 w-full rounded-xl border border-input bg-background px-3 text-sm ${className}`}>
    <option value="">{placeholder}</option>
    {products.map(product => <option key={product.id} value={product.id}>{product.name} · {fmtQty(product.stock)} {product.unit || 'unidad'}</option>)}
  </select>;
}

export function LotSelect({ lots, value, onChange, placeholder = 'Sin lote específico (FEFO)', className = '' }: {
  lots: InventoryLotRecord[]; value: string; onChange: (value: string) => void; placeholder?: string; className?: string;
}) {
  return <select value={value} onChange={event => onChange(event.target.value)} className={`h-11 w-full rounded-xl border border-input bg-background px-3 text-sm ${className}`}>
    <option value="">{placeholder}</option>
    {lots.map(lot => <option key={lot.id} value={lot.id}>{lot.lotCode || 'Sin código'} · {fmtQty(lot.quantity)} {lot.productUnit}{lot.expiryDate ? ` · vence ${dateOnly(lot.expiryDate)}` : ''}</option>)}
  </select>;
}

export function BarcodeScan({ onProducts }: { onProducts: (products: Product[]) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const lookup = async () => {
    const value = code.trim();
    if (!value) return;
    setBusy(true);
    try {
      const result = await dataService.lookupInventoryBarcode(value);
      onProducts(result.products);
      setCode('');
      toast.success(result.products.length === 1 ? `Producto encontrado: ${result.products[0].name}` : `${result.products.length} productos encontrados.`);
    } catch (error) {
      toastError(error, 'No se encontró el código.');
    } finally { setBusy(false); }
  };
  return <div className="flex gap-2">
    <div className="relative flex-1"><ScanLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/><Input value={code} onChange={event => setCode(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void lookup(); } }} placeholder="Escanea o escribe un código de barras / SKU…" className="h-11 rounded-xl pl-9"/></div>
    <Button type="button" variant="outline" onClick={() => void lookup()} disabled={busy || !code.trim()} className="h-11 rounded-xl">{busy ? 'Buscando…' : 'Buscar'}</Button>
  </div>;
}
