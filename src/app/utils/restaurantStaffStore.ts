import { useEffect } from 'react';
import type { EmpleadoRef, EmpleadoRol } from './restaurantTypes';
import { createScopedLocalStore, uniqueRestaurantId, useScopedLocalStore } from './restaurantStorage';

export interface RestaurantStaff {
  id: string;
  name: string;
  role: EmpleadoRol;
  active: boolean;
  pin?: string;
}

export interface RestaurantStaffState {
  staff: RestaurantStaff[];
  activeByRole: Record<EmpleadoRol, string | null>;
}

export const RESTAURANT_ROLE_LABELS: Record<EmpleadoRol, string> = {
  mesero: 'Mesero',
  cocina: 'Cocina',
  admin: 'Administración',
};

const EMPTY_STATE: RestaurantStaffState = {
  staff: [],
  activeByRole: { mesero: null, cocina: null, admin: null },
};

function normalizeStaff(value: unknown): RestaurantStaffState {
  const input = value && typeof value === 'object' ? value as Partial<RestaurantStaffState> : {};
  const staff: RestaurantStaff[] = [];
  if (Array.isArray(input.staff)) {
    input.staff.forEach((candidate) => {
      if (!candidate || typeof candidate !== 'object') return;
      const item = candidate as Partial<RestaurantStaff>;
      if (!item.id || !item.name || !item.role) return;
      if (!['mesero', 'cocina', 'admin'].includes(item.role)) return;
      staff.push({
        id: String(item.id),
        name: String(item.name).trim(),
        role: item.role,
        active: item.active !== false,
        pin: typeof item.pin === 'string' && item.pin.trim() ? item.pin.trim().slice(0, 8) : undefined,
      });
    });
  }
  const activeByRole: Record<EmpleadoRol, string | null> = {
    mesero: input.activeByRole?.mesero ?? null,
    cocina: input.activeByRole?.cocina ?? null,
    admin: input.activeByRole?.admin ?? null,
  };
  (['mesero', 'cocina', 'admin'] as EmpleadoRol[]).forEach((role) => {
    const selected = staff.find((item) => item.id === activeByRole[role] && item.active);
    if (!selected) {
      const fallback = staff.find((item) => item.role === role && item.active);
      activeByRole[role] = fallback?.id ?? null;
    }
  });
  return { staff, activeByRole };
}

const staffStore = createScopedLocalStore<RestaurantStaffState>(
  'manager_stock_restaurant_staff_v1_',
  () => ({ ...EMPTY_STATE, activeByRole: { ...EMPTY_STATE.activeByRole } }),
  normalizeStaff,
);

export function seedRestaurantStaff(scope: string, currentUserName: string): RestaurantStaffState {
  const current = staffStore.get(scope);
  if (current.staff.length > 0) return current;
  const name = currentUserName.trim() || 'Administración';
  const staff: RestaurantStaff[] = [
    { id: uniqueRestaurantId('staff-admin'), name, role: 'admin', active: true },
    { id: uniqueRestaurantId('staff-mesero'), name, role: 'mesero', active: true },
    { id: uniqueRestaurantId('staff-cocina'), name, role: 'cocina', active: true },
  ];
  return staffStore.set(scope, {
    staff,
    activeByRole: {
      admin: staff[0].id,
      mesero: staff[1].id,
      cocina: staff[2].id,
    },
  });
}

export function useRestaurantStaff(scope: string, currentUserName: string) {
  const state = useScopedLocalStore(staffStore, scope);

  useEffect(() => {
    seedRestaurantStaff(scope, currentUserName);
  }, [scope, currentUserName]);

  const getActive = (role: EmpleadoRol): RestaurantStaff | null => {
    const selected = state.staff.find((item) => item.id === state.activeByRole[role] && item.active && item.role === role);
    if (selected) return selected;
    return state.staff.find((item) => item.role === role && item.active) ?? null;
  };

  const setActive = (role: EmpleadoRol, staffId: string) => {
    staffStore.update(scope, (current) => ({
      ...current,
      activeByRole: { ...current.activeByRole, [role]: staffId },
    }));
  };

  const addStaff = (input: { name: string; role: EmpleadoRol; pin?: string }) => {
    const item: RestaurantStaff = {
      id: uniqueRestaurantId('staff'),
      name: input.name.trim(),
      role: input.role,
      active: true,
      pin: input.pin?.trim() || undefined,
    };
    staffStore.update(scope, (current) => ({
      staff: [...current.staff, item],
      activeByRole: {
        ...current.activeByRole,
        [item.role]: current.activeByRole[item.role] ?? item.id,
      },
    }));
    return item;
  };

  const updateStaff = (staffId: string, patch: Partial<Pick<RestaurantStaff, 'name' | 'role' | 'active' | 'pin'>>) => {
    staffStore.update(scope, (current) => {
      const nextStaff = current.staff.map((item) => {
        if (item.id !== staffId) return item;
        return {
          ...item,
          ...patch,
          name: patch.name !== undefined ? patch.name.trim() : item.name,
          pin: patch.pin !== undefined ? (patch.pin.trim() || undefined) : item.pin,
        };
      });
      return normalizeStaff({ ...current, staff: nextStaff });
    });
  };

  const removeStaff = (staffId: string) => {
    staffStore.update(scope, (current) => normalizeStaff({
      ...current,
      staff: current.staff.filter((item) => item.id !== staffId),
    }));
  };

  const toEmployee = (staff: RestaurantStaff): EmpleadoRef => ({
    id: staff.id,
    nombre: staff.name,
    rol: staff.role,
  });

  return {
    staff: state.staff,
    activeByRole: state.activeByRole,
    activeStaff: getActive,
    setActive,
    addStaff,
    updateStaff,
    removeStaff,
    toEmployee,
  };
}
