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
  if (path === '/products') return 'catalog.view';
  if (path === '/products/new') return 'catalog.create';
  if (/^\/products\/[^/]+\/edit$/.test(path)) return 'catalog.edit';
  if (path === '/suppliers') return 'suppliers.view';
  if (path === '/suppliers/new') return 'suppliers.manage';
  if (path.startsWith('/inventory/')) return 'inventory.view';
  if (path === '/warehouse' || path === '/warehouse/movements' || path === '/warehouse/lots' || path === '/warehouse/reports') return 'inventory.view';
  if (path === '/warehouse/entries' || path === '/warehouse/exits' || path === '/warehouse/waste' || path === '/warehouse/transfers') return 'inventory.entry';
  if (path === '/warehouse/adjustments' || path === '/warehouse/counts') return 'inventory.adjust';
  if (path === '/warehouse/purchase-orders') return 'inventory.view';
  if (path === '/warehouse/locations') return 'inventory.view';
  if (path === '/warehouse/settings') return 'inventory.edit';
  if (path === '/hotel/income') return 'reports.view';
  if (path.startsWith('/hotel/')) return 'hotel.view';
  if (path === '/restaurant/tables') return 'orders.view';
  if (path === '/restaurant/recipes') return 'catalog.edit';
  if (path === '/restaurant/waiter') return 'orders.manage';
  if (path === '/restaurant/kitchen') return 'orders.view';
  if (path === '/restaurant/orders') return 'orders.manage';
  if (path === '/restaurant/catalog') return 'catalog.edit';
  if (path === '/restaurant/settings') return 'orders.manage';
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
    if (path === '/hotel/income' && !customPermissions.includes('hotel.view')) return false;
    const required = pathPermission(path);
    if (!required || !customPermissions.includes(required)) return false;
  }

  if (path === '/restaurant/recipes' || path.startsWith('/restaurant/recipes/')) {
    if (config && config.type !== 'restaurant') return false;
    if (config && !config.features.inventory && !(config.foodConfig?.activeModules ?? []).includes('menu')) return false;
  }

  if (role === 'cashier' && customPermissions === undefined) {
    const cashierRoutes = [
      '/dashboard', '/pos', '/sales', '/sales/new', '/notifications', '/products',
      '/restaurant/waiter', '/restaurant/kitchen', '/restaurant/tables',
    ];
    if (!cashierRoutes.some((allowed) => path === allowed || path.startsWith(`${allowed}/`))) return false;
    if (path.startsWith('/products/') && path !== '/products') return false;
    if (path.startsWith('/sales/') && path !== '/sales/new' && !/^\/sales\/[^/]+$/.test(path)) return false;
  }

  if (role === 'business_admin' && (path === '/settings' || path === '/subscription')) return false;

  if (config) {
    if (path.startsWith('/restaurant/') && config.type !== 'restaurant') return false;
    if (path.startsWith('/hotel/') && (config.type !== 'hotel' || !(config.features.rooms || config.features.reservations))) return false;
    if ((path === '/inventory' || path.startsWith('/inventory/') || path === '/warehouse' || path.startsWith('/warehouse/')) && !config.features.warehouse) return false;
    if ((path === '/services' || path.startsWith('/services/')) && (config.type !== 'services' || !(config.features.services || config.features.reservations))) return false;
    const foodMenuEnabled = config.type === 'restaurant' && (config.foodConfig?.activeModules ?? []).includes('menu');
    if ((path === '/products' || path.startsWith('/products/')) && !config.features.inventory && !foodMenuEnabled && !config.features.pos) return false;
    if ((path === '/products/new' || /^\/products\/[^/]+\/edit$/.test(path)) && !config.features.inventory && !foodMenuEnabled) return false;
    if ((path === '/suppliers' || path.startsWith('/suppliers/')) && !config.features.inventory) return false;
    if ((path === '/pos' || path === '/sales/new' || path === '/sales' || path.startsWith('/sales/') || path === '/reports') && !config.features.pos) return false;
    if (['/restaurant/waiter', '/restaurant/kitchen', '/restaurant/orders', '/restaurant/tables', '/restaurant/settings'].includes(path) && !(config.foodConfig?.activeModules ?? []).includes('pedidos')) return false;
    if (path === '/restaurant/catalog' && !foodMenuEnabled) return false;
    if (path === '/restaurant/tables' && !config.features.tables) return false;
  }
  return true;
}

export function canManageUsers(role?: AppRole | null): boolean {
  return role === 'owner' || role === 'business_admin';
}

/** Match effective employee permissions when rendering actions. The API remains authoritative. */
export function canPerformAction(user: AuthUser | null | undefined, permission: string): boolean {
  if (!user) return false;
  if (user.customRoleId) return !!user.permissions?.includes(permission);
  if (user.role === 'owner' || user.role === 'business_admin') return true;
  return user.role === 'cashier' && ['dashboard.view', 'catalog.view', 'sales.view', 'sales.create', 'orders.view', 'orders.manage', 'cash.view', 'cash.manage'].includes(permission);
}
