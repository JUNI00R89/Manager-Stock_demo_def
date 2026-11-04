import { createBrowserRouter, Navigate, useLocation, useNavigate, useRouteError } from 'react-router';
import { useAuth } from './context/AuthContext';
import { useBusiness } from './context/BusinessContext';
import { canAccessPath } from './security/permissions';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { BusinessSetup } from './pages/BusinessSetup';
import { Dashboard } from './pages/Dashboard';
import { Products } from './pages/Products';
import { NewProduct } from './pages/NewProduct';
import { Sales } from './pages/Sales';
import { NewSale } from './pages/NewSale';
import { SaleDetail } from './pages/SaleDetail';
import { POS } from './pages/POS';
import { Suppliers } from './pages/Suppliers';
import { NewSupplier } from './pages/NewSupplier';
import { Notifications } from './pages/Notifications';
import { Subscription } from './pages/Subscription';
import { Settings } from './pages/Settings';
import { Tables } from './pages/restaurant/Tables';
import { Kitchen } from './pages/restaurant/Kitchen';
import { Rooms } from './pages/hotel/Rooms';
import { Availability } from './pages/hotel/Availability';
import { Housekeeping } from './pages/hotel/Housekeeping';
import { Locations } from './pages/warehouse/Locations';
import { Appointments } from './pages/services/Appointments';
import { Services } from './pages/services/Services';
import { Transfers } from './pages/inventory/Transfers';
import { PhysicalCount } from './pages/inventory/PhysicalCount';
import { Movements } from './pages/inventory/Movements';
import { UsersRoles } from './pages/UsersRoles';
import { Reports } from './pages/Reports';
import { ActivityLog } from './pages/ActivityLog';
import { PlatformAdmin } from './pages/PlatformAdmin';
import { SuspendedBusiness } from './pages/SuspendedBusiness';
import { LandingPage } from './pages/LandingPage';
import { Downloads } from './pages/Downloads';
import { AppShell } from './components/AppShell';

function Waiting() {
  return <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Verificando sesión y configuración…</div>;
}
function AccessDenied() {
  return <div className="flex min-h-screen items-center justify-center bg-background p-6"><div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm"><h1 className="text-2xl font-bold">Acceso denegado</h1><p className="mt-2 text-sm text-muted-foreground">Tu rol no tiene permiso para abrir esta sección. Si necesitas acceso, contacta al propietario del negocio.</p><a className="mt-5 inline-flex rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white" href="/dashboard">Volver al panel</a></div></div>;
}
function NotFound() {
  return <div className="flex min-h-screen items-center justify-center bg-background p-6"><div className="text-center"><p className="text-sm font-semibold tracking-widest text-orange-600">ERROR 404</p><h1 className="mt-2 text-3xl font-bold">Página no encontrada</h1><p className="mt-2 text-muted-foreground">La ruta no existe o fue movida.</p><a className="mt-5 inline-flex rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white" href="/">Ir al inicio</a></div></div>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { isConfigured, isLoading: businessLoading, config } = useBusiness();
  const location = useLocation();
  if (loading || (user && user.role !== 'superadmin' && businessLoading)) return <Waiting />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'superadmin') return location.pathname === '/platform' ? <>{children}</> : <Navigate to="/platform" replace />;
  // Suspended owners must render the suspension/support screen even though the
  // business config endpoint is intentionally unavailable while the account is suspended.
  if (user.businessActive === false) {
    if (location.pathname === '/suspended') return <>{children}</>;
    return <Navigate to="/suspended" replace />;
  }
  if (location.pathname === '/suspended') return <Navigate to={isConfigured ? '/dashboard' : '/business-setup'} replace />;
  if (location.pathname !== '/business-setup' && !isConfigured) return <Navigate to="/business-setup" replace />;
  if (!canAccessPath(location.pathname, user.role, config, user.customRoleId ? (user.permissions ?? []) : undefined)) return <AccessDenied />;
  return <>{children}</>;
}

function BusinessSetupRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { isConfigured, isLoading } = useBusiness();
  const location = useLocation();
  const reconfiguring = new URLSearchParams(location.search).get('reconfigure') === '1';
  if (loading || (user && user.role !== 'superadmin' && isLoading)) return <Waiting />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'superadmin') return <Navigate to="/platform" replace />;
  if (user.businessActive === false) return <Navigate to="/suspended" replace />;
  if (isConfigured && !reconfiguring) return <Navigate to="/dashboard" replace />;
  if (user.role !== 'owner') return <AccessDenied />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { isConfigured, isLoading } = useBusiness();
  if (loading || (user && user.role !== 'superadmin' && isLoading)) return <Waiting />;
  if (user?.role === 'superadmin') return <Navigate to="/platform" replace />;
  if (user) return <Navigate to={user.businessActive === false ? '/suspended' : isConfigured ? '/dashboard' : '/business-setup'} replace />;
  return <>{children}</>;
}
const protect = (element: React.ReactNode) => <ProtectedRoute>{element}</ProtectedRoute>;

function RouteErrorFallback() {
  const error = useRouteError();
  const navigate = useNavigate();
  const message = import.meta.env.DEV && error instanceof Error ? error.message : 'Ocurrió un error al cargar esta pantalla. Puedes volver a intentarlo o regresar al panel.';
  return <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground"><section className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-xl"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-rose-50 text-rose-700"><span className="text-xl font-bold">!</span></div><p className="mt-4 text-xs font-semibold uppercase tracking-[.18em] text-rose-700">Error de aplicación</p><h1 className="mt-2 text-2xl font-bold">No se pudo mostrar esta pantalla</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">{message}</p><div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row"><button type="button" onClick={() => window.location.reload()} className="rounded-xl bg-[var(--brand-primary)] px-4 py-3 text-sm font-semibold text-white">Intentar nuevamente</button><button type="button" onClick={() => navigate('/dashboard')} className="rounded-xl border border-border px-4 py-3 text-sm font-semibold">Volver al panel</button></div></section></main>;
}

const appRoute = (path: string, element: React.ReactNode) => ({ path, element, errorElement: <RouteErrorFallback /> });

// El marco (sidebar, header, barra inferior) vive en una ruta sin path que
// persiste durante toda la sesión: cada página sigue montando su propio <Layout>,
// que dentro de ese shell es transparente. Las URLs, los permisos y la lógica de
// cada pantalla son exactamente los mismos; solo cambia dónde se monta el marco.
export const router = createBrowserRouter([
  appRoute('/', <PublicRoute><LandingPage /></PublicRoute>),
  appRoute('/descargas', <Downloads />),
  appRoute('/login', <PublicRoute><Login /></PublicRoute>),
  appRoute('/register', <PublicRoute><Register /></PublicRoute>),
  appRoute('/business-setup', <BusinessSetupRoute><BusinessSetup /></BusinessSetupRoute>),
  appRoute('/suspended', protect(<SuspendedBusiness />)),
  appRoute('/platform', protect(<PlatformAdmin />)),
  {
    // Ruta sin path: aporta el marco persistente y la protección compartida.
    element: protect(<AppShell />),
    errorElement: <RouteErrorFallback />,
    children: [
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'pos', element: <POS /> },
      { path: 'sales', element: <Sales /> },
      { path: 'sales/new', element: <NewSale /> },
      { path: 'sales/:id', element: <SaleDetail /> },
      { path: 'reports', element: <Reports /> },
      { path: 'activity', element: <ActivityLog /> },
      { path: 'products', element: <Products /> },
      { path: 'products/new', element: <NewProduct /> },
      { path: 'products/:id/edit', element: <NewProduct /> },
      { path: 'suppliers', element: <Suppliers /> },
      { path: 'suppliers/new', element: <NewSupplier /> },
      { path: 'inventory/transfers', element: <Transfers /> },
      { path: 'inventory/physical-count', element: <PhysicalCount /> },
      { path: 'inventory/movements', element: <Movements /> },
      { path: 'restaurant/tables', element: <Tables /> },
      { path: 'restaurant/kitchen', element: <Kitchen /> },
      { path: 'hotel/rooms', element: <Rooms /> },
      { path: 'hotel/availability', element: <Availability /> },
      { path: 'hotel/housekeeping', element: <Housekeeping /> },
      { path: 'warehouse/locations', element: <Locations /> },
      { path: 'services', element: <Services /> },
      { path: 'services/appointments', element: <Appointments /> },
      { path: 'notifications', element: <Notifications /> },
      { path: 'users-roles', element: <UsersRoles /> },
      { path: 'subscription', element: <Subscription /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
  appRoute('*', <NotFound />),
]);
