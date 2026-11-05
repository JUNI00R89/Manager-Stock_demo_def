import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { useTheme } from './ThemeContext';
import { getBusinessConfig, saveBusinessConfig } from '../services/dataService';

export type BusinessType = 'retail' | 'restaurant' | 'hotel' | 'warehouse' | 'services';
export interface FoodBusinessConfig {
  serviceModes: string[];
  foodTypes: string[];
  activeModules: string[];
  displayLabel: string;
}
export interface BusinessTheme {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  lightBackground?: string;
  lightSurface?: string;
  darkBackground?: string;
  darkSurface?: string;
  mode: 'light' | 'dark';
  customized: boolean;
}
export interface InventoryConfig {
  allowNegativeStock: boolean;
  expiryAlertDays: number;
  lowStockAlerts: boolean;
  defaultLocationId: string | null;
}
export interface BusinessConfig {
  /** Identificador del negocio cuando la API lo expone. */
  id?: string;
  type: BusinessType;
  name: string;
  currency: string;
  taxRate: number;
  features: { inventory: boolean; pos: boolean; reservations: boolean; tables: boolean; rooms: boolean; warehouse: boolean; services: boolean; delivery: boolean };
  foodConfig?: FoodBusinessConfig;
  theme?: BusinessTheme;
  inventoryConfig?: InventoryConfig;
}
interface BusinessContextType {
  config: BusinessConfig | null;
  setConfig: (config: BusinessConfig | null) => Promise<void>;
  isConfigured: boolean;
  isLoading: boolean;
  isFoodBusiness: boolean;
  hasDelivery: boolean;
  hasTables: boolean;
}
const BusinessContext = createContext<BusinessContextType | undefined>(undefined);

export const DEFAULT_CONFIGS: Record<BusinessType, Omit<BusinessConfig, 'name'>> = {
  retail: { type: 'retail', currency: 'COP', taxRate: 0.19, features: { inventory: true, pos: true, reservations: false, tables: false, rooms: false, warehouse: false, services: false, delivery: false } },
  restaurant: { type: 'restaurant', currency: 'COP', taxRate: 0.19, features: { inventory: true, pos: true, reservations: false, tables: false, rooms: false, warehouse: false, services: false, delivery: false } },
  hotel: { type: 'hotel', currency: 'COP', taxRate: 0.19, features: { inventory: true, pos: true, reservations: true, tables: false, rooms: true, warehouse: false, services: false, delivery: false } },
  warehouse: { type: 'warehouse', currency: 'COP', taxRate: 0.19, features: { inventory: true, pos: false, reservations: false, tables: false, rooms: false, warehouse: true, services: false, delivery: false } },
  services: { type: 'services', currency: 'COP', taxRate: 0.19, features: { inventory: false, pos: true, reservations: true, tables: false, rooms: false, warehouse: false, services: true, delivery: false } },
};

/**
 * Paleta por defecto de la aplicación (sistema visual de referencia):
 * acento naranja #FF6B00 sobre superficies neutras. En modo claro la paleta se
 * mezcla con salvia para bajar el brillo (fondo #DEE4DA / tarjetas #EEF2EC);
 * en oscuro se mantiene el lienzo #080B10 y las tarjetas #11161E.
 *
 * Cada empresa puede seguir personalizando sus colores en Configuración: cuando lo
 * hace, su paleta guardada (`customized: true`) se respeta tal cual.
 */
const DEFAULT_PALETTE: Omit<BusinessTheme, 'customized'> = {
  primary: '#FF6B00',
  secondary: '#E85D00',
  accent: '#FF6B00',
  background: '#F5F5F5',
  surface: '#FFFFFF',
  lightBackground: '#F5F5F5',
  lightSurface: '#FFFFFF',
  darkBackground: '#080B10',
  darkSurface: '#11161E',
  mode: 'light',
};

export const DEFAULT_BUSINESS_THEMES: Record<BusinessType, BusinessTheme> = {
  retail: { ...DEFAULT_PALETTE, customized: false },
  restaurant: { ...DEFAULT_PALETTE, customized: false },
  warehouse: { ...DEFAULT_PALETTE, customized: false },
  services: { ...DEFAULT_PALETTE, customized: false },
  hotel: { ...DEFAULT_PALETTE, customized: false },
};

/**
 * El modo claro de la app descansa sobre un verde salvia muy suave. En lugar de
 * mostrar el blanco puro configurado por el negocio, mezclamos su paleta con ese
 * tono: conserva la identidad de marca y baja el brillo de fondo y tarjetas.
 */
const LIGHT_CANVAS_TINT: [number, number, number] = [198, 210, 198];
const LIGHT_SURFACE_TINT: [number, number, number] = [225, 232, 222];
const LIGHT_CANVAS_WEIGHT = 0.55;
const LIGHT_SURFACE_WEIGHT = 0.6;

function parseHexColor(value: string): [number, number, number] | null {
  const hex = value.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(hex)) return null;
  const normalized = hex.length === 3 ? hex.split('').map(char => char + char).join('') : hex;
  return [0, 2, 4].map(index => parseInt(normalized.slice(index, index + 2), 16)) as [number, number, number];
}

