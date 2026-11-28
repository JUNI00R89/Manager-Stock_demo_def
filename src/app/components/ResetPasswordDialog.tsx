import { useEffect, useState } from 'react';
import { KeyRound, LoaderCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

interface ResetPasswordDialogProps {
  open: boolean;
  userName: string;
  onOpenChange: (open: boolean) => void;
  /** Throws to keep the dialog open (the page shows the error). */
  onSubmit: (newPassword: string) => Promise<void>;
}

/** The owner sets a new password for an employee who forgot theirs (there is no e-mail recovery yet). */
export function ResetPasswordDialog({ open, userName, onOpenChange, onSubmit }: ResetPasswordDialogProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) {
      setPassword('');
      setConfirm('');
      setError('');
    }
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 8) return setError('Debe tener al menos 8 caracteres.');
    if (password !== confirm) return setError('Las contraseñas no coinciden.');
    setError('');
    setPending(true);
    try {
      await onSubmit(password);
      onOpenChange(false);
    } catch {
      // The page already showed the reason; keep the dialog open.
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={next => !pending && onOpenChange(next)}>
      <DialogContent className="rounded-3xl p-5 sm:p-6">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader className="text-left">
            <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand-primary)]">
              <KeyRound className="h-5 w-5" aria-hidden="true" />
            </div>
            <DialogTitle>Restablecer contraseña</DialogTitle>
            <DialogDescription>
              Escribe una contraseña nueva para {userName} y entrégasela en persona. Se cerrarán sus sesiones abiertas y
              podrá cambiarla después desde Mi cuenta.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reset-password">Contraseña nueva</Label>
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reset-password-confirm">Repite la contraseña</Label>
            <Input
              id="reset-password-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={event => setConfirm(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-rose-600">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
              Guardar contraseña
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
