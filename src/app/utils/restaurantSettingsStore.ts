import { createScopedLocalStore, useScopedLocalStore } from './restaurantStorage';

export interface RestaurantSettings {
  /** Hora local en la que inicia la jornada, formato HH:mm. */
  startTime: string;
  /** Minutos antes de marcar un pedido como demorado en cocina. */
  expectedMinutes: number;
  /** Nombre visible de la mesa, por id. El backend guarda un número. */
  tableNames: Record<string, string>;
}

export const DEFAULT_RESTAURANT_SETTINGS: RestaurantSettings = {
  startTime: '06:00',
  expectedMinutes: 15,
  tableNames: {},
};

function normalizeSettings(value: unknown): RestaurantSettings {
  const input = value && typeof value === 'object' ? value as Partial<RestaurantSettings> : {};
  const startTime = typeof input.startTime === 'string' && /^\d{2}:\d{2}$/.test(input.startTime)
    ? input.startTime
    : DEFAULT_RESTAURANT_SETTINGS.startTime;
  const parsedMinutes = Number(input.expectedMinutes);
  const expectedMinutes = Number.isFinite(parsedMinutes)
    ? Math.max(1, Math.min(180, Math.round(parsedMinutes)))
    : DEFAULT_RESTAURANT_SETTINGS.expectedMinutes;
  const tableNames: Record<string, string> = {};
  if (input.tableNames && typeof input.tableNames === 'object') {
    Object.entries(input.tableNames).forEach(([tableId, name]) => {
      if (typeof name === 'string' && name.trim()) tableNames[tableId] = name.trim();
    });
  }
  return { startTime, expectedMinutes, tableNames };
}

const settingsStore = createScopedLocalStore<RestaurantSettings>(
  'manager_stock_restaurant_settings_v1_',
  () => ({ ...DEFAULT_RESTAURANT_SETTINGS, tableNames: {} }),
  normalizeSettings,
);

export function useRestaurantSettings(scope: string) {
  const settings = useScopedLocalStore(settingsStore, scope);
  return {
    settings,
    saveSettings: (patch: Partial<RestaurantSettings>) => settingsStore.update(scope, (current) => normalizeSettings({ ...current, ...patch })),
    setTableName: (tableId: string, name: string) => settingsStore.update(scope, (current) => {
      const tableNames = { ...current.tableNames };
      if (name.trim()) tableNames[tableId] = name.trim();
      else delete tableNames[tableId];
      return { ...current, tableNames };
    }),
    removeTableName: (tableId: string) => settingsStore.update(scope, (current) => {
      const tableNames = { ...current.tableNames };
      delete tableNames[tableId];
      return { ...current, tableNames };
    }),
  };
}
