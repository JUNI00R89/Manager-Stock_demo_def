import { describe, expect, it } from 'vitest';
import type { BusinessConfig } from '../context/BusinessContext';
import type { AuthUser } from '../services/dataService';
import { canAccessPath, canManageUsers, canPerformAction, roleLabel } from './permissions';

const baseFeatures = {
  inventory: true,
  pos: true,
  reservations: false,
  tables: false,
  rooms: false,
  warehouse: false,
  services: false,
  delivery: false,
};

function config(overrides: Partial<BusinessConfig> = {}): BusinessConfig {
  return {
    type: 'retail',
    name: 'Demo',
    currency: 'COP',
    taxRate: 0.19,
    features: { ...baseFeatures },
    ...overrides,
  };
}

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'u1',
    email: 'u@test.com',
    name: 'Usuario',
    role: 'owner',
    businessId: 'b1',
    subscription: 'premium',
    ...overrides,
  };
}

const restaurantConfig = config({
  type: 'restaurant',
  features: { ...baseFeatures, tables: true },
  foodConfig: {
    serviceModes: [],
    foodTypes: [],
    activeModules: ['menu', 'pedidos'],
    displayLabel: 'Restaurante',
  },
});

const hotelConfig = config({
  type: 'hotel',
  features: { ...baseFeatures, reservations: true, rooms: true },
});

const warehouseConfig = config({
  type: 'warehouse',
  features: { ...baseFeatures, inventory: true, pos: false, warehouse: true },
});

describe('roleLabel', () => {
  it('traduce los roles conocidos', () => {
    expect(roleLabel('superadmin')).toBe('SUPERADMIN');
    expect(roleLabel('owner')).toBe('Propietario');
    expect(roleLabel('business_admin')).toBe('Administrador de negocio');
    expect(roleLabel('cashier')).toBe('Cajero');
  });

  it('indica cuando no hay rol', () => {
    expect(roleLabel(null)).toBe('Sin rol');
    expect(roleLabel(undefined)).toBe('Sin rol');
  });
});

