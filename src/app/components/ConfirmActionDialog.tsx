import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { LoaderCircle, AlertTriangle } from 'lucide-react';

export interface ConfirmActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

/** A consistent, centered confirmation dialog; replaces native browser confirm() dialogs. */
export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  destructive = false,
  onConfirm,
}: ConfirmActionDialogProps) {
  const [pending, setPending] = useState(false);

  const changeOpen = (nextOpen: boolean) => {
    if (pending) return;
    onOpenChange(nextOpen);
  };

  const confirm = async () => {
    if (pending) return;
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // The owning page is responsible for showing the error. Keep the dialog open
      // so the user does not lose the context of a failed operation.
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-3xl border-border/80 p-5 shadow-2xl sm:p-6">
        <DialogHeader className="pr-7 text-left">
          <div className={`mb-1 flex h-10 w-10 items-center justify-center rounded-xl ${destructive ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40' : 'bg-[var(--brand-soft)] text-[var(--brand-primary)]'}`}>
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </div>
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          <DialogDescription className="text-sm leading-6">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-2 gap-2 sm:flex-row-reverse">
          <Button type="button" variant={destructive ? 'destructive' : 'default'} disabled={pending} onClick={() => void confirm()} className="rounded-xl">
            {pending && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
            {pending ? 'Procesando…' : confirmLabel}
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)} className="rounded-xl">
            {cancelLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
