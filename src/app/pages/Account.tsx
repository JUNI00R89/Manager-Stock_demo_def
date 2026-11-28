import { useState } from 'react';
import { toast } from 'sonner';
import { KeyRound, LoaderCircle, MonitorSmartphone, UserRound } from 'lucide-react';
import { Layout } from '../components/Layout';
import { ConfirmActionDialog } from '../components/ConfirmActionDialog';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { useAuth } from '../context/AuthContext';
import { authService } from '../services/dataService';
import { isDesktopMode } from '../services/desktop';
import { roleLabel } from '../security/permissions';
import { toastError } from '../utils/notifications';

/** Own account: change the password and sign out other devices. Open to every business role, cashiers included. */
export function Account() {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false);
  const desktop = isDesktopMode();

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!current) return setError('Escribe tu contraseña actual.');
    if (next.length < 8) return setError('La contraseña nueva debe tener al menos 8 caracteres.');
    if (next !== confirm) return setError('Las contraseñas nuevas no coinciden.');
    setError('');
    setSaving(true);
    try {
      const result = await authService.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success('Contraseña actualizada.', {
        description: result.closedSessions
          ? `Se cerró la sesión en ${result.closedSessions} dispositivo(s) más.`
          : 'Este dispositivo sigue con la sesión abierta.',
      });
    } catch (failure) {
      toastError(failure, 'No se pudo cambiar la contraseña.');
    } finally {
      setSaving(false);
    }
  };

  const logoutOthers = async () => {
    try {
      const result = await authService.logoutAll();
      toast.success(
        result.closedSessions
          ? `Se cerró la sesión en ${result.closedSessions} dispositivo(s).`
          : 'No había otras sesiones abiertas.',
      );
    } catch (failure) {
      toastError(failure, 'No se pudieron cerrar las demás sesiones.');
      throw failure;
    }
  };

  return (
    <Layout>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h2 className="text-3xl font-bold text-foreground">Mi cuenta</h2>
          <p className="mt-1 text-muted-foreground">Tu contraseña y los dispositivos donde tienes la sesión abierta.</p>
        </div>

        <Card className="flex items-center gap-4 rounded-2xl border-border/70 p-6 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand-primary)]">
            <UserRound size={22} />
          </div>
          <div>
            <p className="font-semibold">{user?.name}</p>
            <p className="text-sm text-muted-foreground">
              {user?.email} · {roleLabel(user?.role)}
            </p>
          </div>
        </Card>

        {desktop ? (
          <Card className="rounded-2xl border-dashed p-6 text-sm text-muted-foreground">
            Cambiar la contraseña y cerrar sesiones necesita conexión con el servidor. En la versión de escritorio local
            no está disponible.
          </Card>
        ) : (
          <>
            <Card className="rounded-2xl border-border/70 p-6 shadow-sm">
              <form onSubmit={changePassword} className="space-y-4">
                <div className="flex items-start gap-3">
                  <KeyRound className="mt-1 h-5 w-5 text-[var(--brand-primary)]" />
                  <div>
                    <h3 className="text-lg font-semibold">Cambiar contraseña</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Al cambiarla se cierra la sesión en tus otros dispositivos; en este sigues dentro.
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="current-password">Contraseña actual</Label>
                  <Input
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                    value={current}
                    onChange={event => setCurrent(event.target.value)}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="new-password">Contraseña nueva</Label>
                    <Input
                      id="new-password"
                      type="password"
                      autoComplete="new-password"
                      value={next}
                      onChange={event => setNext(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">Repite la contraseña nueva</Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      autoComplete="new-password"
                      value={confirm}
                      onChange={event => setConfirm(event.target.value)}
                    />
                  </div>
                </div>
                {error && (
                  <p role="alert" className="text-sm text-rose-600">
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={saving}>
                  {saving && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
                  Cambiar contraseña
                </Button>
              </form>
            </Card>

            <Card className="rounded-2xl border-border/70 p-6 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <MonitorSmartphone className="mt-1 h-5 w-5 text-[var(--brand-primary)]" />
                  <div>
                    <h3 className="text-lg font-semibold">Sesiones abiertas</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Si perdiste un celular o usaste un computador ajeno, cierra la sesión en todos los demás.
                    </p>
                  </div>
                </div>
                <Button variant="outline" onClick={() => setConfirmLogoutAll(true)}>
                  Cerrar sesión en los demás dispositivos
                </Button>
              </div>
            </Card>
          </>
        )}
      </div>
      <ConfirmActionDialog
        open={confirmLogoutAll}
        onOpenChange={setConfirmLogoutAll}
        title="Cerrar las demás sesiones"
        description="Se cerrará tu sesión en todos los dispositivos excepto en este. Tendrás que volver a iniciar sesión en ellos."
        confirmLabel="Cerrar las demás sesiones"
        destructive
        onConfirm={logoutOthers}
      />
    </Layout>
  );
}
