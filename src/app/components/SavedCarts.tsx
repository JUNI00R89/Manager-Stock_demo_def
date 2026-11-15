import { uniqueRestaurantId } from '../utils/restaurantStorage';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/button';
import type { Customer } from '../services/commerce';
import type { Product } from '../utils/types';
import { toast } from 'sonner';
import { toastError } from '../utils/notifications';

interface Line {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  sku: string;
  discount: number;
}
export interface CartDraft {
  cart: Line[];
  customer: Customer | null;
  customerName: string;
  globalDiscount: number;
}
interface StoredCart extends CartDraft {
  id: string;
  savedAt: string;
  savedBy: string;
}
export function SavedCarts({
  current,
  products,
  disabled,
  onClear,
  onRestore,
}: {
  current: CartDraft;
  products: Product[];
  disabled: boolean;
  onClear: () => void;
  onRestore: (draft: CartDraft) => void;
}) {
  const { user } = useAuth();
  const key = `saved_carts:${user?.businessId}:${user?.id}`;
  const read = (): StoredCart[] => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  };
  const [saved, setSaved] = useState<StoredCart[]>(read);
  useEffect(() => {
    setSaved(read());
    const sync = (event: StorageEvent) => {
      if (event.key === key) setSaved(read());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [key]);
  const snapshot = (): StoredCart => ({
    ...current,
    id: uniqueRestaurantId('op'),
    savedAt: new Date().toISOString(),
    savedBy: user?.name || '',
  });
  const mutate = async (work: (rows: StoredCart[]) => StoredCart[]) => {
    const operation = () => {
      const next = work(read());
      if (next.length > 30) throw new Error('Puedes conservar hasta 30 carritos en este navegador.');
      localStorage.setItem(key, JSON.stringify(next));
      setSaved(next);
    };
    if (navigator.locks) await navigator.locks.request(key, operation);
    else operation();
  };
  return (
    <div className="space-y-2 border rounded-xl p-3">
      <Button
        variant="outline"
        className="min-h-11 w-full"
        disabled={disabled || !current.cart.length}
        onClick={async () => {
          try {
            await mutate(rows => [snapshot(), ...rows]);
            onClear();
            toast.success('Carrito guardado. Puedes iniciar otra venta.');
          } catch (e) {
            toastError(e, 'No se pudo guardar.');
          }
        }}
      >
        Guardar carrito para después
      </Button>
      <details>
        <summary className="cursor-pointer min-h-11 text-sm py-3">
          Carritos guardados en este navegador ({saved.length})
        </summary>
        <p className="text-xs text-muted-foreground mb-3">
          No reservan stock ni registran ingresos. Al recuperar se actualizan los precios del catálogo. Si ya tienes
          productos, tu carrito actual se guarda primero.
        </p>
        <div className="space-y-3">
          {saved.map(draft => (
            <article key={draft.id} className="border rounded-lg p-3 space-y-2">
              <p className="text-sm break-words">
                {draft.customerName || 'Cliente general'} · {draft.cart.length} productos
              </p>
              <p className="text-xs text-muted-foreground">
                {draft.savedBy} · {new Date(draft.savedAt).toLocaleString('es-CO')}
              </p>
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={async () => {
                    try {
                      let restored: StoredCart | undefined;
                      await mutate(rows => {
                        const selected = rows.find(d => d.id === draft.id);
                        if (!selected) throw new Error('El carrito ya fue recuperado en otra pestaña.');
                        const cart = selected.cart.map(line => {
                          const product = products.find(p => p.id === line.productId);
                          if (!product)
                            throw new Error(`El producto ${line.name} ya no está disponible. Revisa el catálogo.`);
                          return { ...line, price: product.price, name: product.name, sku: product.sku };
                        });
                        restored = { ...selected, cart };
                        return [...(current.cart.length ? [snapshot()] : []), ...rows.filter(d => d.id !== draft.id)];
                      });
                      if (restored) onRestore(restored);
                      toast.success('Carrito recuperado con precios actuales.');
                    } catch (e) {
                      toastError(e, 'No se pudo recuperar.');
                    }
                  }}
                >
                  Recuperar
                </Button>
                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={() =>
                    void mutate(rows => rows.filter(d => d.id !== draft.id)).catch(e =>
                      toastError(e, 'No se pudo quitar.'),
                    )
                  }
                >
                  Quitar
                </Button>
              </div>
            </article>
          ))}
        </div>
      </details>
    </div>
  );
}