describe('canAccessPath', () => {
  it('niega todo sin rol', () => {
    expect(canAccessPath('/dashboard', null)).toBe(false);
    expect(canAccessPath('/dashboard', undefined)).toBe(false);
  });

  it('limita al superadmin al panel de plataforma', () => {
    expect(canAccessPath('/platform', 'superadmin')).toBe(true);
    expect(canAccessPath('/platform/businesses', 'superadmin')).toBe(true);
    expect(canAccessPath('/dashboard', 'superadmin')).toBe(false);
  });

  it('bloquea el panel de plataforma para roles de negocio', () => {
    expect(canAccessPath('/platform', 'owner')).toBe(false);
    expect(canAccessPath('/platform/users', 'business_admin')).toBe(false);
  });

  it('permite business-setup solo al propietario', () => {
    expect(canAccessPath('/business-setup', 'owner')).toBe(true);
    expect(canAccessPath('/business-setup', 'business_admin')).toBe(false);
    expect(canAccessPath('/business-setup', 'cashier')).toBe(false);
  });

  it('respeta los permisos personalizados cuando se pasan', () => {
    expect(canAccessPath('/dashboard', 'owner', null, [])).toBe(false);
    expect(canAccessPath('/dashboard', 'owner', null, ['dashboard.view'])).toBe(true);
    expect(canAccessPath('/hotel/income', 'owner', null, ['reports.view'])).toBe(false);
    expect(canAccessPath('/hotel/income', 'owner', null, ['reports.view', 'hotel.view'])).toBe(true);
  });

  it('limita las rutas del cajero', () => {
    expect(canAccessPath('/dashboard', 'cashier')).toBe(true);
    expect(canAccessPath('/pos', 'cashier')).toBe(true);
    expect(canAccessPath('/sales', 'cashier')).toBe(true);
    expect(canAccessPath('/sales/new', 'cashier')).toBe(true);
    expect(canAccessPath('/sales/123', 'cashier')).toBe(true);
    expect(canAccessPath('/products', 'cashier')).toBe(true);
    expect(canAccessPath('/products/123/edit', 'cashier')).toBe(false);
    expect(canAccessPath('/reports', 'cashier')).toBe(false);
    expect(canAccessPath('/suppliers', 'cashier')).toBe(false);
  });

  it('impide que el administrador de negocio vea configuración y suscripción', () => {
    expect(canAccessPath('/settings', 'business_admin')).toBe(false);
    expect(canAccessPath('/subscription', 'business_admin')).toBe(false);
    expect(canAccessPath('/dashboard', 'business_admin')).toBe(true);
  });

  it('valida las rutas según el tipo de negocio', () => {
    expect(canAccessPath('/restaurant/tables', 'owner', restaurantConfig)).toBe(true);
    expect(canAccessPath('/restaurant/tables', 'owner', config())).toBe(false);
    expect(canAccessPath('/hotel/rooms', 'owner', hotelConfig)).toBe(true);
    expect(canAccessPath('/hotel/rooms', 'owner', config())).toBe(false);
    expect(canAccessPath('/warehouse', 'owner', warehouseConfig)).toBe(true);
    expect(canAccessPath('/warehouse', 'owner', config({ features: { ...baseFeatures, warehouse: false } }))).toBe(
      false,
    );
  });

  it('exige pedidos activos para el flujo de restaurante', () => {
    const noOrders = config({
      type: 'restaurant',
      features: { ...baseFeatures, tables: true },
      foodConfig: { serviceModes: [], foodTypes: [], activeModules: ['menu'], displayLabel: 'Restaurante' },
    });
    const noMenu = config({
      type: 'restaurant',
      features: { ...baseFeatures, tables: true },
      foodConfig: { serviceModes: [], foodTypes: [], activeModules: ['pedidos'], displayLabel: 'Restaurante' },
    });

    expect(canAccessPath('/restaurant/waiter', 'owner', restaurantConfig)).toBe(true);
    expect(canAccessPath('/restaurant/waiter', 'owner', noOrders)).toBe(false);
    expect(canAccessPath('/restaurant/catalog', 'owner', restaurantConfig)).toBe(true);
    expect(canAccessPath('/restaurant/catalog', 'owner', noMenu)).toBe(false);
  });

  it('exige mesas activas para la vista de mesas', () => {
    const noTables = config({
      type: 'restaurant',
      features: { ...baseFeatures, tables: false },
      foodConfig: { serviceModes: [], foodTypes: [], activeModules: ['menu', 'pedidos'], displayLabel: 'Restaurante' },
    });

    expect(canAccessPath('/restaurant/tables', 'owner', restaurantConfig)).toBe(true);
    expect(canAccessPath('/restaurant/tables', 'owner', noTables)).toBe(false);
  });

  it('exige POS para ventas y reportes', () => {
    const noPos = config({ features: { ...baseFeatures, pos: false } });
    expect(canAccessPath('/pos', 'owner', noPos)).toBe(false);
    expect(canAccessPath('/reports', 'owner', noPos)).toBe(false);
  });

  it('exige inventario para productos y proveedores', () => {
    const noInventory = config({ features: { ...baseFeatures, inventory: false, pos: false } });
    expect(canAccessPath('/products', 'owner', noInventory)).toBe(false);
    expect(canAccessPath('/suppliers', 'owner', noInventory)).toBe(false);
  });
});

describe('canManageUsers', () => {
  it('solo propietario y administrador de negocio', () => {
    expect(canManageUsers('owner')).toBe(true);
    expect(canManageUsers('business_admin')).toBe(true);
    expect(canManageUsers('cashier')).toBe(false);
    expect(canManageUsers('superadmin')).toBe(false);
    expect(canManageUsers(null)).toBe(false);
  });
});

describe('canPerformAction', () => {
  it('niega sin usuario', () => {
    expect(canPerformAction(null, 'dashboard.view')).toBe(false);
  });

  it('usa los permisos del rol personalizado', () => {
    const user = authUser({ role: 'cashier', customRoleId: 'role-1', permissions: ['sales.view'] });
    expect(canPerformAction(user, 'sales.view')).toBe(true);
    expect(canPerformAction(user, 'sales.create')).toBe(false);
  });

  it('deja pasar al propietario y al administrador', () => {
    expect(canPerformAction(authUser({ role: 'owner' }), 'users.manage')).toBe(true);
    expect(canPerformAction(authUser({ role: 'business_admin' }), 'settings.manage')).toBe(true);
  });

  it('limita al cajero a las acciones permitidas', () => {
    const cashier = authUser({ role: 'cashier' });
    expect(canPerformAction(cashier, 'sales.create')).toBe(true);
    expect(canPerformAction(cashier, 'orders.manage')).toBe(true);
    expect(canPerformAction(cashier, 'users.manage')).toBe(false);
    expect(canPerformAction(cashier, 'inventory.entry')).toBe(false);
  });
});
