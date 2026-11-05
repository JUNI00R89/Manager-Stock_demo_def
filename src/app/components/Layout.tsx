import { ReactNode, createContext, useContext, useState, useEffect, useLayoutEffect, type MouseEvent as ReactMouseEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { useBusiness, DEFAULT_BUSINESS_THEMES, applyTheme, resolveThemeColors } from '../context/BusinessContext';
import { useTheme } from '../context/ThemeContext';
import {
  LayoutDashboard, Package, ShoppingCart, CreditCard, LogOut, Bell, Database, Barcode,
  Truck, Store, UtensilsCrossed, Bed, MapPin, Settings, Users, Moon,
  Sun, ChevronLeft, ChevronRight, Menu, X,
  ChefHat, CalendarDays, Building2, MoreHorizontal, Warehouse,
  Building, TrendingUp, FileBarChart, Scissors, ClipboardList, BookOpen,
  ArrowDownToLine, ArrowUpFromLine, AlertTriangle, Scale, ClipboardCheck, ArrowLeftRight, Boxes
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';

import { dataService } from '../services/dataService';
import { isDesktopMode } from '../services/desktop';
import { motion, AnimatePresence } from 'motion/react';
import { canAccessPath, roleLabel } from '../security/permissions';
import { toast } from 'sonner';
import { ThemeSweep } from './ThemeSweep';

// Continuidad visual entre navegaciones: en el shell persistente (AppShell) la
// interfaz no se vuelve a montar y el indicador guarda su posición en el estado.
// Si algún Layout se monta suelto (fuera del shell), la última posición de los
// indicadores se guarda en el módulo para poder deslizarlos desde donde estaban
// (spring 300/30).
let lastSidebarIndicator: { top: number; height: number } | null = null;
let lastBottomIndicatorIndex: number | null = null;

// Las páginas montan su propio <Layout>; dentro del shell este contexto hace que
// ese Layout sea transparente (solo devuelve el contenido), así la sidebar y el
// header se montan una única vez en toda la sesión.
const ChromeContext = createContext(false);

interface LayoutProps {
  children: ReactNode;
}

/** Punto de entrada de View Transitions (API todavía no disponible en todos los navegadores). */
type ViewTransitionStarter = (callback: () => Promise<void> | void) => {
  ready: Promise<void>;
  finished?: Promise<void>;
};

/** Tentáculos del barrido (coordenadas normalizadas 0..1 del giro completo). */
const VENOM_SPIKES = [
  { at: 0.04, width: 0.055, length: 0.6 },
  { at: 0.22, width: 0.04, length: 0.34 },
  { at: 0.41, width: 0.07, length: 0.78 },
  { at: 0.58, width: 0.035, length: 0.28 },
  { at: 0.74, width: 0.05, length: 0.5 },
  { at: 0.9, width: 0.032, length: 0.24 },
];

/**
 * Borde vivo de la masa: lóbulos orgánicos + tentáculos afilados que se estiran
 * hacia afuera. Al girar (`spin`) los tentáculos salen disparados en nuevas
 * direcciones, así el borde nunca parece un círculo perfecto.
 */
function venomBlob(cx: number, cy: number, radius: number, options: { spin: number; wobble: number; tendril: number }, points = 72) {
  const { spin, wobble, tendril } = options;
  const coords: string[] = [];
  for (let index = 0; index < points; index += 1) {
    const t = index / points;
    const angle = t * Math.PI * 2 + spin;
    let factor = 1
      + Math.sin(angle * 3 + spin * 1.7) * wobble * 0.6
      + Math.sin(angle * 6.5 - spin * 2.3) * wobble * 0.3
      + Math.sin(angle * 11 + 1.3) * wobble * 0.15;
    for (const spike of VENOM_SPIKES) {
      const straight = Math.abs(t - spike.at);
      const delta = Math.min(straight, 1 - straight) / spike.width;
      // Gaussianas angulares: cada tentáculo estira el borde con punta afilada.
      if (delta < 3) factor += Math.exp(-delta * delta) * spike.length * tendril;
    }
    const distance = radius * factor;
    coords.push(`${(cx + Math.cos(angle) * distance).toFixed(1)}px ${(cy + Math.sin(angle) * distance).toFixed(1)}px`);
  }
  return `polygon(${coords.join(', ')})`;
}

function nextFrames(count = 2) {
  return new Promise<void>(resolve => {
    const step = (remaining: number) => {
      if (remaining <= 0) resolve();
      else window.requestAnimationFrame(() => step(remaining - 1));
    };
    step(count);
  });
}

/**
 * Revela el tema nuevo como una masa de simbionte que brota en el botón
 * sol/luna (~0.4 s): estallido instantáneo, ondulación con tentáculos y giro
 * hasta envolver la pantalla. El tema anterior se escapa (escala) al ser absorbido.
 */
function animateThemeReveal(origin: { x: number; y: number }) {
  const reach = Math.hypot(
    Math.max(origin.x, window.innerWidth - origin.x),
    Math.max(origin.y, window.innerHeight - origin.y),
  ) + 160;
  // Radio relativo en cada tiempo: avance lineal + UNA sola curva de easing en
  // toda la animación (curvas por keyframe reiniciaban la velocidad en cada
  // tiempo y se sentía a tirones). La ondulación y los tentáculos se desvanecen
  // al acercarse a pantalla completa.
  const beats = [
    { radius: 0.02, wobble: 0.03, tendril: 0.8, spin: -0.2 },
    { radius: 0.15, wobble: 0.12, tendril: 0.7, spin: -0.1 },
    { radius: 0.4, wobble: 0.18, tendril: 0.5, spin: 0.04 },
    { radius: 0.65, wobble: 0.12, tendril: 0.35, spin: 0.15 },
    { radius: 0.85, wobble: 0.06, tendril: 0.2, spin: 0.3 },
    { radius: 1, wobble: 0.02, tendril: 0.1, spin: 0.4 },
  ];
  const duration = 750;
  const clipPath = beats.map(beat => ({
    clipPath: venomBlob(origin.x, origin.y, reach * beat.radius, beat),
  }));
  document.documentElement.animate(clipPath, {
    duration,
    easing: 'cubic-bezier(0.2, 0.85, 0.25, 1)',
    pseudoElement: '::view-transition-new(root)',
  });
  // El tema anterior se hunde al ser absorbido (escala hacia afuera, sin salirse).
  document.documentElement.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }],
    { duration, easing: 'cubic-bezier(0.3, 0, 0.2, 1)', pseudoElement: '::view-transition-old(root)' },
  );
}

