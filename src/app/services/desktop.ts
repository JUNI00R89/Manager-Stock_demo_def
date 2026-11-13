import { checkLocalServiceSlot, validateSchedule, type ProfessionalSchedule } from '../utils/serviceSchedule';
/**
 * Modo escritorio 100 % local.
 *
 * La app de escritorio no habla con FastAPI: este módulo reemplaza las piezas
 * que antes dependían del servidor (autenticación, configuración, catálogos
 * auxiliares y datos operativos) usando el snapshot `public/desktop-seed.json`
 * y almacenamiento del navegador (localStorage) por negocio.
 *
 * Las credenciales demo van embebidas a propósito: es una aplicación de
 * demostración instalable, no un despliegue de producción.
 */
import type {
  AuthResponse,
  AuthUser,
  BusinessSubscriptionRecord,
  BusinessUserRecord,
  CustomRoleRecord,
  HotelReservationRecord,
  HotelRoomRecord,
  PaidPlanId,
  PlatformAuditRecord,
  PlatformSubscriptionAction,
  PlatformSubscriptionRecord,
  PlatformUserRecord,
  ProductCategoryRecord,
  ServiceAppointmentRecord,
  ServiceCatalogRecord,
  ServiceProfessionalRecord,
  SubscriptionPaymentRecord,
  SubscriptionPlanRecord,
  SupportCaseRecord,
  SupportMessageRecord,
  SuspensionStatusRecord,
} from './dataService';
import type { Product, Supplier } from '../utils/types';

export interface DesktopUser {
  id: string;
  businessId: string | null;
  name: string;
  email: string;
  password: string;
  role: AuthUser['role'];
  active: boolean;
  subscription: 'basic' | 'premium';
  createdAt?: string;
}

export interface DesktopBusinessSeed {
  id: string;
  name: string;
  type: string;
  settings: Record<string, unknown>;
  config: Record<string, unknown> | null;
  products: Product[];
  sales: unknown[];
  suppliers: Supplier[];
  movements: unknown[];
  orders: unknown[];
  recipes: unknown[];
  categories: ProductCategoryRecord[];
  users: BusinessUserRecord[];
  customRoles: CustomRoleRecord[];
  subscription: BusinessSubscriptionRecord | null;
  rooms: HotelRoomRecord[];
  reservations: HotelReservationRecord[];
  services: {
    catalog: ServiceCatalogRecord[];
    professionals: ServiceProfessionalRecord[];
    appointments: ServiceAppointmentRecord[];
  };
}

export interface DesktopSeed {
  version: number;
  kind?: string;
  generatedAt?: string;
  users: DesktopUser[];
  businesses: Record<string, DesktopBusinessSeed>;
}

export interface DesktopDemoAccount {
  label: string;
  detail: string;
  email: string;
  password: string;
}

interface DesktopBusinessMeta {
  reason?: string;
  description?: string;
  suspendedAt?: string;
}

export const DESKTOP_DEMO_ACCOUNTS: DesktopDemoAccount[] = [
  { label: 'Hotel Senderos', detail: 'Hotel', email: 'owner.hotel@managerstock.test', password: 'HotelDemo2026!' },
  { label: 'Sabores del Parque', detail: 'Comidas', email: 'owner.comidas@managerstock.test', password: 'ComidasDemo2026!' },
  { label: 'Tienda Aurora', detail: 'Tienda', email: 'owner.retail@managerstock.test', password: 'TiendaDemo2026!' },
  { label: 'Logística Norte', detail: 'Bodega', email: 'owner.bodega@managerstock.test', password: 'BodegaDemo2026!' },
  { label: 'Estudio Nube', detail: 'Servicios', email: 'owner.servicios@managerstock.test', password: 'ServiciosDemo2026!' },
  { label: 'SUPERADMIN', detail: 'Plataforma', email: 'superadmin@managerstock.test', password: 'SuperAdminDemo2026!' },
];

const USER_KEY = 'manager_stock_desktop_user';
const REGISTERED_USERS_KEY = 'manager_stock_desktop_registered_users_v1';
const DB_PREFIX = 'manager_stock_database_v1';
const CONFIG_PREFIX = 'manager_stock_desktop_config_v1';
const ROOMS_PREFIX = 'manager_stock_desktop_rooms_v1';
const RESERVATIONS_PREFIX = 'manager_stock_desktop_reservations_v1';
const SERVICES_PREFIX = 'manager_stock_desktop_services_v1';
const BUSINESS_USERS_PREFIX = 'manager_stock_desktop_business_users_v1';
const ROLES_PREFIX = 'manager_stock_desktop_roles_v1';
const CATEGORIES_PREFIX = 'manager_stock_desktop_categories_v1';
const USER_STATUS_PREFIX = 'manager_stock_desktop_user_status_v1';
const PLATFORM_STATUS_PREFIX = 'manager_stock_desktop_business_status_v1';
const PLATFORM_BUSINESS_META_PREFIX = 'manager_stock_desktop_business_meta_v1';
const PLATFORM_AUDIT_KEY = 'manager_stock_desktop_platform_audit_v1';
const SUBSCRIPTION_PREFIX = 'manager_stock_desktop_subscription_v1';
const SUBSCRIPTION_PAYMENTS_KEY = 'manager_stock_desktop_subscription_payments_v1';
const BILLING_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
const SUPPORT_KEY = 'manager_stock_desktop_support_v1';
const SUPPORT_CASES_KEY = 'manager_stock_desktop_support_cases_v1';
const SUPPORT_MESSAGES_KEY = 'manager_stock_desktop_support_messages_v1';

const PLANS: SubscriptionPlanRecord[] = [
  { id: 'free', name: 'Gratis', priceCOP: 0, maxUsers: 1, maxProducts: 100 },
  { id: 'entrepreneur', name: 'Emprendedor', priceCOP: 39900, maxUsers: 3, maxProducts: 1000 },
  { id: 'business', name: 'Negocio', priceCOP: 79900, maxUsers: 10, maxProducts: 5000 },
  { id: 'enterprise', name: 'Empresarial', priceCOP: 149900, maxUsers: 25, maxProducts: 20000 },
];

let seedCache: DesktopSeed | null = null;
let seedRequest: Promise<DesktopSeed> | null = null;

export function isDesktopMode(): boolean {
  if (!import.meta.env.VITE_DESKTOP) {
    const bridge = (window as unknown as { managerStockDesktop?: { isDesktop?: boolean } }).managerStockDesktop;
    if (!bridge?.isDesktop) return false;
  }
  return typeof window !== 'undefined';
}

export async function loadDesktopSeed(): Promise<DesktopSeed> {
  if (seedCache) return seedCache;
  if (!seedRequest) {
    seedRequest = fetch('/desktop-seed.json', { cache: 'no-cache' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`No se pudo cargar el paquete de datos local (HTTP ${response.status}).`);
        const data = await response.json() as DesktopSeed;
        seedCache = data;
        return data;
      })
      .finally(() => { seedRequest = null; });
  }
  return seedRequest;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

export function readCurrentDesktopUser(): AuthUser | null {
  const user = readJson<AuthUser | null>(USER_KEY, null);
  return user?.id ? user : null;
}

export function currentBusinessId(): string | null {
  return readCurrentDesktopUser()?.businessId ?? null;
}

function requireBusinessId(): string {
  const businessId = currentBusinessId();
  if (!businessId) throw new Error('La cuenta no tiene un negocio asociado.');
  return businessId;
}

