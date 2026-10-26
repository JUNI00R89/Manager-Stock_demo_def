import type { AuthUser } from '../services/dataService';
import type { BusinessConfig } from '../context/BusinessContext';

export type AppRole = AuthUser['role'];

const ROLE_LABELS: Record<AppRole, string> = {
  superadmin: 'SUPERADMIN',
  owner: 'Propietario',
  business_admin: 'Administrador de negocio',
  cashier: 'Cajero',
};

export function roleLabel(role?: AppRole | null): string {
  return role ? ROLE_LABELS[role] : 'Sin rol';
}

const pathPermission = (path: string): string | null => {
  if (path === '/dashboard') return 'dashboard.view';
  if (path === '/pos' || path === '/sales/new') return 'sales.create';
  if (path === '/sales' || /^\/sales\/[^/]+$/.test(path)) return 'sales.view';
  if (path === '/services' || path === '/services/appointments') return 'services.view';
  if (path === '/services' || path === '/services/appointments') return 'services.view';
  if (path === '/products') return 'catalog.view';
  if (path === '/products/new') return 'catalog.create';
  if (/^\/products\/[^/]+\/edit$/.test(path)) return 'catalog.edit';
  if (path === '/suppliers') return 'suppliers.view';
  if (path === '/suppliers/new') return 'suppliers.manage';
  if (path.startsWith('/inventory/')) return 'inventory.view';
  if (path === '/restaurant/kitchen') return 'orders.view';
  if (path === '/restaurant/waiter') return 'orders.manage';
  if (path === '/restaurant/tables') return 'orders.view';
  if (path === '/reports') return 'reports.view';
  if (path === '/activity') return 'activity.view';
  if (path === '/notifications') return 'dashboard.view';
  return null;
};

export function canAccessPath(path: string, role?: AppRole | null, config?: BusinessConfig | null, customPermissions?: string[]): boolean {
  if (!role) return false;
  if (role === 'superadmin') return path === '/platform' || path.startsWith('/platform/');
  if (path === '/platform' || path.startsWith('/platform/')) return false;
  if (path === '/business-setup') return role === 'owner';

  if (customPermissions !== undefined) {
    const required = pathPermission(path);
    if (!required || !customPermissions.includes(required)) return false;
  }

  if (path === '/restaurant/recipes' || path.startsWith('/restaurant/recipes/')) return false;

  if (role === 'cashier' && customPermissions === undefined) {
    const cashierRoutes = [
      '/dashboard', '/pos', '/sales', '/sales/new', '/notifications', '/products',
      '/restaurant/kitchen', '/restaurant/tables', '/restaurant/waiter',
    ];
    if (!cashierRoutes.some((allowed) => path === allowed || path.startsWith(`${allowed}/`))) return false;
    if (path.startsWith('/products/') && path !== '/products') return false;
    if (path.startsWith('/sales/') && path !== '/sales/new' && !/^\/sales\/[^/]+$/.test(path)) return false;
  }

  if (role === 'business_admin' && (path === '/settings' || path === '/subscription')) return false;

  if (config) {
    if (path.startsWith('/restaurant/') && config.type !== 'restaurant') return false;
    if (path.startsWith('/hotel/') && !config.features.rooms) return false;
    if (path.startsWith('/warehouse/') && !config.features.warehouse) return false;
    if (path.startsWith('/services/') && (config.type !== 'services' || !config.features.services)) return false;
    const foodMenuEnabled = config.type === 'restaurant' && (config.foodConfig?.activeModules ?? []).includes('menu');
    if ((path === '/products' || path.startsWith('/products/')) && !config.features.inventory && !foodMenuEnabled) return false;
    if ((path === '/suppliers' || path.startsWith('/suppliers/')) && !config.features.inventory) return false;
    if ((path === '/pos' || path === '/sales/new' || path === '/sales' || path.startsWith('/sales/') || path === '/reports') && !config.features.pos) return false;
    if (path === '/restaurant/tables' && !config.features.tables) return false;
    if (path === '/restaurant/waiter' && (!config.features.tables || !(config.foodConfig?.activeModules ?? []).includes('pedidos'))) return false;
    if (path === '/restaurant/kitchen' && !(config.foodConfig?.activeModules ?? []).includes('pedidos')) return false;
  }
  return true;
}

export function canManageUsers(role?: AppRole | null): boolean {
  return role === 'owner' || role === 'business_admin';
}