interface NavItem {
  path: string;
  icon: React.ElementType;
  label: string;
  badge?: number;
  group?: string;
}

const BUSINESS_LABELS: Record<string, string> = {
  retail: 'Tienda / Retail',
  restaurant: 'Negocio de comidas',
  hotel: 'Hotel',
  warehouse: 'Bodega',
  services: 'Servicios',
};

function LayoutShell({ children }: LayoutProps) {
  const { user, logout } = useAuth();
  const { config, setConfig } = useBusiness();
  const { isDark, setTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    localStorage.getItem('sidebarCollapsed') === 'true'
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  // Barrido de tema: forma orgánica que nace en el botón sol/luna.
  const [themeSweep, setThemeSweep] = useState<{ x: number; y: number; mode: 'light' | 'dark' } | null>(null);
  // Indicador que se desliza hasta el ítem activo de la sidebar.
  const [sidebarIndicator, setSidebarIndicator] = useState<{ from: { top: number; height: number } | null; to: { top: number; height: number } } | null>(null);
  // Varias entradas de la lista pueden compartir ruta (p. ej. "Pedidos /
  // Preparación" y "Domicilios" abren el mismo módulo). El resaltado y el
  // indicador siguen a la última pulsada para que cada enlace responda a su clic.
  const [activeNavLabel, setActiveNavLabel] = useState<string | null>(null);

  const [lowStockCount, setLowStockCount] = useState(0);
  const [databaseConnected, setDatabaseConnected] = useState<boolean | null>(null);

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    let active = true;
    const refreshDataStatus = async () => {
      try {
        const connected = await dataService.apiIsAvailable();
        if (!active) return;
        setDatabaseConnected(connected);
        if (!config?.features.inventory) {
          setLowStockCount(0);
          return;
        }
        const products = await dataService.getProducts();
        if (active) setLowStockCount(products.filter(product => product.stock <= product.minStock).length);
      } catch {
        // An authenticated session stays server-backed: report disconnection instead of implying local saves.
        if (active) setDatabaseConnected(false);
      }
    };
    void refreshDataStatus();
    const timer = window.setInterval(() => void refreshDataStatus(), 20000);
    return () => { active = false; window.clearInterval(timer); };
  }, [config?.features.inventory]);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  /**
   * Guarda la preferencia de tema del negocio. La parte visual ya se aplicó antes
   * (applyTheme), así que aquí solo se persiste. No mostramos un aviso al cambiar
   * de tema: el cambio visual ya es evidente. Solo se avisa si falla el guardado.
   */
  const persistTheme = async (nextMode: 'light' | 'dark') => {
    // Sin negocio configurado el tema vive solo en ThemeContext (localStorage).
    if (!config) return;
    const current = config.theme ?? DEFAULT_BUSINESS_THEMES[config.type];
    try {
      await setConfig({ ...config, theme: { ...current, mode: nextMode, customized: true } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el tema.');
    }
  };

  /** Paleta vigente con el modo que va a entrar (claro u oscuro). */
  const themeFor = (mode: 'light' | 'dark') => ({
    ...(config?.theme ?? DEFAULT_BUSINESS_THEMES[config?.type ?? 'retail']),
    mode,
  });

  /** Fondo del tema que entra: lo usan el halo del revelado y el barrido de respaldo. */
  const incomingThemeColor = (mode: 'light' | 'dark') => {
    const themeRef = config?.theme ?? DEFAULT_BUSINESS_THEMES[config?.type ?? 'retail'];
    return resolveThemeColors({ ...themeRef, mode }).background;
  };

  /**
   * El botón sol/luna cambia el tema con una masa de simbionte que brota en el
   * propio botón (borde irregular con tentáculos que giran, halo del color que
   * entra y el tema viejo hundiéndose al ser absorbido):
   *  · Navegadores con View Transitions: el snapshot del tema nuevo se revela
   *    animando `clip-path` sobre ::view-transition-new(root) durante ~0.45 s.
   *  · Resto: <ThemeSweep> dibuja la misma masa con motion (onda + tentáculos).
   * El tema se aplica al DOM de forma SINCRÓNICA —nada de awaits dentro del
   * callback— para que el snapshot nuevo ya salga con el color nuevo y siempre
   * haya algo que revelar; el guardado en el servidor va por detrás.
   * Con prefers-reduced-motion el tema cambia al instante.
   */
  const handleThemeToggle = (event?: ReactMouseEvent<HTMLElement>) => {
    const nextMode: 'light' | 'dark' = isDark ? 'light' : 'dark';
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rect = event?.currentTarget?.getBoundingClientRect();
    if (themeSweep) return;

    // Sin animación (o sin posición del botón): aplicar el tema y guardar.
    if (!rect || reduceMotion) {
      applyTheme(themeFor(nextMode));
      setTheme(nextMode);
      void persistTheme(nextMode);
      return;
    }

    const origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

    const viewTransitionDocument = document as unknown as { startViewTransition?: ViewTransitionStarter };
    if (typeof viewTransitionDocument.startViewTransition === 'function') {
      const transition = viewTransitionDocument.startViewTransition(() => {
        // Sincrónico a propósito: el snapshot nuevo se captura con el tema ya
        // aplicado, así el clip-path revela un cambio real (antes se esperaba la
        // respuesta del servidor y, con renders congelados, la transición salía
        // sin diferencia visible).
        applyTheme(themeFor(nextMode));
        setTheme(nextMode);
      });
      void transition.ready.then(() => animateThemeReveal(origin)).catch(() => undefined);
      void transition.finished?.catch(() => undefined);
      void persistTheme(nextMode);
      return;
    }

    // Fallback (sin View Transitions): la forma cubre la pantalla con el color que
    // entra y el tema se aplica debajo (ver coverAndPersistTheme).
    setThemeSweep({ ...origin, mode: nextMode });
  };

  // Color del tema que entra: la forma lo usa mientras cubre la pantalla, así el
  // cambio de tema debajo pasa inadvertido.
  const themeSweepColor = incomingThemeColor(themeSweep?.mode ?? (isDark ? 'light' : 'dark'));

  const coverAndPersistTheme = async () => {
    if (!themeSweep) return;
    // La forma ya cubre la pantalla: se aplica el tema debajo y se esperan un par
    // de frames para que el nuevo fondo esté pintado antes de revelarlo. El guardado
    // va por detrás para no dejar la pantalla cubierta esperando al servidor.
    applyTheme(themeFor(themeSweep.mode));
    setTheme(themeSweep.mode);
    await nextFrames();
    void persistTheme(themeSweep.mode);
  };

  const getNavItems = (): NavItem[] => {
    const items: NavItem[] = [
      { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', group: 'general' },
    ];

    if (config?.features.pos) {
      items.push({ path: '/pos', icon: Store, label: 'Punto de Venta', group: 'ventas' });
    }
    if (config?.features.pos) {
      items.push({ path: '/sales', icon: TrendingUp, label: 'Ventas', group: 'ventas' });
      items.push({ path: '/reports', icon: FileBarChart, label: 'Reportes', group: 'ventas' });
    }

    if (config?.type === 'restaurant') {
      items.push(
        { path: '/restaurant/waiter', icon: UtensilsCrossed, label: 'Mesero', group: 'tipo' },
        { path: '/restaurant/kitchen', icon: ChefHat, label: 'Cocina', group: 'tipo' },
        { path: '/restaurant/orders', icon: ClipboardList, label: 'Pedidos', group: 'tipo' },
        { path: '/restaurant/catalog', icon: BookOpen, label: 'Catálogo', group: 'tipo' },
        { path: '/restaurant/settings', icon: Settings, label: 'Ajustes del restaurante', group: 'tipo' },
      );
    }
    if (config?.features.rooms) {
      items.push({ path: '/hotel/rooms', icon: Bed, label: 'Habitaciones', group: 'tipo' });
      items.push({ path: '/hotel/availability', icon: CalendarDays, label: 'Disponibilidad', group: 'tipo' });
      items.push({ path: '/hotel/housekeeping', icon: Building2, label: 'Limpieza', group: 'tipo' });
    }
    if (config?.type === 'services' && config.features.services) {
      items.push({ path: '/services', icon: Scissors, label: 'Servicios', group: 'tipo' });
      items.push({ path: '/services/appointments', icon: CalendarDays, label: 'Agenda de citas', group: 'tipo' });
    }
    if (config?.features.inventory) {
      items.push(
        { path: '/warehouse', icon: Warehouse, label: 'Bodega', group: 'inventario' },
        { path: '/warehouse/entries', icon: ArrowDownToLine, label: 'Entradas', group: 'inventario' },
        { path: '/warehouse/exits', icon: ArrowUpFromLine, label: 'Salidas', group: 'inventario' },
        { path: '/warehouse/waste', icon: AlertTriangle, label: 'Mermas', group: 'inventario' },
        { path: '/warehouse/adjustments', icon: Scale, label: 'Ajustes', group: 'inventario' },
        { path: '/warehouse/purchase-orders', icon: ShoppingCart, label: 'Compras', group: 'inventario' },
        { path: '/warehouse/counts', icon: ClipboardCheck, label: 'Conteos', group: 'inventario' },
        { path: '/warehouse/transfers', icon: ArrowLeftRight, label: 'Traslados', group: 'inventario' },
        { path: '/warehouse/locations', icon: MapPin, label: 'Ubicaciones', group: 'inventario' },
        { path: '/warehouse/lots', icon: Boxes, label: 'Lotes y vencimientos', group: 'inventario' },
        { path: '/warehouse/movements', icon: ClipboardList, label: 'Movimientos', group: 'inventario' },
        { path: '/warehouse/reports', icon: FileBarChart, label: 'Reportes de bodega', group: 'inventario' },
        { path: '/warehouse/settings', icon: Settings, label: 'Configuración de bodega', group: 'inventario' },
      );
    }

    const foodMenuEnabled = config?.type === 'restaurant' && (config.foodConfig?.activeModules ?? []).includes('menu');
    if (config?.features.inventory || foodMenuEnabled) {
      items.push({ path: '/products', icon: Package, label: foodMenuEnabled ? 'Menú / Productos' : 'Productos', group: 'inventario' });
    }
    if (config?.features.inventory) {
      items.push({ path: '/suppliers', icon: Truck, label: 'Proveedores', group: 'inventario' });
    }
    if (config?.type === 'restaurant' && (config.features.inventory || foodMenuEnabled)) {
      items.push({ path: '/restaurant/recipes', icon: BookOpen, label: 'Recetas y costos', group: 'inventario' });
    }

    items.push(
      { path: '/notifications', icon: Bell, label: 'Alertas', badge: lowStockCount, group: 'sistema' },
      { path: '/users-roles', icon: Users, label: 'Usuarios y permisos', group: 'sistema' },
      { path: '/settings', icon: Settings, label: 'Configuración', group: 'sistema' },
    );

    return items;
  };

  const navItems = getNavItems().filter(item => {
    const hasRoutePermission = canAccessPath(item.path, user?.role, config, user?.customRoleId ? (user.permissions ?? []) : undefined);
    const hasAlertSourcePermission = item.path !== '/notifications' || !user?.customRoleId || Boolean(user.permissions?.some(permission => ['catalog.view', 'sales.view'].includes(permission)));
    return hasRoutePermission && hasAlertSourcePermission;
  });

  const getMobileBottomItems = (): NavItem[] => {
    const always = [{ path: '/dashboard', icon: LayoutDashboard, label: 'Inicio', group: 'general' }];
    if (config?.type === 'restaurant') {
      return [
        always[0],
        { path: '/restaurant/waiter', icon: UtensilsCrossed, label: 'Mesero', group: 'tipo' },
        { path: '/restaurant/kitchen', icon: ChefHat, label: 'Cocina', group: 'tipo' },
        { path: '/restaurant/orders', icon: ClipboardList, label: 'Pedidos', group: 'tipo' },
        { path: '__more__', icon: MoreHorizontal, label: 'Más', group: 'sistema' },
      ];
    }
    const type: NavItem[] = [];
    if (config?.features.pos) type.push({ path: '/pos', icon: Store, label: 'POS', group: 'ventas' });
    if (config?.features.tables) type.push({ path: '/restaurant/tables', icon: UtensilsCrossed, label: 'Mesas', group: 'tipo' });
    if (config?.features.rooms) type.push({ path: '/hotel/rooms', icon: Bed, label: 'Hab.', group: 'tipo' });
    if (config?.type === 'services' && config.features.services) type.push({ path: '/services', icon: Scissors, label: 'Servicios', group: 'tipo' });
    const foodMenuEnabled = false;
    if (config?.features.inventory || foodMenuEnabled) type.push({ path: '/products', icon: Package, label: foodMenuEnabled ? 'Menú' : 'Productos', group: 'inventario' });

    const second: NavItem[] = config?.features.pos
      ? [{ path: '/sales', icon: TrendingUp, label: 'Ventas', group: 'ventas' }]
      : [{ path: '/notifications', icon: Bell, label: 'Alertas', badge: lowStockCount, group: 'sistema' }];

    const notif: NavItem = { path: '/notifications', icon: Bell, label: 'Alertas', badge: lowStockCount, group: 'sistema' };
    const more: NavItem = { path: '__more__', icon: MoreHorizontal, label: 'Más', group: 'sistema' };

    // Sin dedupe, con el POS desactivado entraba dos veces "Alertas"
    // (second + notif): clave repetida en React, doble resaltado y una
    // posición del indicador calculada sobre un total inflado.
    const result: NavItem[] = [];
    for (const item of [...always, ...(type.length ? [type[0]] : []), ...second, notif, more]) {
      if (item.path !== '__more__' && result.some(existing => existing.path === item.path)) continue;
      result.push(item);
    }
    return result.slice(0, 5);
  };

  const mobileBottomItems = getMobileBottomItems().filter(item => {
    if (item.path === '__more__') return true;
    const hasRoutePermission = canAccessPath(item.path, user?.role, config, user?.customRoleId ? (user.permissions ?? []) : undefined);
    const hasAlertSourcePermission = item.path !== '/notifications' || !user?.customRoleId || Boolean(user.permissions?.some(permission => ['catalog.view', 'sales.view'].includes(permission)));
    return hasRoutePermission && hasAlertSourcePermission;
  });

  // El mesero usa su propia barra de dos pestañas pegada al borde inferior.
  const hideGlobalMobileNav = location.pathname === '/restaurant/waiter';

  const groupLabels: Record<string, string> = {
    general: 'General',
    ventas: 'Ventas',
    tipo: config?.type === 'restaurant'
        ? 'Negocio de comidas'
        : config?.type === 'hotel' ? 'Hotel'
        : config?.type === 'services' ? 'Servicios'
        : config?.type === 'warehouse' ? 'Almacén' : 'Módulo',
    inventario: 'Inventario',
    sistema: 'Sistema',
  };

  const groups = Array.from(new Set(navItems.map(i => i.group!)));

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');

  const activeMobileIndex = mobileBottomItems.findIndex(item => item.path !== '__more__' && isActive(item.path));

  /**
   * Desempate entre entradas con la misma ruta: sin él, "Pedidos / Preparación"
   * y "Domicilios" (ambos en /restaurant/kitchen) quedaban marcados a la vez y
   * el indicador siempre medía el primero, con lo que pulsar "Domicilios" no
   * producía ningún cambio visible.
   */
  const activeNavItems = navItems.filter(item => isActive(item.path));
  const activeNavItem = activeNavItems.find(item => item.label === activeNavLabel) ?? activeNavItems[0] ?? null;
  const isActiveNavItem = (item: NavItem) =>
    activeNavItem !== null && activeNavItem.path === item.path && activeNavItem.label === item.label;

  /**
   * El indicador vive dentro del <nav> que tiene scroll, así que su `top` se
   * expresa en coordenadas de contenido y hay que medir el ítem activo sumando
   * el scroll del contenedor. Midiendo solo en viewport el indicador quedaba
   * desplazado tantos píxeles como el scroll: al navegar a los últimos ítems
   * (Domicilios, Configuración) no llegaba y se posicionaba sobre otros.
   */
  useLayoutEffect(() => {
    const measure = () => {
      const link = document.querySelector<HTMLElement>('[data-sidebar-active="true"]');
      const nav = document.querySelector<HTMLElement>('[data-sidebar-nav="true"]');
      if (!link || !nav || link.offsetParent === null) {
        setSidebarIndicator(null);
        return;
      }
      // Si el ítem activo quedó fuera del área visible, se trae a la vista
      // (solo hace scroll cuando hace falta) antes de posicionar el indicador.
      link.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const linkRect = link.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();
      const to = { top: linkRect.top - navRect.top + nav.scrollTop, height: linkRect.height };
      const from = lastSidebarIndicator;
      lastSidebarIndicator = to;
      setSidebarIndicator(previous => (
        previous && previous.to.top === to.top && previous.to.height === to.height ? previous : { from, to }
      ));
    };
    // activeNavLabel entra como dependencia: al pulsar un segundo enlace de la
    // misma ruta (Domicilios sobre Pedidos) la URL no cambia, pero el ítem
    // activo sí, y hay que volver a medir.
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [location.pathname, sidebarCollapsed, navItems.length, activeNavLabel]);

  // La barra inferior recuerda el último índice activo para poder deslizarse.
  useLayoutEffect(() => {
    if (activeMobileIndex >= 0) lastBottomIndicatorIndex = activeMobileIndex;
  }, [activeMobileIndex]);

  /*
   * Se invoca como función de render (SidebarContent({...})) y no como
   * <SidebarContent />: al estar definido dentro de este componente, cada render
   * crea una función nueva y React trataría su JSX como otro tipo, remontando el
   * <nav>, el indicador y los badges en cada navegación. Llamándolo directamente
   * su árbol se reconcilia dentro del marco y el nodo DOM persiste entre rutas.
   */
  const SidebarContent = ({ collapsed, withIndicator = false }: { collapsed: boolean; withIndicator?: boolean }) => {
    return (
      <div className="flex flex-col h-full py-4">
        {/* Logo */}
        <div className={`flex items-center gap-3 px-4 py-2 mb-4 ${collapsed ? 'justify-center' : ''}`}>
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-white" style={{ background: 'linear-gradient(135deg, #FF5A1F, #FF3D00)' }}>
            <Warehouse className="text-white" size={20} />
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <p className="font-bold text-sm text-sidebar-foreground leading-tight">Manager Stock Pro</p>
              <p className="text-xs text-sidebar-foreground/60 truncate">{config ? (config.foodConfig?.displayLabel ?? BUSINESS_LABELS[config.type]) : 'Sistema'}</p>
            </div>
          )}
        </div>

        {/* Nav groups */}
        <nav className="relative flex-1 overflow-y-auto px-3" data-sidebar-nav={withIndicator ? 'true' : undefined}>
          {/* Un solo indicador: se dibuja detrás de la lista y se desliza hasta
              el enlace activo. Antes se renderizaba dentro de cada enlace, así
              que aparecía una pieza de cristal en varios ítems a la vez. */}
          {withIndicator && sidebarIndicator && (
            <motion.span
              aria-hidden="true"
              className="app-nav-indicator pointer-events-none absolute left-3 right-3 z-0 rounded-xl"
              initial={false}
              animate={{ top: sidebarIndicator.to.top, height: sidebarIndicator.to.height }}
              transition={{ type: 'tween', duration: 0.2, ease: 'easeInOut' }}
            />
          )}
          <div className={`relative z-10 ${collapsed ? 'space-y-0.5' : 'space-y-1'}`}>
            {groups.map((group, gi) => (
              <div key={group}>
                {gi > 0 && !collapsed && (
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40 px-2 pt-4 pb-1">
                    {groupLabels[group]}
                  </p>
                )}
                {gi > 0 && collapsed && (
                  <div className="h-px bg-sidebar-border my-1 mx-2" />
                )}
                {navItems.filter(i => i.group === group).map(item => {
                  const Icon = item.icon;
                  const active = isActiveNavItem(item);
                  return (
                    <Link
                      key={`${item.path}|${item.label}`}
                      to={item.path}
                      onClick={() => setActiveNavLabel(item.label)}
                      title={collapsed ? item.label : undefined}
                      data-sidebar-active={active && withIndicator ? 'true' : undefined}
                      style={active ? { color: 'var(--nav-active-fg)' } : undefined}
                      className={`
                        flex items-center gap-3 rounded-xl text-sm font-medium transition-colors duration-200 group relative
                        ${active
                          ? 'font-semibold'
                          : 'text-sidebar-foreground/65 hover:text-sidebar-foreground hover:bg-sidebar-accent'
                        }
                        ${collapsed ? 'min-h-[40px] justify-center px-0' : 'min-h-[44px] px-3'}
                      `}
                    >
                      <Icon size={22} className="flex-shrink-0 relative z-10" />
                      {!collapsed && <span className="flex-1 relative z-10">{item.label}</span>}
                      {!collapsed && item.badge && item.badge > 0 ? (
                        <span className="pop-in bg-red-500 text-white text-[10px] h-5 min-w-5 flex items-center justify-center px-1 rounded-full relative z-10">
                          {item.badge}
                        </span>
                      ) : null}
                      {collapsed && item.badge && item.badge > 0 ? (
                        <span className="pop-in absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center relative z-10">
                          {item.badge}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </nav>

        {/* User + logout */}
        <div className="mt-2 border-t border-sidebar-border px-3 pt-2 pb-2">
          <button
            onClick={handleLogout}
            className={`w-full flex items-center gap-3 py-2 rounded-xl text-sidebar-foreground/60 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 transition-all duration-200 ${collapsed ? 'min-h-[40px] justify-center px-0' : 'min-h-[44px] px-3'}`}
            title="Cerrar sesión"
          >
            <LogOut size={22} />
            {!collapsed && <span>Cerrar sesión</span>}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="app-shell flex h-screen overflow-hidden">
      {/* ── Desktop sidebar ── */}
      <aside
        className={`app-sidebar hidden lg:flex flex-col transition-all duration-300 flex-shrink-0 m-4 ${sidebarCollapsed ? 'w-16 app-sidebar-collapsed' : 'w-64'}`}
      >
        {SidebarContent({ collapsed: sidebarCollapsed, withIndicator: true })}
      </aside>

      {/* ── Mobile sidebar overlay ── */}
      <AnimatePresence>
        {mobileSidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="lg:hidden fixed inset-0 bg-black/50 z-40"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <motion.aside
              initial={{ x: -260 }}
              animate={{ x: 0 }}
              exit={{ x: -260 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="lg:hidden fixed left-0 top-0 bottom-0 w-64 bg-sidebar border-r border-sidebar-border z-50 flex flex-col"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="font-bold text-sm text-foreground">Menú</span>
                <button onClick={() => setMobileSidebarOpen(false)} className="p-2 rounded-lg hover:bg-accent">
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                {SidebarContent({ collapsed: false })}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="app-header flex-shrink-0 h-14 mx-3 sm:mx-4 mt-4 rounded-full flex items-center px-3 sm:px-6 gap-2 sm:gap-3 z-10">
          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="lg:hidden p-2 rounded-full hover:bg-accent text-muted-foreground"
          >
            <Menu size={20} />
          </button>

          {/* Desktop sidebar collapse */}
          <button
            onClick={() => setSidebarCollapsed(c => !c)}
            className="hidden lg:flex p-2 rounded-full hover:bg-accent text-muted-foreground transition-colors"
            title={sidebarCollapsed ? 'Expandir menú' : 'Colapsar menú'}
          >
            {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>

          {/* Breadcrumb / page title area */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate hidden sm:block">
              {config?.name || 'Manager Stock Pro'}
            </p>
          </div>

          <div title={isDesktopMode() ? 'Aplicación de escritorio: los datos demo se guardan en este equipo.' : databaseConnected ? 'Las operaciones del servidor se guardan en SQLite.' : 'No hay conexión con la API. Las operaciones que requieren el servidor pueden fallar; no continúes ventas hasta recuperar la conexión.'} className={`hidden sm:flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold ${databaseConnected ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>
            <Database size={13} />
            {databaseConnected === null ? 'Verificando datos…' : databaseConnected ? 'Base de datos conectada' : isDesktopMode() ? 'Modo escritorio local' : 'Modo local de prueba'}
          </div>

          {/* Empresa selector (desktop) */}
          <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-background text-xs font-medium text-muted-foreground">
            <Building2 size={14} className="text-primary" />
            <span>{config?.name || 'Negocio principal'}</span>
          </div>

          {/* Foto del dueño (solo interfaz). */}
          {/* Appearance controls are business-wide and therefore owner-only. */}
          {user?.role === 'owner' && <button
            onClick={handleThemeToggle}
            className="p-2 rounded-full hover:bg-accent text-muted-foreground transition-colors"
            title={isDark ? 'Modo claro' : 'Modo oscuro'}
            aria-label={isDark ? 'Activar tema claro' : 'Activar tema oscuro'}
          >
            {isDark ? <Sun size={18} className="text-amber-300" /> : <Moon size={18} />}
          </button>}

          {/* POS shortcut is visible only if the current role is authorized. */}
          {canAccessPath('/pos', user?.role, config, user?.customRoleId ? (user.permissions ?? []) : undefined) && <button
            onClick={() => navigate('/pos')}
            className="p-2 rounded-full hover:bg-accent text-muted-foreground hover:text-primary transition-colors"
            title="Abrir punto de venta"
            aria-label="Abrir punto de venta"
          >
            <Barcode size={18} />
          </button>}

          {/* Notifications are only displayed when the role can open the alert center. */}
          {navItems.some(item => item.path === '/notifications') && <button
            onClick={() => navigate('/notifications')}
            className="relative p-2 rounded-full hover:bg-accent text-muted-foreground transition-colors"
            aria-label="Abrir notificaciones"
          >
            <Bell size={18} />
            {lowStockCount > 0 && (
              <span className="pop-in absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold">
                {lowStockCount}
              </span>
            )}
          </button>}
        </header>

        {/* Content: cada pantalla se monta al navegar y sus tarjetas/bloques entran animados */}
        <main className="flex-1 overflow-y-auto">
          <div className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 ${hideGlobalMobileNav ? 'pb-0' : 'pb-24'} lg:pb-6`}>{children}</div>
        </main>
      </div>

      {/* ── Mobile bottom tab bar ── */}
      {!hideGlobalMobileNav && (
      <nav className="app-mobile-nav lg:hidden fixed bottom-0 left-0 right-0 z-30 pb-safe">
        <div className="relative flex">
          {/* Indicador compartido: se desliza hasta la pestaña activa. */}
          {activeMobileIndex >= 0 && (
            <motion.span
              aria-hidden="true"
              className="pointer-events-none absolute top-0 h-0.5 w-8 -translate-x-1/2 rounded-b-full bg-primary"
              initial={{ left: `${(((lastBottomIndicatorIndex ?? activeMobileIndex) + 0.5) / mobileBottomItems.length) * 100}%` }}
              animate={{ left: `${((activeMobileIndex + 0.5) / mobileBottomItems.length) * 100}%` }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            />
          )}
          {mobileBottomItems.map(item => {
            const Icon = item.icon;
            const isMore = item.path === '__more__';
            const active = !isMore && isActive(item.path);

            if (isMore) {
              return (
                <button
                  key="more"
                  onClick={() => setShowMoreMenu(m => !m)}
                  className={`flex-1 flex flex-col items-center justify-center py-2 min-h-[56px] text-muted-foreground`}
                >
                  <MoreHorizontal size={22} />
                  <span className="text-[10px] mt-0.5">Más</span>
                </button>
              );
            }

            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex-1 flex flex-col items-center justify-center py-2 min-h-[56px] transition-colors relative ${
                  active ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                <div className="relative">
                  <Icon size={22} />
                  {item.badge && item.badge > 0 ? (
                    <span className="pop-in absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center">
                      {item.badge}
                    </span>
                  ) : null}
                </div>
                <span className="text-[10px] mt-0.5 font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
      )}

      {/* Mobile "Más" drawer */}
      <AnimatePresence>
        {showMoreMenu && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="lg:hidden fixed inset-0 bg-black/40 z-40"
              onClick={() => setShowMoreMenu(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="lg:hidden fixed bottom-0 left-0 right-0 bg-sidebar border-t border-sidebar-border z-50 rounded-t-2xl pb-safe"
            >
              <div className="p-4">
                <div className="w-10 h-1 bg-border rounded-full mx-auto mb-4" />
                <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">Más opciones</p>
                <div className="grid grid-cols-3 gap-3">
                  {navItems.filter(i => !mobileBottomItems.some(m => m.path === i.path) && i.path !== '__more__').map(item => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={`${item.path}|${item.label}`}
                        to={item.path}
                        onClick={() => { setActiveNavLabel(item.label); setShowMoreMenu(false); }}
                        className="flex flex-col items-center gap-1 p-3 rounded-3xl bg-accent hover:bg-accent transition-colors"
                      >
                        <Icon size={20} className={isActiveNavItem(item) ? 'text-primary' : 'text-muted-foreground'} />
                        <span className="text-[10px] text-center text-foreground font-medium leading-tight">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
                <div className="mt-4 flex gap-2">
                  {user?.role === 'owner' && <button onClick={handleThemeToggle} className="flex-1 flex items-center justify-center gap-2 p-3 rounded-3xl bg-accent text-sm text-muted-foreground">
                    {isDark ? <Sun size={16} className="text-amber-300" /> : <Moon size={16} />}
                    <span>{isDark ? 'Modo claro' : 'Modo oscuro'}</span>
                  </button>}
                  <button onClick={handleLogout} className="flex-1 flex items-center justify-center gap-2 p-3 rounded-3xl bg-destructive/10 text-sm text-red-600">
                    <LogOut size={16} />
                    <span>Salir</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Barrido de tema: la forma nace en el botón sol/luna y cubre la pantalla. */}
      {themeSweep && (
        <ThemeSweep
          origin={{ x: themeSweep.x, y: themeSweep.y }}
          color={themeSweepColor}
          onCovered={coverAndPersistTheme}
          onDone={() => setThemeSweep(null)}
        />
      )}
    </div>
  );
}

/**
 * Shell persistente: monta la interfaz (sidebar, header y barra inferior) UNA sola
 * vez y marca a los <Layout> de cada página como anidados, de modo que sean
 * transparentes. Así los indicadores se deslizan con continuidad entre rutas y el
 * contenido puede animar su entrada/salida sin volver a montar el marco.
 */
export function LayoutChromeHost({ children }: LayoutProps) {
  return (
    <ChromeContext.Provider value={true}>
      <LayoutShell>{children}</LayoutShell>
    </ChromeContext.Provider>
  );
}

/**
 * Envoltura que usan las páginas: fuera del shell monta la interfaz completa
 * (comportamiento de siempre) y dentro del shell solo devuelve el contenido.
 */
export function Layout({ children }: LayoutProps) {
  const nested = useContext(ChromeContext);
  if (nested) return <>{children}</>;
  return <LayoutShell>{children}</LayoutShell>;
}
