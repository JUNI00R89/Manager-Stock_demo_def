import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, Building2, CalendarClock, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../utils/notifications';
import { useAuth } from '../context/AuthContext';
import { getSuspensionStatus, type SuspensionStatusRecord } from '../services/dataService';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { SupportCenter } from '../components/SupportCenter';

export function SuspendedBusiness() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<SuspensionStatusRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getSuspensionStatus();
      setStatus(next);
      if (next.active) navigate('/dashboard', { replace: true });
    } catch (error) {
      toastError(error, 'No se pudo consultar el estado de la cuenta.');
    } finally { setLoading(false); }
  }, [navigate]);
  useEffect(() => {
    void refresh();
    // Comprueba la reactivación sin obligar al propietario a recargar la página.
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  const signOut = async () => { await logout(); navigate('/login', { replace: true }); };
  const date = status?.suspendedAt ? new Date(status.suspendedAt).toLocaleString('es-CO') : 'No disponible';

  return <main className="min-h-screen bg-[var(--background)] px-4 py-8 text-[var(--foreground)] sm:px-6">
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 text-rose-700"><AlertTriangle size={22}/></span><div><p className="text-sm font-bold">MANAGER STOCK</p><p className="text-xs text-muted-foreground">Centro de revisión administrativa</p></div></div><div className="flex gap-2"><Button variant="outline" onClick={() => void refresh()} disabled={loading} className="rounded-xl"><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`}/>Actualizar</Button><Button variant="outline" onClick={() => void signOut()} className="rounded-xl"><LogOut className="mr-2 h-4 w-4"/>Cerrar sesión</Button></div></header>
      <Card className="overflow-hidden rounded-3xl border-rose-200 shadow-sm dark:border-rose-900"><div className="bg-gradient-to-r from-rose-50 to-white p-6 dark:from-rose-950/30 dark:to-card sm:p-8"><div className="flex flex-wrap items-start justify-between gap-4"><div><span className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200"><AlertTriangle size={13}/> Negocio suspendido</span><h1 className="mt-4 text-2xl font-bold sm:text-3xl">El acceso comercial está temporalmente restringido</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Puedes consultar el motivo y comunicarte con el equipo SUPERADMIN. Las operaciones comerciales permanecerán bloqueadas mientras se revisa el caso; tus registros no se eliminan.</p></div><div className="rounded-2xl border border-border bg-card p-4"><Building2 size={20} className="text-[var(--brand-primary)]"/><p className="mt-2 text-xs text-muted-foreground">Negocio</p><p className="mt-1 font-semibold">{status?.businessName || user?.name || 'Cargando…'}</p></div></div></div><div className="grid gap-4 p-6 sm:grid-cols-2 sm:p-8"><div className="rounded-2xl border border-border p-4"><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><ShieldCheck size={15}/> Motivo de suspensión</p><p className="mt-2 font-semibold">{status?.reason || 'No se ha proporcionado un motivo.'}</p>{status?.description && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{status.description}</p>}</div><div className="rounded-2xl border border-border p-4"><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><CalendarClock size={15}/> Fecha de suspensión</p><p className="mt-2 font-semibold">{date}</p><p className="mt-2 text-sm text-muted-foreground">Cuenta asociada a {user?.email}. El equipo administrativo podrá responder a través de la conversación.</p></div></div></Card>
      <SupportCenter mode="owner"/>
    </div>
  </main>;
}
