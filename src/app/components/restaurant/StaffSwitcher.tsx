import { useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown, KeyRound, ShieldCheck, UserRound } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { RESTAURANT_ROLE_LABELS, useRestaurantStaff, type RestaurantStaff } from '../../utils/restaurantStaffStore';
import type { EmpleadoRol } from '../../utils/restaurantTypes';
import { getInitials } from '../../utils/restaurantFormat';
import { primeRestaurantAudio } from '../../utils/restaurantAudio';

interface StaffSwitcherProps {
  scope: string;
  role: EmpleadoRol;
  currentUserName: string;
  className?: string;
}

export function StaffSwitcher({ scope, role, currentUserName, className = '' }: StaffSwitcherProps) {
  const { staff, activeStaff, setActive } = useRestaurantStaff(scope, currentUserName);
  const active = activeStaff(role);
  const [open, setOpen] = useState(false);
  const [pinTarget, setPinTarget] = useState<RestaurantStaff | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const options = staff.filter(item => item.role === role && item.active);

  const close = () => {
    setOpen(false);
    setPinTarget(null);
    setPin('');
    setError('');
  };

  const choose = (person: RestaurantStaff) => {
    primeRestaurantAudio();
    if (person.pin) {
      setPinTarget(person);
      setPin('');
      setError('');
      return;
    }
    setActive(role, person.id);
    close();
  };

  const confirmPin = () => {
    if (!pinTarget) return;
    if (pin.trim() !== pinTarget.pin) {
      setError('PIN incorrecto. Inténtalo de nuevo.');
      return;
    }
    setActive(role, pinTarget.id);
    close();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`group inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-2.5 py-1.5 text-left text-foreground shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
        aria-haspopup="dialog"
        aria-label="Cambiar usuario activo"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-bold text-primary">
          {active ? getInitials(active.name) : <UserRound size={16} />}
        </span>
        <span className="min-w-0">
          <span className="block max-w-[9rem] truncate text-sm font-semibold leading-tight">
            {active?.name ?? 'Sin usuario'}
          </span>
          <span className="block text-[11px] font-medium leading-tight text-muted-foreground">
            {RESTAURANT_ROLE_LABELS[role]}
          </span>
        </span>
        <ChevronDown
          size={16}
          className="shrink-0 text-muted-foreground transition-transform group-hover:translate-y-0.5"
        />
      </button>

      <Dialog
        open={open}
        onOpenChange={next => {
          if (!next) close();
          else setOpen(true);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Usuario activo</DialogTitle>
            <DialogDescription>
              Elige quién está usando esta pantalla. Si la persona tiene PIN, se pedirá antes de cambiar.
            </DialogDescription>
          </DialogHeader>

          {pinTarget ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-muted/40 p-4">
                <p className="text-sm font-semibold text-foreground">PIN de {pinTarget.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">Ingresa el PIN de 4 a 8 dígitos para continuar.</p>
                <Input
                  autoFocus
                  type="password"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={pin}
                  maxLength={8}
                  onChange={event => {
                    setPin(event.target.value.replace(/\D/g, ''));
                    setError('');
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter') confirmPin();
                  }}
                  className="mt-3 h-12 text-center text-xl tracking-[0.4em]"
                  aria-label={`PIN de ${pinTarget.name}`}
                />
                {error && <p className="mt-2 text-sm font-medium text-destructive">{error}</p>}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 flex-1"
                  onClick={() => {
                    setPinTarget(null);
                    setPin('');
                    setError('');
                  }}
                >
                  Volver
                </Button>
                <Button type="button" className="h-11 flex-1" onClick={confirmPin} disabled={!pin.trim()}>
                  <ShieldCheck size={17} /> Entrar
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {options.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
                  No hay usuarios activos con el rol {RESTAURANT_ROLE_LABELS[role].toLowerCase()}.
                </div>
              )}
              {options.map(person => {
                const selected = active?.id === person.id;
                return (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => choose(person)}
                    className={`flex min-h-14 w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'border-primary/40 bg-primary/10' : 'border-border bg-card hover:bg-accent'}`}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold text-secondary-foreground">
                      {getInitials(person.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{person.name}</span>
                      <span className="block text-xs text-muted-foreground">{RESTAURANT_ROLE_LABELS[person.role]}</span>
                    </span>
                    {person.pin && (
                      <KeyRound size={16} className="text-muted-foreground" aria-label="Protegido con PIN" />
                    )}
                    {selected && <span className="text-xs font-semibold text-primary">Activo</span>}
                  </button>
                );
              })}
              <Link
                to="/restaurant/settings?tab=usuarios"
                onClick={close}
                className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-xl text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Gestionar equipo del restaurante
              </Link>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
