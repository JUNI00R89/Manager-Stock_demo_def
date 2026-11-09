import { lazy, Suspense } from 'react';
const CountReviews = lazy(() => import('./pages/warehouse/CountReviews').then(module => ({ default: module.CountReviews })));
const HotelToday = lazy(() => import('./pages/hotel/Today').then(module => ({ default: module.HotelToday })));
const Customers = lazy(() => import('./pages/Customers').then(module => ({ default: module.Customers })));
const Billing = lazy(() => import('./pages/Billing').then(module => ({ default: module.Billing })));
import { createBrowserRouter, Navigate, useLocation, useNavigate, useRouteError } from 'react-router';
import { useAuth } from './context/AuthContext';
import { useBusiness } from './context/BusinessContext';
import { canAccessPath } from './security/permissions';
const Login = lazy(() => import('./pages/Login').then(module => ({ default: module.Login })));
const Register = lazy(() => import('./pages/Register').then(module => ({ default: module.Register })));
const BusinessSetup = lazy(() => import('./pages/BusinessSetup').then(module => ({ default: module.BusinessSetup })));
const Dashboard = lazy(() => import('./pages/Dashboard').then(module => ({ default: module.Dashboard })));
const Products = lazy(() => import('./pages/Products').then(module => ({ default: module.Products })));
const NewProduct = lazy(() => import('./pages/NewProduct').then(module => ({ default: module.NewProduct })));
const Sales = lazy(() => import('./pages/Sales').then(module => ({ default: module.Sales })));
const NewSale = lazy(() => import('./pages/NewSale').then(module => ({ default: module.NewSale })));
const SaleDetail = lazy(() => import('./pages/SaleDetail').then(module => ({ default: module.SaleDetail })));
const POS = lazy(() => import('./pages/POS').then(module => ({ default: module.POS })));
const Suppliers = lazy(() => import('./pages/Suppliers').then(module => ({ default: module.Suppliers })));
const NewSupplier = lazy(() => import('./pages/NewSupplier').then(module => ({ default: module.NewSupplier })));
const Notifications = lazy(() => import('./pages/Notifications').then(module => ({ default: module.Notifications })));
const Subscription = lazy(() => import('./pages/Subscription').then(module => ({ default: module.Subscription })));
const Settings = lazy(() => import('./pages/Settings').then(module => ({ default: module.Settings })));
const Tables = lazy(() => import('./pages/restaurant/Tables').then(module => ({ default: module.Tables })));
const Kitchen = lazy(() => import('./pages/restaurant/Kitchen').then(module => ({ default: module.Kitchen })));
const Waiter = lazy(() => import('./pages/restaurant/Waiter').then(module => ({ default: module.Waiter })));
const Orders = lazy(() => import('./pages/restaurant/Orders').then(module => ({ default: module.Orders })));
const RestaurantCatalog = lazy(() => import('./pages/restaurant/Catalog').then(module => ({ default: module.Catalog })));
const RestaurantSettingsPage = lazy(() => import('./pages/restaurant/Settings').then(module => ({ default: module.RestaurantSettingsPage })));
const HotelIncome = lazy(() => import('./pages/hotel/Income').then(module => ({ default: module.HotelIncome })));
const Rooms = lazy(() => import('./pages/hotel/Rooms').then(module => ({ default: module.Rooms })));
const Availability = lazy(() => import('./pages/hotel/Availability').then(module => ({ default: module.Availability })));
const Housekeeping = lazy(() => import('./pages/hotel/Housekeeping').then(module => ({ default: module.Housekeeping })));
const Locations = lazy(() => import('./pages/warehouse/Locations').then(module => ({ default: module.Locations })));
const WarehouseOverview = lazy(() => import('./pages/warehouse/Overview').then(module => ({ default: module.WarehouseOverview })));
const WarehouseEntries = lazy(() => import('./pages/warehouse/Entries').then(module => ({ default: module.WarehouseEntries })));
const WarehouseExits = lazy(() => import('./pages/warehouse/Exits').then(module => ({ default: module.WarehouseExits })));
const WarehouseAdjustments = lazy(() => import('./pages/warehouse/Adjustments').then(module => ({ default: module.WarehouseAdjustments })));
const WarehouseLots = lazy(() => import('./pages/warehouse/Lots').then(module => ({ default: module.WarehouseLots })));
const WarehousePurchaseOrders = lazy(() => import('./pages/warehouse/PurchaseOrders').then(module => ({ default: module.WarehousePurchaseOrders })));
const WarehouseTransfers = lazy(() => import('./pages/warehouse/Transfers').then(module => ({ default: module.WarehouseTransfers })));
const WarehouseReports = lazy(() => import('./pages/warehouse/Reports').then(module => ({ default: module.WarehouseReports })));
const WarehouseSettings = lazy(() => import('./pages/warehouse/Settings').then(module => ({ default: module.WarehouseSettings })));
const Recipes = lazy(() => import('./pages/restaurant/Recipes').then(module => ({ default: module.Recipes })));
const Appointments = lazy(() => import('./pages/services/Appointments').then(module => ({ default: module.Appointments })));
const Services = lazy(() => import('./pages/services/Services').then(module => ({ default: module.Services })));
const Movements = lazy(() => import('./pages/inventory/Movements').then(module => ({ default: module.Movements })));
const UsersRoles = lazy(() => import('./pages/UsersRoles').then(module => ({ default: module.UsersRoles })));
const Reports = lazy(() => import('./pages/Reports').then(module => ({ default: module.Reports })));
const ActivityLog = lazy(() => import('./pages/ActivityLog').then(module => ({ default: module.ActivityLog })));
const PlatformAdmin = lazy(() => import('./pages/PlatformAdmin').then(module => ({ default: module.PlatformAdmin })));
const SuspendedBusiness = lazy(() => import('./pages/SuspendedBusiness').then(module => ({ default: module.SuspendedBusiness })));
const LandingPage = lazy(() => import('./pages/LandingPage').then(module => ({ default: module.LandingPage })));
const Downloads = lazy(() => import('./pages/Downloads').then(module => ({ default: module.Downloads })));
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

