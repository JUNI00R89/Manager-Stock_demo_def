import { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Boxes, Eye, EyeOff, Loader2, ShieldCheck, ArrowUpRight, ChartNoAxesCombined, PackageCheck, Activity, Monitor } from 'lucide-react';
import { toast } from 'sonner';
import { DESKTOP_DEMO_ACCOUNTS, isDesktopMode } from '../services/desktop';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const desktopMode = isDesktopMode();

  const goToApp = (loggedUser: { name?: string; role: string; businessActive?: boolean }) => {
    toast.success(`Bienvenido${loggedUser.name ? `, ${loggedUser.name}` : ''}`);
    navigate(loggedUser.role === 'superadmin' ? '/platform' : loggedUser.businessActive === false ? '/suspended' : '/dashboard', { replace: true });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const loggedUser = await login(email, password);
      if (!loggedUser) throw new Error('No se pudo iniciar sesión.');
      goToApp(loggedUser);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo iniciar sesión. Verifica tus credenciales y que el backend esté ejecutándose.');
    } finally { setLoading(false); }
  };

  const handleDemo = async (demoEmail: string, demoPassword: string) => {
    setEmail(demoEmail);
    setPassword(demoPassword);
    setLoading(true);
    try {
      const loggedUser = await login(demoEmail, demoPassword);
      if (!loggedUser) throw new Error('No se pudo iniciar sesión con la cuenta demo.');
      goToApp(loggedUser);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo iniciar sesión con la cuenta demo.');
    } finally { setLoading(false); }
  };

  return <main className="login-scene relative flex min-h-screen items-center justify-center overflow-hidden p-4 sm:p-6">
    <div aria-hidden="true" className="login-orb login-orb-one"/><div aria-hidden="true" className="login-orb login-orb-two"/><div aria-hidden="true" className="login-grid"/>
    <div className="relative z-10 grid w-full max-w-6xl overflow-hidden rounded-[2rem] border border-white/15 bg-white/95 shadow-[0_36px_100px_rgba(8,15,31,.38)] backdrop-blur-xl lg:min-h-[650px] lg:grid-cols-[1.05fr_.95fr]">
      <section className="relative hidden overflow-hidden bg-slate-950 p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-orange-500/25 via-slate-950 to-indigo-950/80"/>
        <div aria-hidden="true" className="absolute -right-24 top-20 h-80 w-80 rounded-full bg-orange-500/20 blur-3xl"/>
        <div aria-hidden="true" className="absolute -bottom-24 -left-20 h-80 w-80 rounded-full bg-blue-500/20 blur-3xl"/>
        <div className="relative flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-3xl bg-gradient-to-br from-orange-400 to-amber-500 shadow-lg shadow-orange-950/40"><Boxes size={25}/></div><div><p className="font-bold tracking-wide">MANAGER STOCK</p><p className="text-xs text-slate-400">Control inteligente para tu negocio</p></div></div>
        <div className="relative max-w-lg py-12"><p className="text-xs font-semibold uppercase tracking-[.25em] text-orange-300">Todo conectado. Todo bajo control.</p><h1 className="mt-5 text-4xl font-semibold leading-[1.12] tracking-tight xl:text-5xl">Toma mejores decisiones con cada movimiento.</h1><p className="mt-5 max-w-md text-base leading-7 text-slate-300">Organiza inventario, ventas, proveedores y operación diaria desde un solo lugar.</p>
          <div className="stagger-in mt-9 grid grid-cols-2 gap-3"><div className="rounded-3xl border border-white/10 bg-white/[.06] p-4 backdrop-blur"><ChartNoAxesCombined className="text-orange-300" size={22}/><p className="mt-3 text-sm font-semibold">Datos claros</p><p className="mt-1 text-xs leading-5 text-slate-400">Indicadores conectados a tus registros.</p></div><div className="rounded-3xl border border-white/10 bg-white/[.06] p-4 backdrop-blur"><PackageCheck className="text-orange-300" size={22}/><p className="mt-3 text-sm font-semibold">Inventario al día</p><p className="mt-1 text-xs leading-5 text-slate-400">Movimientos y existencias en contexto.</p></div></div>
        </div>
        <div className="relative flex items-center justify-between text-xs text-slate-400"><span>Hecho para negocios que crecen</span><span className="flex items-center gap-2"><Activity size={14} className="text-emerald-400"/> Operación centralizada</span></div>
      </section>
      <section className="flex items-center justify-center px-6 py-10 sm:px-10 lg:px-12 xl:px-16">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden"><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-3xl bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-lg"><Boxes size={25}/></div><p className="text-sm font-bold tracking-wide text-slate-900">MANAGER STOCK</p></div>
          <div><p className="text-sm font-semibold text-orange-600">Qué bueno tenerte de vuelta</p><h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Inicia sesión</h2><p className="mt-2 text-sm leading-6 text-slate-500">Ingresa con tu cuenta para continuar con la operación de tu negocio.</p></div>
          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div className="space-y-2"><Label htmlFor="email" className="text-slate-700">Correo electrónico</Label><Input id="email" type="email" autoComplete="username" placeholder="tu@negocio.com" value={email} onChange={e => setEmail(e.target.value)} required className="h-12 rounded-3xl border-slate-200 bg-white px-4 text-slate-900 placeholder:text-slate-400 focus-visible:ring-orange-500"/></div>
            <div className="space-y-2"><div className="flex items-center justify-between"><Label htmlFor="password" className="text-slate-700">Contraseña</Label></div><div className="relative"><Input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Ingresa tu contraseña" value={password} onChange={e => setPassword(e.target.value)} required className="h-12 rounded-3xl border-slate-200 bg-white px-4 pr-12 text-slate-900 placeholder:text-slate-400 focus-visible:ring-orange-500"/><button type="button" aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setShowPassword(v => !v)} className="absolute inset-y-0 right-3 flex items-center text-slate-400 hover:text-slate-700">{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></div>
            <Button type="submit" disabled={loading} className="h-12 w-full rounded-3xl bg-orange-600 text-sm font-semibold text-white shadow-lg shadow-orange-600/20 transition hover:bg-orange-700">{loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin"/>Validando acceso…</> : <>Ingresar a Manager Stock <ArrowUpRight className="ml-2 h-4 w-4"/></>}</Button>
          </form>
          {desktopMode && <div className="mt-5 rounded-3xl border border-orange-200 bg-orange-50/70 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-orange-700"><Monitor size={14}/> Modo escritorio</div>
            <p className="mt-1.5 text-xs leading-5 text-slate-600">Datos y cuentas demo incluidos en la app. Elige un negocio para entrar con un clic.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {DESKTOP_DEMO_ACCOUNTS.map(account => <button key={account.email} type="button" disabled={loading} onClick={() => void handleDemo(account.email, account.password)} className="rounded-3xl border border-orange-200/80 bg-white px-3 py-2 text-left shadow-sm transition hover:border-orange-300 hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-60">
                <span className="block text-xs font-semibold text-slate-800">{account.label}</span>
                <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-wide text-slate-500">{account.detail}</span>
              </button>)}
            </div>
          </div>}
          <div className="mt-6 flex gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-3.5"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"/><p className="text-xs leading-5 text-slate-600">{desktopMode ? 'Aplicación de escritorio: las cuentas demo están incluidas en este equipo y los cambios se guardan localmente.' : 'La cuenta y los permisos se validan en el servidor. No se aceptan credenciales de demostración.'}</p></div>
          <p className="mt-7 text-center text-sm text-slate-500">¿Todavía no tienes cuenta? <Link to="/register" className="font-semibold text-orange-700 hover:text-orange-800">Crear cuenta</Link></p>
        </div>
      </section>
    </div>
  </main>;
}
