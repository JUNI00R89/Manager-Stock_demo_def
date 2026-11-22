import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { optionsPrice, selectionError, type OptionGroup } from '../services/productOptions';
import { formatMoney as money } from '../utils/restaurantFormat';

/**
 * Asks for a menu product's options before it goes into the order.
 * Groups that allow a single choice behave like radio buttons; the rest like checkboxes up to their maximum.
 */
export function OptionPicker({
  product,
  groups,
  onConfirm,
  onClose,
}: {
  product: { name: string; price: number } | null;
  groups: OptionGroup[];
  onConfirm: (selected: string[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    // Preselect the first option of required single-choice groups (usually the base size).
    if (product)
      setSelected(groups.filter(g => g.minSelect === 1 && g.maxSelect === 1 && g.options[0]).map(g => g.options[0].id));
  }, [product, groups]);

  const toggle = (group: OptionGroup, optionId: string) =>
    setSelected(current => {
      const inGroup = new Set(group.options.map(o => o.id));
      if (current.includes(optionId)) return current.filter(id => id !== optionId);
      if (group.maxSelect === 1) return [...current.filter(id => !inGroup.has(id)), optionId];
      const count = current.filter(id => inGroup.has(id)).length;
      return count >= group.maxSelect ? current : [...current, optionId];
    });

  const error = selectionError(groups, selected);
  const unitPrice = (product?.price ?? 0) + optionsPrice(groups, selected);

  // Unmount instead of animating out: this dialog opens over other dialogs (the table's order), and a
  // closed-but-still-mounted layer kept the page blocked (pointer-events: none) so nothing could be clicked.
  if (!product) return null;

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product?.name}</DialogTitle>
          <DialogDescription>Elige las opciones de este producto.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {groups.map(group => {
            const count = group.options.filter(o => selected.includes(o.id)).length;
            const rule =
              group.minSelect === group.maxSelect
                ? `Elige ${group.maxSelect}`
                : group.minSelect > 0
                  ? `Elige de ${group.minSelect} a ${group.maxSelect}`
                  : `Opcional · hasta ${group.maxSelect}`;
            return (
              <fieldset key={group.id} className="space-y-2">
                <legend className="flex w-full items-baseline justify-between gap-2">
                  <span className="font-semibold">{group.name}</span>
                  <span className={`text-xs ${count < group.minSelect ? 'text-amber-700' : 'text-muted-foreground'}`}>
                    {rule}
                  </span>
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {group.options.map(option => {
                    const checked = selected.includes(option.id);
                    const full = !checked && group.maxSelect > 1 && count >= group.maxSelect;
                    return (
                      <label
                        key={option.id}
                        className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition ${
                          checked ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent'
                        } ${full ? 'cursor-not-allowed opacity-50' : ''}`}
                      >
                        <input
                          type={group.maxSelect === 1 ? 'radio' : 'checkbox'}
                          name={group.id}
                          className="h-4 w-4"
                          checked={checked}
                          disabled={full}
                          onChange={() => toggle(group, option.id)}
                        />
                        <span className="flex-1">{option.name}</span>
                        <span className="text-muted-foreground">
                          {option.priceDelta > 0 ? `+${money(option.priceDelta)}` : 'Incluido'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
          {error && (
            <p className="text-sm text-amber-700" role="status">
              {error}
            </p>
          )}
          <Button
            type="button"
            className="min-h-11 w-full"
            disabled={!!error}
            onClick={() => {
              onConfirm(selected);
              onClose();
            }}
          >
            Agregar · {money(unitPrice)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