function mixHexColor(base: string, tint: [number, number, number], tintWeight: number) {
  const rgb = parseHexColor(base);
  if (!rgb) return base;
  const channels = rgb.map((channel, index) => Math.round(channel * (1 - tintWeight) + tint[index] * tintWeight));
  return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** Colores efectivos que la interfaz pinta para el tema indicado. */
export function resolveThemeColors(theme: BusinessTheme) {
  const background = theme.mode === 'dark' ? (theme.darkBackground || '#080B10') : (theme.lightBackground || theme.background);
  const surface = theme.mode === 'dark' ? (theme.darkSurface || '#11161E') : (theme.lightSurface || theme.surface);
  if (theme.mode === 'dark') return { background, surface };
  return {
    background: mixHexColor(background, LIGHT_CANVAS_TINT, LIGHT_CANVAS_WEIGHT),
    surface: mixHexColor(surface, LIGHT_SURFACE_TINT, LIGHT_SURFACE_WEIGHT),
  };
}

/**
 * Aplica la paleta al documento de forma sincrónica (clase `.dark` + variables
 * `--brand-*`). Al ser sincrónica se puede llamar dentro del callback de
 * View Transitions: el snapshot del tema nuevo ya sale con el color nuevo, sin
 * esperar a que React re-renderice ni a que el servidor responda.
 */
export function applyTheme(theme: BusinessTheme) {
  const root = document.documentElement;
  const { background, surface } = resolveThemeColors(theme);
  root.style.setProperty('--brand-primary', theme.primary);
  root.style.setProperty('--brand-secondary', theme.secondary);
  root.style.setProperty('--brand-accent', theme.accent);
  root.style.setProperty('--brand-background', background);
  root.style.setProperty('--brand-surface', surface);
  root.style.setProperty('--brand-soft', `${theme.primary}14`);
  root.dataset.businessTheme = theme.mode;
  root.classList.toggle('dark', theme.mode === 'dark');
}

function normalizeConfig(value: unknown): BusinessConfig | null {
  if (!value || typeof value !== 'object') return null;
  const config = value as BusinessConfig;
  if (!config.name || !config.features || !DEFAULT_CONFIGS[config.type]) return null;
  const defaults = DEFAULT_BUSINESS_THEMES[config.type];
  // Igual que en BusinessSetup: si la empresa no personalizó sus colores
  // (`customized: false`) se aplica la paleta por defecto vigente conservando su
  // preferencia claro/oscuro. Si los personalizó, se respeta su paleta guardada.
  const theme = config.theme
    ? (config.theme.customized
        ? { ...defaults, ...config.theme }
        : { ...defaults, mode: config.theme.mode ?? defaults.mode })
    : { ...defaults };
  const normalized: BusinessConfig = { ...DEFAULT_CONFIGS[config.type], ...config, theme, currency: 'COP', taxRate: Number.isFinite(config.taxRate) ? config.taxRate : 0.19 };
  normalized.inventoryConfig = {
    allowNegativeStock: false, expiryAlertDays: 30, lowStockAlerts: true, defaultLocationId: null,
    ...(config.inventoryConfig || {}),
  };
  if (normalized.type === 'restaurant') normalized.foodConfig = { serviceModes: [], foodTypes: [], activeModules: ['menu', 'caja', 'inventario'], ...normalized.foodConfig, displayLabel: 'Negocio de comidas' };
  return normalized;
}

export function BusinessProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { setTheme } = useTheme();
  const [config, setConfigState] = useState<BusinessConfig | null>(null);
  // Identifica para qué usuario ya terminó la carga de configuración. Así los
  // guards no confunden "todavía no cargó" con "el negocio no está configurado"
  // al refrescar una ruta interna (POS, Mesas, etc.).
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const isLoading = !!user && user.role !== 'superadmin' && loadedUserId !== user.id;

  useEffect(() => {
    if (config?.theme) {
      applyTheme(config.theme);
      setTheme(config.theme.mode);
    }
  }, [config?.theme?.primary, config?.theme?.secondary, config?.theme?.accent, config?.theme?.background, config?.theme?.surface, config?.theme?.lightBackground, config?.theme?.lightSurface, config?.theme?.darkBackground, config?.theme?.darkSurface, config?.theme?.mode, setTheme]);

  useEffect(() => {
    let active = true;
    if (!user || user.role === 'superadmin') {
      setConfigState(null);
      localStorage.removeItem('businessConfig');
      // Never carry a previous tenant's custom palette onto the login page or global platform panel.
      applyTheme(DEFAULT_BUSINESS_THEMES.retail);
      setTheme('light');
      setLoadedUserId(null);
      return;
    }
    getBusinessConfig<BusinessConfig>()
      .then((remote) => {
        if (!active) return;
        const normalized = normalizeConfig(remote);
        setConfigState(normalized);
        if (normalized) localStorage.setItem('businessConfig', JSON.stringify(normalized));
        else localStorage.removeItem('businessConfig');
      })
      .catch(() => {
        if (active) setConfigState(null);
      })
      .finally(() => { if (active) setLoadedUserId(user.id); });
    return () => { active = false; };
  }, [user?.id, user?.role]);

  const setConfig = async (nextConfig: BusinessConfig | null) => {
    if (nextConfig === null) {
      setConfigState(null);
      localStorage.removeItem('businessConfig');
      return;
    }
    const normalized = normalizeConfig(nextConfig);
    if (!normalized) throw new Error('La configuración del negocio no es válida.');
    // Persist first: don't tell the UI that a server-side configuration succeeded if it failed.
    const saved = await saveBusinessConfig<BusinessConfig>(normalized);
    const finalConfig = normalizeConfig(saved) || normalized;
    setConfigState(finalConfig);
    localStorage.setItem('businessConfig', JSON.stringify(finalConfig));
  };

  const isFoodBusiness = config?.type === 'restaurant';
  return <BusinessContext.Provider value={{ config, setConfig, isConfigured: !!config, isLoading, isFoodBusiness, hasDelivery: config?.features.delivery ?? false, hasTables: config?.features.tables ?? false }}>{children}</BusinessContext.Provider>;
}
export function useBusiness() {
  const context = useContext(BusinessContext);
  if (!context) throw new Error('useBusiness must be used within BusinessProvider');
  return context;
}
