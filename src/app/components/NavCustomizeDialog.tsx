import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { useAuth } from '../context/AuthContext';
import { toastError } from '../utils/notifications';

/** Never hidden, so the user can always come back here and undo the change. */
export const ALWAYS_VISIBLE_NAV = new Set(['/dashboard', '/settings']);

type Entry = { path: string; label: string; group?: string };

/** Each user picks which sidebar entries to show. Visual only: it does not remove any permission. */
export function NavCustomizeDialog({
  open,
  onClose,
  items,
  groupLabels,
}: {
  open: boolean;
  onClose: () => void;
  items: Entry[];
  groupLabels: Record<string, string>;
}) {
  const { user, saveHiddenNav } = useAuth();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setHidden(new Set(user?.hiddenNav ?? []));
  }, [open, user?.hiddenNav]);

  // One checkbox per route (some routes appear under two names).
  const entries = items.filter((item, i) => items.findIndex(other => other.path === item.path) === i);
  const groups = Array.from(new Set(entries.map(e => e.group ?? 'general')));

  const save = async (next: Set<string>) => {
    setBusy(true);
    try {
      await saveHiddenNav([...next]);
      toast.success('Menú actualizado.');
      onClose();
    } catch (e) {
      toastError(e, 'No se pudo guardar el menú.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={next => !next && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Personalizar menú</DialogTitle>
          <DialogDescription>
            Elige qué ver en tu barra lateral. Solo cambia tu menú; tus permisos siguen iguales.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {groups.map(group => (
            <fieldset key={group} className="space-y-1">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {groupLabels[group] ?? group}
              </legend>
              {entries
                .filter(e => (e.group ?? 'general') === group)
                .map(entry => {
                  const locked = ALWAYS_VISIBLE_NAV.has(entry.path);
                  return (
                    <label
                      key={entry.path}
                      className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-accent"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={locked || !hidden.has(entry.path)}
                        disabled={locked || busy}
                        onChange={e => {
                          const next = new Set(hidden);
                          if (e.target.checked) next.delete(entry.path);
                          else next.add(entry.path);
                          setHidden(next);
                        }}
                      />
                      <span>{entry.label}</span>
                      {locked && <span className="ml-auto text-xs text-muted-foreground">Siempre visible</span>}
                    </label>
                  );
                })}
            </fieldset>
          ))}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={busy}
              onClick={() => save(new Set())}
            >
              Mostrar todo
            </Button>
            <Button type="button" className="min-h-11 flex-1" disabled={busy} onClick={() => save(hidden)}>
              {busy ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