const loadingPage = <div role="status" className="p-8 text-muted-foreground">Cargando pantalla…</div>;
const appRoute = (path: string, element: React.ReactNode) => ({ path, element: <Suspense fallback={loadingPage}>{element}</Suspense>, errorElement: <RouteErrorFallback /> });

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
      { path: 'inventory/transfers', element: <Navigate to="/warehouse/transfers" replace /> },
      { path: 'inventory/physical-count', element: <Navigate to="/warehouse/counts" replace /> },
      { path: 'inventory/movements', element: <Navigate to="/warehouse/movements" replace /> },
      { path: 'warehouse', element: <WarehouseOverview /> },
      { path: 'warehouse/entries', element: <WarehouseEntries /> },
      { path: 'warehouse/exits', element: <WarehouseExits mode="exit" /> },
      { path: 'warehouse/waste', element: <WarehouseExits mode="waste" /> },
      { path: 'warehouse/adjustments', element: <WarehouseAdjustments /> },
      { path: 'warehouse/lots', element: <WarehouseLots /> },
      { path: 'warehouse/purchase-orders', element: <WarehousePurchaseOrders /> },
      { path: 'warehouse/counts', element: <CountReviews /> },
      { path: 'warehouse/transfers', element: <WarehouseTransfers /> },
      { path: 'warehouse/locations', element: <Locations /> },
      { path: 'warehouse/movements', element: <Movements /> },
      { path: 'warehouse/reports', element: <WarehouseReports /> },
      { path: 'warehouse/settings', element: <WarehouseSettings /> },
      { path: 'restaurant/tables', element: <Tables /> },
      { path: 'restaurant/kitchen', element: <Kitchen /> },
      { path: 'restaurant/waiter', element: <Waiter /> },
      { path: 'restaurant/orders', element: <Orders /> },
      { path: 'restaurant/catalog', element: <RestaurantCatalog /> },
      { path: 'restaurant/recipes', element: <Recipes /> },
      { path: 'restaurant/settings', element: <RestaurantSettingsPage /> },
      { path: 'customers', element: <Customers /> },
      { path: 'billing', element: <Billing /> },
      { path: 'hotel/today', element: <HotelToday /> },
      { path: 'hotel/income', element: <HotelIncome /> },
      { path: 'hotel/rooms', element: <Rooms /> },
      { path: 'hotel/availability', element: <Availability /> },
      { path: 'hotel/housekeeping', element: <Housekeeping /> },
      { path: 'services', element: <Services /> },
      { path: 'services/appointments', element: <Appointments /> },
      { path: 'notifications', element: <Notifications /> },
      { path: 'users-roles', element: <UsersRoles /> },
      { path: 'subscription', element: <Subscription /> },
      { path: 'settings', element: <Settings /> },
    ].map(route => ({ ...route, element: <Suspense fallback={loadingPage}>{route.element}</Suspense> })),
  },
  appRoute('*', <NotFound />),
]);