export function desktopDatabaseKey(): string {
  return `${DB_PREFIX}:${currentBusinessId() || 'invitado'}`;
}

export function databaseKeyFor(businessId: string): string {
  return `${DB_PREFIX}:${businessId}`;
}

function configKey(businessId: string) { return `${CONFIG_PREFIX}:${businessId}`; }
function roomsKey(businessId: string) { return `${ROOMS_PREFIX}:${businessId}`; }
function reservationsKey(businessId: string) { return `${RESERVATIONS_PREFIX}:${businessId}`; }
function servicesKey(businessId: string) { return `${SERVICES_PREFIX}:${businessId}`; }
function businessUsersKey(businessId: string) { return `${BUSINESS_USERS_PREFIX}:${businessId}`; }
function rolesKey(businessId: string) { return `${ROLES_PREFIX}:${businessId}`; }
function categoriesKey(businessId: string) { return `${CATEGORIES_PREFIX}:${businessId}`; }
function subscriptionKey(businessId: string) { return `${SUBSCRIPTION_PREFIX}:${businessId}`; }

function readRegisteredUsers(): DesktopUser[] {
  return readJson<DesktopUser[]>(REGISTERED_USERS_KEY, []);
}

function writeRegisteredUsers(users: DesktopUser[]) {
  writeJson(REGISTERED_USERS_KEY, users);
}

function readPlatformAuditEntries(): PlatformAuditRecord[] {
  const entries = readJson<PlatformAuditRecord[]>(PLATFORM_AUDIT_KEY, []);
  return Array.isArray(entries) ? entries : [];
}

function appendPlatformAudit(action: string, entityId: string, details: Record<string, unknown> = {}) {
  const entries = readPlatformAuditEntries();
  const actor = readCurrentDesktopUser();
  const nextId = Math.max(Date.now(), ...entries.map(entry => Number(entry.id) || 0), 0) + 1;
  const entry: PlatformAuditRecord = {
    id: nextId,
    actorId: actor?.id || 'local',
    actorName: actor?.name || 'Administrador local',
    action,
    entityId,
    details,
    createdAt: new Date().toISOString(),
  };
  writeJson(PLATFORM_AUDIT_KEY, [entry, ...entries].slice(0, 500));
}

function readSupportCases(): SupportCaseRecord[] {
  const cases = readJson<SupportCaseRecord[]>(SUPPORT_CASES_KEY, []);
  return Array.isArray(cases) ? cases : [];
}

function writeSupportCases(cases: SupportCaseRecord[]) {
  writeJson(SUPPORT_CASES_KEY, cases);
}

function readSupportMessages(): Record<string, SupportMessageRecord[]> {
  const messages = readJson<Record<string, SupportMessageRecord[]>>(SUPPORT_MESSAGES_KEY, {});
  return messages && typeof messages === 'object' && !Array.isArray(messages) ? messages : {};
}

function writeSupportMessages(messages: Record<string, SupportMessageRecord[]>) {
  writeJson(SUPPORT_MESSAGES_KEY, messages);
}

function latestSupportCase(businessId: string): SupportCaseRecord | null {
  return readSupportCases()
    .filter(item => item.businessId === businessId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0] || null;
}

