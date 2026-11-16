import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { desktop } from './desktop';

// Desktop (offline) mode must apply the same account state the admin screen shows:
// a deactivated user cannot log in, and a custom role is stored and enforced.
const OWNER = {
  id: 'U-OWN',
  businessId: 'NEG-S',
  name: 'Dueña',
  email: 'duena@test.local',
  password: 'secreto1',
  role: 'owner',
  active: true,
  subscription: 'basic',
};
const CASHIER = {
  id: 'U-CAJA',
  businessId: 'NEG-S',
  name: 'Caja',
  email: 'caja@test.local',
  password: 'secreto1',
  role: 'cashier',
  active: true,
  subscription: 'basic',
};
const SEED = {
  generatedAt: '2026-11-01T00:00:00Z',
  users: [OWNER, CASHIER],
  businesses: {
    'NEG-S': {
      id: 'NEG-S',
      name: 'Negocio Demo',
      products: [],
      suppliers: [],
      sales: [],
      recipes: [],
      orders: [],
      movements: [],
      customRoles: [],
      users: [OWNER, CASHIER].map(u => ({
        id: u.id,
        businessId: 'NEG-S',
        name: u.name,
        email: u.email,
        role: u.role,
        customRoleId: null,
        customRoleName: null,
        active: true,
        createdAt: '2026-11-01T00:00:00Z',
      })),
    },
  },
};

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(SEED), { status: 200 })),
  );
});
beforeEach(() => localStorage.clear());

const asOwner = () => desktop.auth.login(OWNER.email, OWNER.password);

describe('cuentas en modo escritorio', () => {
  it('un usuario del seed desactivado no puede iniciar sesión ni seguir usando su sesión', async () => {
    await desktop.auth.login(CASHIER.email, CASHIER.password);
    await asOwner();
    await desktop.users.update(CASHIER.id, { active: false });
    await expect(desktop.auth.login(CASHIER.email, CASHIER.password)).rejects.toThrow(/inactiva/);

    await desktop.users.update(CASHIER.id, { active: true });
    await desktop.auth.login(CASHIER.email, CASHIER.password);
    await asOwner().then(() => desktop.users.update(CASHIER.id, { active: false }));
    localStorage.setItem(
      'manager_stock_desktop_user',
      JSON.stringify({ ...OWNER, id: CASHIER.id, email: CASHIER.email, role: 'cashier' }),
    );
    await expect(desktop.auth.me()).rejects.toThrow(/inactiva/);
  });

  it('el rol personalizado se guarda y define los permisos al iniciar sesión', async () => {
    await asOwner();
    const role = await desktop.users.createRole({ name: 'Solo consulta', permissions: ['catalog.view'] });

    await desktop.users.update(CASHIER.id, { customRoleId: role.id });
    const seeded = (await desktop.users.list()).find(u => u.id === CASHIER.id);
    expect(seeded?.customRoleId).toBe(role.id);
    const cashierLogin = await desktop.auth.login(CASHIER.email, CASHIER.password);
    expect(cashierLogin.user.customRoleId).toBe(role.id);
    expect(cashierLogin.user.permissions).toEqual(['catalog.view']);

    await asOwner();
    const created = await desktop.users.create({
      name: 'Nuevo',
      email: 'nuevo@test.local',
      password: 'secreto1',
      role: 'cashier',
      customRoleId: role.id,
    });
    expect((await desktop.users.list()).find(u => u.id === created.id)?.customRoleId).toBe(role.id);
    const newLogin = await desktop.auth.login('nuevo@test.local', 'secreto1');
    expect(newLogin.user.permissions).toEqual(['catalog.view']);
  });
});
