import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  deleteOptionGroup,
  listOptionGroups,
  saveOptionGroup,
  setProductOptionGroups,
  type OptionGroup,
  type ProductOption,
} from '../services/productOptions';
import type { Product } from '../utils/types';
import { toastError } from '../utils/notifications';
import { formatMoney as money } from '../utils/restaurantFormat';

type Draft = {
  id?: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: (Omit<ProductOption, 'id'> & { id?: string })[];
  productIds: string[];
};

const emptyDraft = (): Draft => ({
  name: '',
  minSelect: 0,
  maxSelect: 1,
  options: [{ name: '', priceDelta: 0, ingredientId: null, ingredientQuantity: 0 }],
  productIds: [],
});

/** Menu add-ons: groups like "Tamaño" or "Adicionales", their priced options, and which products offer them. */
export function ProductOptionsManager({
  open,
  onOpenChange,
  products,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
}) {
  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const menuItems = products.filter(p => p.productType !== 'ingredient' && p.productType !== 'supplies');
  const ingredients = products.filter(p => p.productType === 'ingredient' || p.productType === 'supplies');

  const load = () =>
    listOptionGroups()
      .then(setGroups)
      .catch(e => toastError(e, 'No se pudieron cargar las opciones.'));
  useEffect(() => {
    if (open) void load();
    else setDraft(null);
  }, [open]);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const saved = await saveOptionGroup({
        id: draft.id,
        name: draft.name.trim(),
        minSelect: draft.minSelect,
        maxSelect: draft.maxSelect,
        options: draft.options
          .filter(o => o.name.trim())
          .map(o => ({ ...o, name: o.name.trim(), ingredientQuantity: o.ingredientId ? o.ingredientQuantity : 0 })),
      });
      // Links are stored per product: update only the products whose list changed.
      const before = new Set(draft.id ? (groups.find(g => g.id === draft.id)?.productIds ?? []) : []);
      const after = new Set(draft.productIds);
      const changed = menuItems.filter(p => before.has(p.id) !== after.has(p.id));
      for (const product of changed) {
        const current = groups.filter(g => g.id !== saved.id && g.productIds.includes(product.id)).map(g => g.id);
        await setProductOptionGroups(product.id, after.has(product.id) ? [...current, saved.id] : current);
      }
      toast.success('Opciones guardadas.');
      setDraft(null);
      await load();
    } catch (e) {
      toastError(e, 'No se pudieron guardar las opciones.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (group: OptionGroup) => {
    if (!window.confirm(`¿Quitar el grupo «${group.name}»? Los pedidos y ventas anteriores conservan lo elegido.`))
      return;
    try {
      await deleteOptionGroup(group.id);
      toast.success('Grupo quitado.');
      await load();
    } catch (e) {
      toastError(e, 'No se pudo quitar el grupo.');
    }
  };

  const setOption = (index: number, change: Partial<Draft['options'][number]>) =>
    draft && setDraft({ ...draft, options: draft.options.map((o, i) => (i === index ? { ...o, ...change } : o)) });

  return (
    <Dialog open={open} onOpenChange={next => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Opciones del menú</DialogTitle>
          <DialogDescription>
            Tamaños, proteínas, adicionales o salsas. Cada opción suma su precio y puede descontar un ingrediente.
          </DialogDescription>
        </DialogHeader>

        {!draft ? (
          <div className="space-y-3">
            {groups.map(group => (
              <div key={group.id} className="flex items-start justify-between gap-3 rounded-xl border p-3">
                <div className="min-w-0">
                  <p className="font-semibold">{group.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {group.minSelect > 0 ? `Obligatorio · elige ${group.minSelect}` : 'Opcional'} · máximo{' '}
                    {group.maxSelect} · {group.productIds.length} producto(s)
                  </p>
                  <p className="mt-1 text-sm">
                    {group.options
                      .map(o => (o.priceDelta > 0 ? `${o.name} +${money(o.priceDelta)}` : o.name))
                      .join(' · ')}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" onClick={() => setDraft({ ...group })}>
                    Editar
                  </Button>
                  <Button variant="outline" size="sm" aria-label={`Quitar ${group.name}`} onClick={() => remove(group)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            {!groups.length && (
              <p className="text-sm text-muted-foreground">
                Aún no hay opciones. Crea un grupo, por ejemplo «Tamaño» o «Adicionales».
              </p>
            )}
            <Button className="min-h-11 w-full" onClick={() => setDraft(emptyDraft())}>
              <Plus className="mr-2 h-4 w-4" /> Nuevo grupo de opciones
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={e => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_110px_110px]">
              <label className="text-sm">
                Nombre del grupo
                <Input
                  required
                  maxLength={80}
                  placeholder="Tamaño, Adicionales…"
                  value={draft.name}
                  onChange={e => setDraft({ ...draft, name: e.target.value })}
                  className="mt-1"
                />
              </label>
              <label className="text-sm">
                Mínimo
                <Input
                  type="number"
                  min={0}
                  max={20}
                  value={draft.minSelect}
                  onChange={e => setDraft({ ...draft, minSelect: Math.max(0, Number(e.target.value) || 0) })}
                  className="mt-1"
                />
              </label>
              <label className="text-sm">
                Máximo
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={draft.maxSelect}
                  onChange={e => setDraft({ ...draft, maxSelect: Math.max(1, Number(e.target.value) || 1) })}
                  className="mt-1"
                />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Mínimo 1 y máximo 1 = obligatorio, una sola opción (como el tamaño). Mínimo 0 = opcional.
            </p>

            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">Opciones</legend>
              {draft.options.map((option, index) => (
                <div
                  key={option.id ?? index}
                  className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_110px_1fr_90px_auto]"
                >
                  <Input
                    aria-label="Nombre de la opción"
                    placeholder="Queso, Doble…"
                    maxLength={80}
                    value={option.name}
                    onChange={e => setOption(index, { name: e.target.value })}
                  />
                  <Input
                    aria-label="Precio adicional"
                    type="number"
                    min={0}
                    step="100"
                    placeholder="+ precio"
                    value={option.priceDelta || ''}
                    onChange={e => setOption(index, { priceDelta: Math.max(0, Number(e.target.value) || 0) })}
                  />
                  <select
                    aria-label="Ingrediente que descuenta"
                    value={option.ingredientId ?? ''}
                    onChange={e => setOption(index, { ingredientId: e.target.value || null })}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">Sin ingrediente</option>
                    {ingredients.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <Input
                    aria-label="Cantidad del ingrediente"
                    type="number"
                    min={0}
                    step="any"
                    placeholder="Cant."
                    disabled={!option.ingredientId}
                    value={option.ingredientQuantity || ''}
                    onChange={e => setOption(index, { ingredientQuantity: Math.max(0, Number(e.target.value) || 0) })}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label="Quitar opción"
                    disabled={draft.options.length === 1}
                    onClick={() => setDraft({ ...draft, options: draft.options.filter((_, i) => i !== index) })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setDraft({
                    ...draft,
                    options: [...draft.options, { name: '', priceDelta: 0, ingredientId: null, ingredientQuantity: 0 }],
                  })
                }
              >
                <Plus className="mr-1 h-4 w-4" /> Agregar opción
              </Button>
            </fieldset>

            <fieldset className="space-y-1">
              <legend className="text-sm font-semibold">Productos que ofrecen este grupo</legend>
              <div className="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">
                {menuItems.map(product => (
                  <label
                    key={product.id}
                    className="flex min-h-9 items-center gap-2 rounded-md px-2 text-sm hover:bg-accent"
                  >
                    <input
                      type="checkbox"
                      checked={draft.productIds.includes(product.id)}
                      onChange={e =>
                        setDraft({
                          ...draft,
                          productIds: e.target.checked
                            ? [...draft.productIds, product.id]
                            : draft.productIds.filter(id => id !== product.id),
                        })
                      }
                    />
                    {product.name}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                Cancelar
              </Button>
              <Button type="submit" className="min-h-11 flex-1" disabled={busy || !draft.name.trim()}>
                {busy ? 'Guardando…' : 'Guardar grupo'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