function openSupportCase(businessId: string, businessName: string, reason: string, description: string): SupportCaseRecord {
  const cases = readSupportCases();
  const now = new Date().toISOString();
  const existing = cases.find(item => item.businessId === businessId && !['resolved', 'closed'].includes(item.status));
  if (existing) {
    const updated = { ...existing, businessName, reason: reason || existing.reason, description: description || existing.description, updatedAt: now, unreadCount: existing.unreadCount || 0 };
    writeSupportCases(cases.map(item => item.id === existing.id ? updated : item));
    return updated;
  }
  const created: SupportCaseRecord = {
    id: `SUP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    businessId,
    businessName,
    reason: reason || 'Suspensión administrativa',
    description: description || '',
    status: 'open',
    createdAt: now,
    updatedAt: now,
    unreadCount: 0,
  };
  writeSupportCases([...cases, created]);
  const messages = readSupportMessages();
  messages[created.id] = [];
  writeSupportMessages(messages);
  return created;
}

function resolveOpenSupportCases(businessId: string, status: SupportCaseRecord['status']) {
  const cases = readSupportCases();
  const now = new Date().toISOString();
  writeSupportCases(cases.map(item => item.businessId === businessId && !['resolved', 'closed'].includes(item.status) ? { ...item, status, updatedAt: now } : item));
}

function setLocalBusinessActive(businessId: string, active: boolean) {
  const statuses = readJson<Record<string, boolean>>(PLATFORM_STATUS_PREFIX, {});
  writeJson(PLATFORM_STATUS_PREFIX, { ...statuses, [businessId]: active });
  if (active) {
    const meta = readJson<Record<string, DesktopBusinessMeta>>(PLATFORM_BUSINESS_META_PREFIX, {});
    delete meta[businessId];
    writeJson(PLATFORM_BUSINESS_META_PREFIX, meta);
  }
}

function desktopBusinessName(businessId: string, fallback = 'Mi negocio') {
  const config = readJson<{ name?: string }>(configKey(businessId), null);
  return config?.name || seedCache?.businesses?.[businessId]?.name || fallback;
}

function toAuthUser(user: DesktopUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    businessId: user.businessId,
    active: user.active,
    businessActive: true,
    subscription: user.subscription,
  };
}

function emptyDatabase() {
  return {
    version: 1 as const,
    products: [] as Product[],
    suppliers: [] as Supplier[],
    sales: [] as unknown[],
    recipes: [] as unknown[],
    orders: [] as unknown[],
    movements: [] as unknown[],
    cashSession: null,
  };
}

function normalizeOrder(row: any) {
  return {
    id: row.id,
    channel: row.channel,
    customer: row.customer,
    phone: row.phone,
    address: row.address,
    status: row.status,
    notes: row.notes || '',
    total: row.total,
    created_at: row.created_at || row.createdAt,
    items: (row.items || []).map((item: any) => ({
      productId: item.product_id || item.productId,
      productName: item.product_name || item.productName,
      quantity: item.quantity,
      unitPrice: item.unit_price || item.unitPrice,
      notes: item.notes,
    })),
  };
}

export function seedDatabaseForBusiness(businessId: string, seed: DesktopSeed | null) {
  const key = databaseKeyFor(businessId);
  if (localStorage.getItem(key)) return;
  const business = seed?.businesses?.[businessId];
  if (!business) {
    writeJson(key, emptyDatabase());
    return;
  }
  writeJson(key, {
    version: 1,
    products: Array.isArray(business.products) ? business.products : [],
    suppliers: Array.isArray(business.suppliers) ? business.suppliers : [],
    sales: Array.isArray(business.sales) ? business.sales : [],
    recipes: Array.isArray(business.recipes) ? business.recipes : [],
    orders: Array.isArray(business.orders) ? business.orders.map(normalizeOrder) : [],
    movements: Array.isArray(business.movements) ? business.movements : [],
    cashSession: null,
  });
}

function toBusinessUser(user: DesktopUser): BusinessUserRecord {
  return {
    id: user.id,
    businessId: user.businessId || '',
    name: user.name,
    email: user.email,
    role: (user.role === 'owner' ? 'owner' : user.role === 'business_admin' ? 'business_admin' : 'cashier') as BusinessUserRecord['role'],
    customRoleId: null,
    customRoleName: null,
    active: user.active,
    createdAt: user.createdAt || new Date().toISOString(),
  };
}

function publicBusinessUser(user: DesktopUser): PlatformUserRecord {
  const seedUser = seedCache?.users.find(item => item.id === user.id);
  const businessId = user.businessId ?? seedUser?.businessId ?? null;
  const business = businessId ? seedCache?.businesses[businessId] : null;
  const override = readJson<Record<string, boolean>>(USER_STATUS_PREFIX, {})[user.id];
  return {
    id: user.id,
    businessId,
    businessName: business?.name ?? (businessId ? readJson<any>(configKey(businessId), null)?.name ?? null : null),
    name: user.name,
    email: user.email,
    role: user.role,
    active: override ?? user.active,
    createdAt: user.createdAt || seedCache?.generatedAt || new Date().toISOString(),
  };
}

function applyUserStatus(user: BusinessUserRecord): BusinessUserRecord {
  const override = readJson<Record<string, boolean>>(USER_STATUS_PREFIX, {})[user.id];
  return override === undefined ? user : { ...user, active: override };
}

function findRegisteredByBusiness(businessId: string): DesktopUser[] {
  return readRegisteredUsers().filter(user => user.businessId === businessId);
}

function allSeedUsers(): DesktopUser[] {
  return seedCache?.users ?? [];
}

function allUsersWithSeed(): DesktopUser[] {
  return [...allSeedUsers(), ...readRegisteredUsers()];
}

async function ensureSeedLoaded(): Promise<DesktopSeed | null> {
  try { return await loadDesktopSeed(); } catch { return null; }
}

/** Plan vigente con las mismas reglas de vencimiento que backend/services/subscriptions.py. */
function subscriptionFor(businessId: string): BusinessSubscriptionRecord {
  const saved = readJson<BusinessSubscriptionRecord | null>(subscriptionKey(businessId), null) ?? seedCache?.businesses?.[businessId]?.subscription ?? null;
  if (saved) return applySubscriptionExpiry(businessId, saved);
  return {
    businessId,
    plan: PLANS[0],
    status: 'active',
    pendingPlan: null,
    startedAt: null,
    expiresAt: null,
    updatedAt: null,
  };
}

function applySubscriptionExpiry(businessId: string, record: BusinessSubscriptionRecord): BusinessSubscriptionRecord {
  const inForce = record.status === 'active' || record.status === 'pending_payment';
  if (!inForce || !record.expiresAt) return record;
  const expires = Date.parse(record.expiresAt);
  if (Number.isFinite(expires) && expires > Date.now()) return record;
  const now = new Date().toISOString();
  // Con una renovación pendiente baja a Gratis, pero la solicitud se conserva.
  const updated: BusinessSubscriptionRecord = record.status === 'pending_payment'
    ? { ...record, plan: PLANS[0], expiresAt: null, updatedAt: now }
    : { ...record, plan: PLANS[0], status: 'expired', pendingPlan: null, updatedAt: now };
  writeJson(subscriptionKey(businessId), updated);
  return updated;
}

type StoredSubscriptionPayment = SubscriptionPaymentRecord & { businessId: string };

function readSubscriptionPayments(): StoredSubscriptionPayment[] {
  return readJson<StoredSubscriptionPayment[]>(SUBSCRIPTION_PAYMENTS_KEY, []);
}

function lastSubscriptionPayment(businessId: string): SubscriptionPaymentRecord | null {
  const payment = readSubscriptionPayments().find(item => item.businessId === businessId);
  if (!payment) return null;
  const { businessId: _owner, ...rest } = payment;
  return rest;
}

/** Igual que apply_verified_payment del backend: el mismo plan vigente se extiende desde su vencimiento. */
function applyVerifiedSubscriptionPayment(businessId: string, current: BusinessSubscriptionRecord, planId: PaidPlanId, paymentReference: string): BusinessSubscriptionRecord {
  const plan = PLANS.find(item => item.id === planId);
  if (!plan || plan.priceCOP <= 0) throw new Error('Solo se pueden registrar pagos de planes de pago.');
  const reference = paymentReference.trim();
  if (reference.length < 4) throw new Error('Registra una referencia de pago verificada antes de activar el plan.');
  const payments = readSubscriptionPayments();
  if (payments.some(item => item.paymentReference === reference)) throw new Error('Esa referencia de pago ya se registró. Cada cobro solo puede sumar un periodo.');
  const now = Date.now();
  const currentExpiry = current.expiresAt ? Date.parse(current.expiresAt) : NaN;
  const samePlanInForce = current.plan.id === planId && (current.status === 'active' || current.status === 'pending_payment') && Number.isFinite(currentExpiry) && currentExpiry > now;
  const periodStart = samePlanInForce ? currentExpiry : now;
  const periodEnd = periodStart + BILLING_PERIOD_MS;
  const nowIso = new Date(now).toISOString();
  const payment: StoredSubscriptionPayment = {
    businessId, planId, amountCOP: plan.priceCOP, paymentReference: reference,
    periodStart: new Date(periodStart).toISOString(), periodEnd: new Date(periodEnd).toISOString(), createdAt: nowIso,
  };
  writeJson(SUBSCRIPTION_PAYMENTS_KEY, [payment, ...payments].slice(0, 2000));
  const updated: BusinessSubscriptionRecord = {
    ...current, plan, status: 'active', pendingPlan: null,
    startedAt: samePlanInForce ? current.startedAt : nowIso,
    expiresAt: new Date(periodEnd).toISOString(), updatedAt: nowIso,
  };
  writeJson(subscriptionKey(businessId), updated);
  return updated;
}

export const desktop = {
  auth: {
    async login(email: string, password: string): Promise<AuthResponse> {
      const seed = await loadDesktopSeed();
      const candidate = allUsersWithSeed().find(user => normalizedEmail(user.email) === normalizedEmail(email));
      if (!candidate || candidate.password !== password) throw new Error('Correo o contraseña incorrectos.');
      if (!candidate.active) throw new Error('Esta cuenta está inactiva.');
      const user = toAuthUser(candidate);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      if (candidate.businessId) seedDatabaseForBusiness(candidate.businessId, seed);
      return { access_token: 'desktop-local-session', token_type: 'bearer', user };
    },
    async me(): Promise<AuthUser> {
      const user = readCurrentDesktopUser();
      if (!user) throw new Error('No hay una sesión local activa.');
      if (user.businessId && !localStorage.getItem(databaseKeyFor(user.businessId))) {
        const seed = await ensureSeedLoaded();
        seedDatabaseForBusiness(user.businessId, seed);
      }
      return user;
    },
    async logout(): Promise<{ ok: boolean }> {
      localStorage.removeItem(USER_KEY);
      return { ok: true };
    },
    async register(name: string, email: string, password: string): Promise<AuthResponse> {
      const cleanEmail = normalizedEmail(email);
      if (!cleanEmail.includes('@')) throw new Error('Ingresa un correo electrónico válido.');
      if (password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
      const seed = await ensureSeedLoaded();
      if (allUsersWithSeed().some(user => normalizedEmail(user.email) === cleanEmail)) {
        throw new Error('Ya existe una cuenta con ese correo electrónico.');
      }
      const user: DesktopUser = {
        id: uid('USUARIO'),
        businessId: uid('NEGOCIO'),
        name: name.trim() || 'Mi negocio',
        email: cleanEmail,
        password,
        role: 'owner',
        active: true,
        subscription: 'basic',
        createdAt: new Date().toISOString(),
      };
      writeRegisteredUsers([...readRegisteredUsers(), user]);
      writeJson(databaseKeyFor(user.businessId!), emptyDatabase());
      const authUser = toAuthUser(user);
      localStorage.setItem(USER_KEY, JSON.stringify(authUser));
      return { access_token: 'desktop-local-session', token_type: 'bearer', user: authUser };
    },
  },

  config: {
    async get<T>(): Promise<T | null> {
      const businessId = currentBusinessId();
      if (!businessId) return null;
      const saved = readJson<T | null>(configKey(businessId), null);
      if (saved) return saved;
      const seed = await ensureSeedLoaded();
      const business = seed?.businesses?.[businessId];
      return (business?.config ?? business?.settings ?? null) as T | null;
    },
    async save<T>(config: T): Promise<T> {
      const businessId = requireBusinessId();
      writeJson(configKey(businessId), config);
      return config;
    },
  },

  database: {
    key: desktopDatabaseKey,
    seed: seedDatabaseForBusiness,
  },

  categories: {
    async list(): Promise<ProductCategoryRecord[]> {
      const businessId = requireBusinessId();
      const saved = readJson<ProductCategoryRecord[] | null>(categoriesKey(businessId), null);
      if (saved) return saved;
      const seed = await ensureSeedLoaded();
      const seeded = seed?.businesses?.[businessId]?.categories ?? [];
      if (seeded.length) return seeded;
      const database = readJson<any>(databaseKeyFor(businessId), null);
      const products: Product[] = Array.isArray(database?.products) ? database.products : [];
      const names = [...new Set(products.map(product => product.category).filter(Boolean))];
      return names.map((name, index) => ({ id: `categoria-local-${index + 1}`, name, description: '', active: true, custom: false, createdAt: null }));
    },
    async create(payload: { name: string; description?: string; active?: boolean }): Promise<ProductCategoryRecord> {
      const businessId = requireBusinessId();
      const current = await this.list();
      if (!payload.name.trim()) throw new Error('Escribe el nombre de la categoría.');
      if (current.some(category => category.name.toLowerCase() === payload.name.trim().toLowerCase())) {
        throw new Error('Ya existe una categoría con ese nombre.');
      }
      const created: ProductCategoryRecord = {
        id: uid('CAT'),
        name: payload.name.trim(),
        description: payload.description || '',
        active: payload.active !== false,
        custom: true,
        createdAt: new Date().toISOString(),
      };
      writeJson(categoriesKey(businessId), [...current, created]);
      return created;
    },
  },

  hotel: {
    async rooms(): Promise<HotelRoomRecord[]> {
      const businessId = requireBusinessId();
      const saved = readJson<HotelRoomRecord[] | null>(roomsKey(businessId), null);
      if (saved) return saved;
      const seed = await ensureSeedLoaded();
      const rooms = seed?.businesses?.[businessId]?.rooms ?? [];
      writeJson(roomsKey(businessId), rooms);
      return rooms;
    },
    async updateHousekeeping(id: string, input: { cleaningStatus: import('./dataService').CleaningStatus; cleaningAssignee: string; expectedStatus?: string }): Promise<HotelRoomRecord> {
      const rooms = await this.rooms();
      const room = rooms.find(row => row.id === id);
      if (!room) throw new Error('Habitación no encontrada.');
      const current = room.cleaningStatus || (room.status === 'cleaning' ? 'sucia' : 'inspeccionada');
      if (input.expectedStatus && input.expectedStatus !== current) throw new Error('La limpieza cambió. Actualiza el tablero.');
      const reservations = await this.reservations();
      const reserved = reservations.some(r => r.roomId === id && r.status === 'confirmed' && r.checkOut > new Date().toISOString().slice(0, 10));
      const updated: HotelRoomRecord = { ...room, cleaningStatus: input.cleaningStatus, cleaningAssignee: input.cleaningAssignee.trim(), updatedAt: new Date().toISOString(),
        status: ['occupied', 'maintenance'].includes(room.status) ? room.status : input.cleaningStatus === 'inspeccionada' ? (reserved ? 'reserved' : 'available') : 'cleaning' };
      writeJson(roomsKey(requireBusinessId()), rooms.map(row => row.id === id ? updated : row));
      return updated;
    },
    async createRoom(input: any): Promise<HotelRoomRecord> {
      const businessId = requireBusinessId();
      const rooms = await this.rooms();
      const roomNumber = String(input.roomNumber || input.number || '').trim();
      if (!roomNumber) throw new Error('Escribe el número de habitación.');
      if (rooms.some(room => room.roomNumber === roomNumber)) throw new Error('Ya existe una habitación con ese número.');
      const created: HotelRoomRecord = {
        id: uid('HAB'),
        number: roomNumber,
        roomNumber,
        type: input.type || input.roomType || 'simple',
        roomType: input.roomType || input.type || 'simple',
        floor: Number(input.floor) || 1,
        capacity: Number(input.capacity) || 1,
        pricePerNight: Number(input.pricePerNight) || 0,
        status: input.status || 'available',
        cleaningStatus: input.status === 'cleaning' ? 'sucia' : 'inspeccionada',
        cleaningAssignee: '',
        amenities: Array.isArray(input.amenities) ? input.amenities : [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      writeJson(roomsKey(businessId), [...rooms, created]);
      return created;
    },
    async reservations(): Promise<HotelReservationRecord[]> {
      const businessId = requireBusinessId();
      const saved = readJson<HotelReservationRecord[] | null>(reservationsKey(businessId), null);
      if (saved) return saved;
      const seed = await ensureSeedLoaded();
      const reservations = seed?.businesses?.[businessId]?.reservations ?? [];
      writeJson(reservationsKey(businessId), reservations);
      return reservations;
    },
    async createReservation(input: { roomId: string; guestName: string; guestEmail?: string; guestPhone?: string; checkIn: string; checkOut: string; advance?: number }): Promise<HotelReservationRecord> {
      const businessId = requireBusinessId();
      const rooms = await this.rooms();
      const room = rooms.find(item => item.id === input.roomId);
      if (!room) throw new Error('Selecciona una habitación válida.');
      const checkIn = new Date(`${input.checkIn}T12:00:00`);
      const checkOut = new Date(`${input.checkOut}T12:00:00`);
      const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000);
      if (!Number.isFinite(nights) || nights <= 0) throw new Error('La fecha de salida debe ser posterior a la de entrada.');
      const created: HotelReservationRecord = {
        id: uid('RES'),
        roomId: room.id,
        roomNumber: room.roomNumber,
        guestName: input.guestName.trim(),
        guestEmail: input.guestEmail || '',
        guestPhone: input.guestPhone || '',
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        status: 'confirmed',
        advance: Number(input.advance) || 0,
        totalCharges: room.pricePerNight * nights,
        nights,
        createdAt: new Date().toISOString(),
      };
      const reservations = await this.reservations();
      if (['maintenance','cleaning'].includes(room.status)) throw new Error('La habitación no está habilitada para reservas.');
      if (reservations.some(r => r.roomId === room.id && ['confirmed','checkin'].includes(r.status) && r.checkIn < input.checkOut && r.checkOut > input.checkIn)) throw new Error('Ya existe una reserva durante ese periodo.');
      if (!Number.isFinite(created.advance) || created.advance < 0 || created.advance > created.totalCharges) throw new Error('Anticipo no válido.');
      writeJson(reservationsKey(businessId), [created, ...reservations]);
      writeJson(roomsKey(businessId), rooms.map(item => item.id === room.id && item.status === 'available' ? { ...item, status: 'reserved' } : item));
      return created;
    },
    async moveReservation(id: string, input: import('./dataService').HotelScheduleInput): Promise<HotelReservationRecord> {
      const businessId = requireBusinessId();
      const rooms = await this.rooms();
      const reservations = await this.reservations();
      const current = reservations.find(r => r.id === id);
      if (!current || current.status !== 'confirmed') throw new Error('Solo se pueden mover reservas confirmadas antes del check-in.');
      const nights = (Date.parse(input.expectedCheckOut) - Date.parse(input.expectedCheckIn)) / 86400000;
      const start = Date.parse(input.checkIn);
      if (!Number.isFinite(start) || !Number.isFinite(nights) || nights < 1) throw new Error('Fechas no válidas.');
      const checkOut = new Date(start + nights * 86400000).toISOString().slice(0,10);
      if (current.roomId === input.roomId && current.checkIn === input.checkIn && current.checkOut === checkOut) return current;
      if (current.roomId !== input.expectedRoomId || current.checkIn !== input.expectedCheckIn || current.checkOut !== input.expectedCheckOut) throw new Error('La reserva cambió. Actualiza el calendario.');
      const room = rooms.find(r => r.id === input.roomId);
      if (!room || ['maintenance','cleaning'].includes(room.status)) throw new Error('Habitación no disponible.');
      if (reservations.some(r => r.id !== id && r.roomId === input.roomId && ['confirmed','checkin'].includes(r.status) && r.checkIn < checkOut && r.checkOut > input.checkIn)) throw new Error('Ya existe una reserva durante ese periodo.');
      const updated = { ...current, roomId: room.id, roomNumber: room.number, checkIn: input.checkIn, checkOut, nights };
      const next = reservations.map(r => r.id === id ? updated : r);
      writeJson(reservationsKey(businessId), next);
      writeJson(roomsKey(businessId), rooms.map(r => {
        if (![current.roomId,room.id].includes(r.id) || ['maintenance','cleaning'].includes(r.status)) return r;
        const status: HotelRoomRecord['status'] = next.some(b => b.roomId === r.id && b.status === 'checkin') ? 'occupied' : next.some(b => b.roomId === r.id && b.status === 'confirmed' && b.checkOut > new Date().toISOString().slice(0,10)) ? 'reserved' : 'available';
        return { ...r, status };
      }));
      return updated;
    },
    async updateReservationStatus(id: string, status: HotelReservationRecord['status']): Promise<HotelReservationRecord> {
      const businessId = requireBusinessId();
      const reservations = await this.reservations();
      const reservation = reservations.find(item => item.id === id);
      if (!reservation) throw new Error('No se encontró la reserva.');
      const updated = { ...reservation, status };
      writeJson(reservationsKey(businessId), reservations.map(item => item.id === id ? updated : item));
      const rooms = await this.rooms();
      const dirty = status === 'checkout' && reservation.status === 'checkin';
      const nextReservations = reservations.map(item => item.id === id ? updated : item);
      const occupied = nextReservations.some(item => item.roomId === reservation.roomId && item.status === 'checkin');
      const reserved = nextReservations.some(item => item.roomId === reservation.roomId && item.status === 'confirmed' && item.checkOut > new Date().toISOString().slice(0, 10));
      writeJson(roomsKey(businessId), rooms.map(room => {
        if (room.id !== reservation.roomId) return room;
        let roomStatus: HotelRoomRecord['status'] = ['maintenance', 'cleaning'].includes(room.status) ? room.status : occupied ? 'occupied' : reserved ? 'reserved' : 'available';
        if (dirty && roomStatus === 'available') roomStatus = 'cleaning';
        return { ...room, status: roomStatus, ...(dirty ? { cleaningStatus: 'sucia' as const, cleaningAssignee: '' } : {}) };
      }));
      return updated;
    },
  },

  services: {
    async data() {
      const businessId = requireBusinessId();
      const saved = readJson<any | null>(servicesKey(businessId), null);
      if (saved) return saved;
      const seed = await ensureSeedLoaded();
      const seeded = seed?.businesses?.[businessId]?.services ?? { catalog: [], professionals: [], appointments: [] };
      writeJson(servicesKey(businessId), seeded);
      return seeded;
    },
    async catalog(): Promise<ServiceCatalogRecord[]> {
      return (await this.data()).catalog;
    },
    async professionals(): Promise<ServiceProfessionalRecord[]> {
      return (await this.data()).professionals;
    },
    async appointments(): Promise<ServiceAppointmentRecord[]> {
      return (await this.data()).appointments;
    },
    async createCatalogItem(input: { name: string; durationMinutes: number; price: number; category?: string; color?: string }): Promise<ServiceCatalogRecord> {
      const businessId = requireBusinessId();
      const data = await this.data();
      const name = input.name.trim();
      if (!name) throw new Error('Escribe el nombre del servicio.');
      const created: ServiceCatalogRecord = {
        id: uid('SVC'),
        nombre: name,
        name,
        duracion: Number(input.durationMinutes) || 30,
        durationMinutes: Number(input.durationMinutes) || 30,
        precio: Number(input.price) || 0,
        price: Number(input.price) || 0,
        categoria: input.category || 'Servicios',
        category: input.category || 'Servicios',
        color: input.color || '#315F68',
        active: true,
      };
      writeJson(servicesKey(businessId), { ...data, catalog: [...data.catalog, created] });
      return created;
    },
    async createProfessional(input: { name: string; specialty?: string; color?: string; availability?: { dia?: number; inicio?: string; fin?: string }[] }): Promise<ServiceProfessionalRecord> {
      const businessId = requireBusinessId();
      const data = await this.data();
      const name = input.name.trim();
      if (!name) throw new Error('Escribe el nombre del profesional.');
      const availability = input.availability || [];
      const created: ServiceProfessionalRecord = {
        id: uid('PROF'),
        nombre: name,
        name,
        especialidad: input.specialty || '',
        specialty: input.specialty || '',
        color: input.color || '#315F68',
        horario: availability,
        availability,
        active: true,
      };
      writeJson(servicesKey(businessId), { ...data, professionals: [...data.professionals, created] });
      return created;
    },
    async moveAppointment(id: string, input: import('./dataService').AppointmentMoveInput): Promise<ServiceAppointmentRecord> {
      const businessId = requireBusinessId(); const data = await this.data();
      const old = data.appointments.find(a => a.id === id);
      if (!old) throw new Error('Cita no encontrada.');
      if (old.saleId || !['reserved', 'confirmed'].includes(old.estado)) throw new Error('Solo puedes mover citas pendientes sin cobrar.');
      if (old.profesionalId === input.professionalId && old.fecha === input.appointmentDate && old.horaInicio === input.startTime) return old;
      if (old.profesionalId !== input.expectedProfessionalId || old.fecha !== input.expectedDate || old.horaInicio !== input.expectedStartTime || old.horaFin !== input.expectedEndTime) throw new Error('La cita cambió. Actualiza antes de moverla.');
      const pro = data.professionals.find(p => p.id === input.professionalId && p.active);
      if (!pro) throw new Error('Profesional no encontrado.');
      checkLocalServiceSlot(pro, data.appointments, input.appointmentDate, input.startTime, old.durationMinutes, id);
      const [h, m] = input.startTime.split(':').map(Number); const end = h * 60 + m + old.durationMinutes;
      const updated = { ...old, profesionalId: pro.id, profesionalNombre: pro.name, fecha: input.appointmentDate, horaInicio: input.startTime, horaFin: `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}` };
      writeJson(servicesKey(businessId), { ...data, appointments: data.appointments.map(a => a.id === id ? updated : a) });
      return updated;
    },
    async saveSchedule(id: string, input: ProfessionalSchedule): Promise<ServiceProfessionalRecord> {
      validateSchedule(input);
      const businessId = requireBusinessId(); const data = await this.data();
      const old = data.professionals.find(p => p.id === id);
      if (!old || (old.scheduleRevision || 1) !== input.revision) throw new Error('El horario cambió. Actualiza antes de guardarlo.');
      const updated = { ...old, availability: input.availability, horario: input.availability, daysOff: input.daysOff, bufferMinutes: input.bufferMinutes, scheduleRevision: input.revision + 1 };
      writeJson(servicesKey(businessId), { ...data, professionals: data.professionals.map(p => p.id === id ? updated : p) });
      return updated;
    },
    async createAppointment(input: { serviceId: string; professionalId: string; clientName: string; clientEmail?: string; clientPhone?: string; appointmentDate: string; startTime: string; notes?: string }): Promise<ServiceAppointmentRecord> {
      const businessId = requireBusinessId();
      const data = await this.data();
      const service = data.catalog.find((item: ServiceCatalogRecord) => item.id === input.serviceId);
      const professional = data.professionals.find((item: ServiceProfessionalRecord) => item.id === input.professionalId);
      if (!service) throw new Error('Selecciona un servicio válido.');
      if (!professional) throw new Error('Selecciona un profesional válido.');
      const duration = service.durationMinutes || service.duracion || 30;
      checkLocalServiceSlot(professional, data.appointments, input.appointmentDate, input.startTime, duration, '');
      const [hours, minutes] = input.startTime.split(':').map(Number);
      const end = new Date(2000, 0, 1, hours || 0, (minutes || 0) + duration);
      const endTime = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
      const created: ServiceAppointmentRecord = {
        id: uid('CITA'),
        clienteId: null,
        clienteNombre: input.clientName.trim(),
        clienteTelefono: input.clientPhone || '',
        clienteEmail: input.clientEmail || '',
        servicioId: service.id,
        servicioNombre: service.name,
        profesionalId: professional.id,
        profesionalNombre: professional.name,
        fecha: input.appointmentDate,
        horaInicio: input.startTime,
        horaFin: endTime,
        estado: 'reserved',
        notes: input.notes || '',
        durationMinutes: duration,
        price: service.price,
        createdAt: new Date().toISOString(),
      };
      writeJson(servicesKey(businessId), { ...data, appointments: [created, ...data.appointments] });
      return created;
    },
    async editAppointment(id: string, input: { serviceId: string; professionalId: string; clientName: string; clientEmail?: string; clientPhone?: string; appointmentDate: string; startTime: string; notes?: string }): Promise<ServiceAppointmentRecord> {
      const businessId = requireBusinessId();
      const data = await this.data();
      const current = data.appointments.find((item: ServiceAppointmentRecord) => item.id === id);
      if (!current) throw new Error('No se encontró la cita.');
      const service = data.catalog.find((item: ServiceCatalogRecord) => item.id === input.serviceId) || data.catalog.find((item: ServiceCatalogRecord) => item.id === current.servicioId);
      const professional = data.professionals.find((item: ServiceProfessionalRecord) => item.id === input.professionalId) || data.professionals.find((item: ServiceProfessionalRecord) => item.id === current.profesionalId);
      if (!service || !professional) throw new Error('Servicio o profesional no válido.');
      const sameService = service.id === current.servicioId;
      const duration = sameService ? (current.durationMinutes || service.durationMinutes || service.duracion || 30) : (service.durationMinutes || service.duracion || 30);
      checkLocalServiceSlot(professional, data.appointments, input.appointmentDate, input.startTime, duration, id);
      const [hours, minutes] = input.startTime.split(':').map(Number);
      const end = new Date(2000, 0, 1, hours || 0, (minutes || 0) + duration);
      const endTime = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
      const updated: ServiceAppointmentRecord = {
        ...current,
        clienteNombre: input.clientName.trim(),
        clienteTelefono: input.clientPhone || '',
        clienteEmail: input.clientEmail || '',
        servicioId: service.id,
        servicioNombre: service.name,
        profesionalId: professional.id,
        profesionalNombre: professional.name,
        fecha: input.appointmentDate,
        horaInicio: input.startTime,
        horaFin: endTime,
        notes: input.notes || '',
        durationMinutes: duration,
        price: sameService ? current.price : service.price,
      };
      writeJson(servicesKey(businessId), { ...data, appointments: data.appointments.map((item: ServiceAppointmentRecord) => item.id === id ? updated : item) });
      return updated;
    },
    async deleteAppointment(id: string): Promise<void> {
      const businessId = requireBusinessId();
      const data = await this.data();
      writeJson(servicesKey(businessId), { ...data, appointments: data.appointments.filter((item: ServiceAppointmentRecord) => item.id !== id) });
    },
    async updateAppointmentStatus(id: string, status: ServiceAppointmentRecord['estado']): Promise<ServiceAppointmentRecord> {
      const businessId = requireBusinessId();
      const data = await this.data();
      const current = data.appointments.find((item: ServiceAppointmentRecord) => item.id === id);
      if (!current) throw new Error('No se encontró la cita.');
      if (current.saleId && status !== 'attended') throw new Error('La cita ya fue cobrada.');
      if (status === 'reserved' || status === 'confirmed') {
        const pro = data.professionals.find(p => p.id === current.profesionalId);
        if (!pro) throw new Error('Profesional no encontrado.');
        checkLocalServiceSlot(pro, data.appointments, current.fecha, current.horaInicio, current.durationMinutes, id);
      }
      const updated = { ...current, estado: status };
      writeJson(servicesKey(businessId), { ...data, appointments: data.appointments.map((item: ServiceAppointmentRecord) => item.id === id ? updated : item) });
      return updated;
    },
  },

  users: {
    async list(): Promise<BusinessUserRecord[]> {
      const businessId = requireBusinessId();
      if (!seedCache) await ensureSeedLoaded();
      const seeded = seedCache?.businesses?.[businessId]?.users ?? [];
      const registered = findRegisteredByBusiness(businessId).map(toBusinessUser);
      const extras = readJson<BusinessUserRecord[]>(businessUsersKey(businessId), []);
      const merged = new Map<string, BusinessUserRecord>();
      [...seeded, ...extras, ...registered].forEach(user => merged.set(user.id, applyUserStatus(user)));
      return [...merged.values()];
    },
    async create(payload: { name: string; email: string; password: string; role: 'business_admin' | 'cashier'; customRoleId?: string | null }): Promise<BusinessUserRecord> {
      const businessId = requireBusinessId();
      const email = normalizedEmail(payload.email);
      if (allUsersWithSeed().some(user => normalizedEmail(user.email) === email)) throw new Error('Ya existe una cuenta con ese correo.');
      if (!payload.password || payload.password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
      const user: DesktopUser = {
        id: uid('USUARIO'),
        businessId,
        name: payload.name.trim(),
        email,
        password: payload.password,
        role: payload.role,
        active: true,
        subscription: 'basic',
        createdAt: new Date().toISOString(),
      };
      writeRegisteredUsers([...readRegisteredUsers(), user]);
      const created = toBusinessUser(user);
      return { ...created, customRoleId: payload.customRoleId || null };
    },
    async update(id: string, patch: { role?: 'business_admin' | 'cashier'; customRoleId?: string | null; active?: boolean }): Promise<BusinessUserRecord> {
      const businessId = requireBusinessId();
      const registered = readRegisteredUsers();
      const target = registered.find(user => user.id === id);
      if (target) {
        const updated = { ...target, role: (patch.role || target.role) as DesktopUser['role'], active: patch.active ?? target.active };
        writeRegisteredUsers(registered.map(user => user.id === id ? updated : user));
        return { ...toBusinessUser(updated), customRoleId: patch.customRoleId || null };
      }
      if (patch.active !== undefined) {
        const statuses = readJson<Record<string, boolean>>(USER_STATUS_PREFIX, {});
        writeJson(USER_STATUS_PREFIX, { ...statuses, [id]: patch.active });
      }
      const seeded = (seedCache?.businesses?.[businessId]?.users ?? []).find(user => user.id === id);
      if (!seeded) throw new Error('No se encontró el usuario.');
      return {
        ...seeded,
        role: patch.role || seeded.role,
        active: patch.active ?? seeded.active,
        customRoleId: patch.customRoleId ?? seeded.customRoleId,
      };
    },
    async roles(): Promise<CustomRoleRecord[]> {
      const businessId = requireBusinessId();
      if (!seedCache) await ensureSeedLoaded();
      const seeded = seedCache?.businesses?.[businessId]?.customRoles ?? [];
      return [...seeded, ...readJson<CustomRoleRecord[]>(rolesKey(businessId), [])];
    },
    async createRole(payload: { name: string; permissions: string[] }): Promise<CustomRoleRecord> {
      const businessId = requireBusinessId();
      const created: CustomRoleRecord = {
        id: uid('ROL'),
        name: payload.name.trim(),
        permissions: payload.permissions,
        createdAt: new Date().toISOString(),
      };
      writeJson(rolesKey(businessId), [...readJson<CustomRoleRecord[]>(rolesKey(businessId), []), created]);
      return created;
    },
  },

  subscription: {
    plans(): SubscriptionPlanRecord[] { return PLANS; },
    async current(): Promise<BusinessSubscriptionRecord> {
      const businessId = requireBusinessId();
      if (!seedCache) await ensureSeedLoaded();
      return subscriptionFor(businessId);
    },
    async select(planId: SubscriptionPlanRecord['id']): Promise<BusinessSubscriptionRecord> {
      const businessId = requireBusinessId();
      const plan = PLANS.find(item => item.id === planId);
      if (!plan) throw new Error('Plan no válido.');
      if (!seedCache) await ensureSeedLoaded();
      const current = subscriptionFor(businessId);
      const now = new Date().toISOString();
      if (current.plan.id === plan.id && current.status === 'active') return current;
      const updated: BusinessSubscriptionRecord = plan.id === 'free'
        ? { ...current, plan, status: 'active', pendingPlan: null, startedAt: current.startedAt || now, updatedAt: now, expiresAt: null }
        : { ...current, status: 'pending_payment', pendingPlan: plan, updatedAt: now };
      writeJson(subscriptionKey(businessId), updated);
      return updated;
    },
  },

  platform: {
    async businesses() {
      const seed = await ensureSeedLoaded();
      const registered = readRegisteredUsers();
      const map = new Map<string, { id: string; name: string; type: string; currency: string; active: boolean; createdAt: string; users: number }>();
      Object.values(seed?.businesses ?? {}).forEach(business => {
        map.set(business.id, {
          id: business.id,
          name: business.name,
          type: business.type,
          currency: 'COP',
          active: true,
          createdAt: seed?.generatedAt || '',
          users: business.users.length,
        });
      });
      registered.forEach(user => {
        if (!user.businessId || map.has(user.businessId)) return;
        const config = readJson<any>(configKey(user.businessId), null);
        map.set(user.businessId, {
          id: user.businessId,
          name: config?.name || user.name,
          type: config?.type || 'retail',
          currency: 'COP',
          active: true,
          createdAt: user.createdAt || '',
          users: 1,
        });
      });
      const statuses = readJson<Record<string, boolean>>(PLATFORM_STATUS_PREFIX, {});
      const meta = readJson<Record<string, DesktopBusinessMeta>>(PLATFORM_BUSINESS_META_PREFIX, {});
      return [...map.values()].map(business => ({
        ...business,
        active: statuses[business.id] ?? business.active,
        suspensionReason: meta[business.id]?.reason || '',
        suspensionDescription: meta[business.id]?.description || '',
        suspendedAt: meta[business.id]?.suspendedAt || '',
      }));
    },
    async stats() {
      const businesses = await this.businesses();
      const users = await this.users('');
      const seed = await ensureSeedLoaded();
      let completedSales = 0;
      let salesVolumeCOP = 0;
      Object.values(seed?.businesses ?? {}).forEach(business => {
        (business.sales as any[]).forEach(sale => {
          if (sale.status === 'completed') {
            completedSales += 1;
            salesVolumeCOP += Number(sale.totalPrice) || 0;
          }
        });
      });
      return {
        businesses: businesses.length,
        activeBusinesses: businesses.filter(business => business.active).length,
        users: users.length,
        activeUsers: users.filter(user => user.active).length,
        completedSales,
        salesVolumeCOP,
      };
    },
    async users(search = ''): Promise<PlatformUserRecord[]> {
      await ensureSeedLoaded();
      const term = search.trim().toLowerCase();
      return allUsersWithSeed()
        .map(publicBusinessUser)
        .filter(user => !term || [user.name, user.email, user.businessName || ''].some(value => value.toLowerCase().includes(term)));
    },
    async audit(limit = 100): Promise<PlatformAuditRecord[]> {
      return readPlatformAuditEntries().slice(0, Math.max(1, limit));
    },
    async subscriptions(): Promise<PlatformSubscriptionRecord[]> {
      const businesses = await this.businesses();
      return businesses.map(business => ({
        ...subscriptionFor(business.id),
        businessName: business.name,
        lastPayment: lastSubscriptionPayment(business.id),
      }));
    },
    async updateSubscription(businessId: string, action: PlatformSubscriptionAction, paymentReference = '', planId?: PaidPlanId): Promise<BusinessSubscriptionRecord> {
      const current = subscriptionFor(businessId);
      if (action === 'confirm_payment') {
        if (current.status !== 'pending_payment' || !current.pendingPlan) throw new Error('No existe una solicitud de pago pendiente para este negocio.');
        const updated = applyVerifiedSubscriptionPayment(businessId, current, current.pendingPlan.id as PaidPlanId, paymentReference);
        appendPlatformAudit('subscription_payment_manually_verified', businessId, { planId: updated.plan.id, paymentReference: paymentReference.trim(), verificationMode: 'manual_by_superadmin' });
        return updated;
      }
      if (action === 'renew') {
        const inForce = current.status === 'active' || current.status === 'pending_payment';
        const target = planId
          ?? (inForce && current.plan.priceCOP > 0 ? current.plan.id as PaidPlanId : undefined)
          ?? (lastSubscriptionPayment(businessId)?.planId as PaidPlanId | undefined);
        if (!target) throw new Error('Indica el plan pagado: el negocio no tiene un plan de pago vigente ni pagos anteriores.');
        const updated = applyVerifiedSubscriptionPayment(businessId, current, target, paymentReference);
        appendPlatformAudit('subscription_renewed', businessId, { planId: target, paymentReference: paymentReference.trim(), verificationMode: 'manual_by_superadmin' });
        return updated;
      }
      if (current.status !== 'pending_payment') throw new Error('No existe una solicitud de pago pendiente para este negocio.');
      const cancelledPlanId = current.pendingPlan?.id ?? null;
      const updated: BusinessSubscriptionRecord = { ...current, status: 'active', pendingPlan: null, updatedAt: new Date().toISOString() };
      writeJson(subscriptionKey(businessId), updated);
      appendPlatformAudit('subscription_request_cancelled', businessId, { cancelledPlanId });
      return updated;
    },
    async setBusinessStatus(id: string, active: boolean, reason = '', description = '') {
      const seed = await ensureSeedLoaded().catch(() => null);
      const businessName = seed?.businesses?.[id]?.name || desktopBusinessName(id, id);
      setLocalBusinessActive(id, active);
      if (active) {
        resolveOpenSupportCases(id, 'resolved');
      } else {
        const meta = readJson<Record<string, DesktopBusinessMeta>>(PLATFORM_BUSINESS_META_PREFIX, {});
        meta[id] = {
          reason: reason.trim(),
          description: description.trim(),
          suspendedAt: new Date().toISOString(),
        };
        writeJson(PLATFORM_BUSINESS_META_PREFIX, meta);
        openSupportCase(id, businessName, reason.trim(), description.trim());
      }
      appendPlatformAudit(active ? 'activate' : 'suspend', `business:${id}`, { active, reason: active ? '' : reason.trim(), description: active ? '' : description.trim() });
      return { id, active, caseId: active ? null : latestSupportCase(id)?.id || null };
    },
    async createUser(input: { name: string; email: string; password: string; role: AuthUser['role']; businessId?: string | null }): Promise<PlatformUserRecord> {
      const email = normalizedEmail(input.email);
      if (allUsersWithSeed().some(user => normalizedEmail(user.email) === email)) throw new Error('Ya existe una cuenta con ese correo.');
      if (!input.password || input.password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
      const user: DesktopUser = {
        id: uid('USUARIO'),
        businessId: input.businessId || null,
        name: input.name.trim(),
        email,
        password: input.password,
        role: input.role,
        active: true,
        subscription: input.role === 'owner' ? 'premium' : 'basic',
        createdAt: new Date().toISOString(),
      };
      writeRegisteredUsers([...readRegisteredUsers(), user]);
      const created = publicBusinessUser(user);
      appendPlatformAudit('create_user', user.id, { role: user.role, businessId: user.businessId, email: user.email, name: user.name });
      return created;
    },
    async setUserStatus(id: string, active: boolean) {
      const statuses = readJson<Record<string, boolean>>(USER_STATUS_PREFIX, {});
      writeJson(USER_STATUS_PREFIX, { ...statuses, [id]: active });
      const target = allUsersWithSeed().find(user => user.id === id);
      appendPlatformAudit(active ? 'activate_user' : 'suspend_user', id, { active, name: target?.name || '', email: target?.email || '' });
      return { id, active };
    },
  },

  support: {
    async suspension(): Promise<SuspensionStatusRecord> {
      const user = readCurrentDesktopUser();
      const businessId = user?.businessId || '';
      const seed = await ensureSeedLoaded().catch(() => null);
      const businessName = seed?.businesses?.[businessId]?.name || desktopBusinessName(businessId, user?.name || 'Mi negocio');
      const statuses = readJson<Record<string, boolean>>(PLATFORM_STATUS_PREFIX, {});
      const meta = readJson<Record<string, DesktopBusinessMeta>>(PLATFORM_BUSINESS_META_PREFIX, {});
      const caseItem = latestSupportCase(businessId);
      const active = statuses[businessId] ?? true;
      return {
        businessId,
        businessName,
        active,
        reason: active ? '' : meta[businessId]?.reason || caseItem?.reason || '',
        description: active ? '' : meta[businessId]?.description || caseItem?.description || '',
        suspendedAt: active ? null : meta[businessId]?.suspendedAt || null,
        case: caseItem,
        messages: caseItem ? readSupportMessages()[caseItem.id] || [] : [],
      };
    },
    async ownerCase(): Promise<SupportCaseRecord | null> {
      const user = readCurrentDesktopUser();
      return user?.businessId ? latestSupportCase(user.businessId) : null;
    },
    async ownerMessages(): Promise<SupportMessageRecord[]> {
      const user = readCurrentDesktopUser();
      const caseItem = user?.businessId ? latestSupportCase(user.businessId) : null;
      if (caseItem) return readSupportMessages()[caseItem.id] || [];
      return readJson<SupportMessageRecord[]>(SUPPORT_KEY, []);
    },
    async sendOwnerMessage(message: string): Promise<SupportMessageRecord> {
      const user = readCurrentDesktopUser();
      const caseItem = user?.businessId ? latestSupportCase(user.businessId) : null;
      if (!caseItem) throw new Error('No existe un caso de soporte activo para este negocio.');
      const created: SupportMessageRecord = {
        id: Date.now(),
        senderId: user?.id || 'local',
        senderRole: user?.role || 'owner',
        senderName: user?.name || 'Usuario local',
        message,
        createdAt: new Date().toISOString(),
        readAt: null,
      };
      const messages = readSupportMessages();
      messages[caseItem.id] = [...(messages[caseItem.id] || []), created];
      writeSupportMessages(messages);
      const cases = readSupportCases();
      writeSupportCases(cases.map(item => item.id === caseItem.id ? {
        ...item,
        status: item.status === 'open' ? 'in_review' : item.status,
        updatedAt: created.createdAt,
        unreadCount: (item.unreadCount || 0) + 1,
      } : item));
      return created;
    },
    async platformCases(): Promise<SupportCaseRecord[]> {
      return [...readSupportCases()].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    },
    async platformMessages(caseId: string): Promise<SupportMessageRecord[]> {
      return readSupportMessages()[caseId] || [];
    },
    async sendPlatformMessage(caseId: string, message: string): Promise<SupportMessageRecord> {
      const caseItem = readSupportCases().find(item => item.id === caseId);
      if (!caseItem) throw new Error('No se encontró el caso de soporte.');
      const user = readCurrentDesktopUser();
      const created: SupportMessageRecord = {
        id: Date.now(),
        senderId: user?.id || 'local',
        senderRole: 'superadmin',
        senderName: user?.name || 'Soporte local',
        message,
        createdAt: new Date().toISOString(),
        readAt: null,
      };
      const messages = readSupportMessages();
      messages[caseId] = [...(messages[caseId] || []), created];
      writeSupportMessages(messages);
      writeSupportCases(readSupportCases().map(item => item.id === caseId ? {
        ...item,
        status: item.status === 'open' ? 'in_review' : item.status,
        updatedAt: created.createdAt,
        unreadCount: 0,
      } : item));
      appendPlatformAudit('support_reply', caseId, { businessId: caseItem.businessId, messageLength: message.length });
      return created;
    },
    async updatePlatformCase(caseId: string, status: SupportCaseRecord['status']) {
      const caseItem = readSupportCases().find(item => item.id === caseId);
      if (!caseItem) throw new Error('No se encontró el caso de soporte.');
      const now = new Date().toISOString();
      writeSupportCases(readSupportCases().map(item => item.id === caseId ? { ...item, status, updatedAt: now } : item));
      if (status === 'resolved') setLocalBusinessActive(caseItem.businessId, true);
      appendPlatformAudit('support_case_status', caseId, { businessId: caseItem.businessId, status, reactivated: status === 'resolved' });
      return { id: caseId, status };
    },
  },
};
