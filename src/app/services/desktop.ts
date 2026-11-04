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
  PlatformSubscriptionRecord,
  PlatformUserRecord,
  ProductCategoryRecord,
  ServiceAppointmentRecord,
  ServiceCatalogRecord,
  ServiceProfessionalRecord,
  SubscriptionPlanRecord,
  SupportCaseRecord,
  SupportMessageRecord,
  SuspensionStatusRecord,
} from './dataService';
import type { Product, Supplier } from '../utils/mockData';

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
const SUBSCRIPTION_PREFIX = 'manager_stock_desktop_subscription_v1';
const SUPPORT_KEY = 'manager_stock_desktop_support_v1';

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

function subscriptionFor(businessId: string): BusinessSubscriptionRecord {
  const saved = readJson<BusinessSubscriptionRecord | null>(subscriptionKey(businessId), null);
  if (saved) return saved;
  const fromSeed = seedCache?.businesses?.[businessId]?.subscription;
  if (fromSeed) return fromSeed;
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
      const nights = Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000));
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
      writeJson(reservationsKey(businessId), [created, ...reservations]);
      writeJson(roomsKey(businessId), rooms.map(item => item.id === room.id ? { ...item, status: 'reserved' } : item));
      return created;
    },
    async updateReservationStatus(id: string, status: HotelReservationRecord['status']): Promise<HotelReservationRecord> {
      const businessId = requireBusinessId();
      const reservations = await this.reservations();
      const reservation = reservations.find(item => item.id === id);
      if (!reservation) throw new Error('No se encontró la reserva.');
      const updated = { ...reservation, status };
      writeJson(reservationsKey(businessId), reservations.map(item => item.id === id ? updated : item));
      const rooms = await this.rooms();
      const roomStatus = status === 'checkin' ? 'occupied' : status === 'confirmed' ? 'reserved' : 'available';
      writeJson(roomsKey(businessId), rooms.map(room => room.id === reservation.roomId ? { ...room, status: roomStatus } : room));
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
    async createAppointment(input: { serviceId: string; professionalId: string; clientName: string; clientEmail?: string; clientPhone?: string; appointmentDate: string; startTime: string; notes?: string }): Promise<ServiceAppointmentRecord> {
      const businessId = requireBusinessId();
      const data = await this.data();
      const service = data.catalog.find((item: ServiceCatalogRecord) => item.id === input.serviceId);
      const professional = data.professionals.find((item: ServiceProfessionalRecord) => item.id === input.professionalId);
      if (!service) throw new Error('Selecciona un servicio válido.');
      if (!professional) throw new Error('Selecciona un profesional válido.');
      const duration = service.durationMinutes || service.duracion || 30;
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
      const duration = service.durationMinutes || service.duracion || 30;
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
        price: service.price,
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
      const updated: BusinessSubscriptionRecord = {
        ...current,
        plan,
        status: 'active',
        pendingPlan: null,
        startedAt: current.startedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
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
      return [...map.values()].map(business => ({ ...business, active: statuses[business.id] ?? business.active }));
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
    async audit(): Promise<any[]> { return []; },
    async subscriptions(): Promise<PlatformSubscriptionRecord[]> {
      const businesses = await this.businesses();
      return businesses.map(business => ({
        ...subscriptionFor(business.id),
        businessName: business.name,
      }));
    },
    async updateSubscription(businessId: string): Promise<BusinessSubscriptionRecord> {
      return subscriptionFor(businessId);
    },
    async setBusinessStatus(id: string, active: boolean) {
      const statuses = readJson<Record<string, boolean>>(PLATFORM_STATUS_PREFIX, {});
      writeJson(PLATFORM_STATUS_PREFIX, { ...statuses, [id]: active });
      return { id, active, caseId: null };
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
      return publicBusinessUser(user);
    },
    async setUserStatus(id: string, active: boolean) {
      const statuses = readJson<Record<string, boolean>>(USER_STATUS_PREFIX, {});
      writeJson(USER_STATUS_PREFIX, { ...statuses, [id]: active });
      return { id, active };
    },
  },

  support: {
    async suspension(): Promise<SuspensionStatusRecord> {
      const user = readCurrentDesktopUser();
      const businessId = user?.businessId || '';
      return {
        businessId,
        businessName: user?.name || 'Mi negocio',
        active: true,
        reason: '',
        description: '',
        suspendedAt: null,
        case: null,
        messages: [],
      };
    },
    async ownerCase(): Promise<SupportCaseRecord | null> { return null; },
    async ownerMessages(): Promise<SupportMessageRecord[]> {
      return readJson<SupportMessageRecord[]>(SUPPORT_KEY, []);
    },
    async sendOwnerMessage(message: string): Promise<SupportMessageRecord> {
      const user = readCurrentDesktopUser();
      const created: SupportMessageRecord = {
        id: Date.now(),
        senderId: user?.id || 'local',
        senderRole: user?.role || 'owner',
        senderName: user?.name || 'Usuario local',
        message,
        createdAt: new Date().toISOString(),
        readAt: null,
      };
      writeJson(SUPPORT_KEY, [...readJson<SupportMessageRecord[]>(SUPPORT_KEY, []), created]);
      return created;
    },
    async platformCases(): Promise<SupportCaseRecord[]> { return []; },
    async platformMessages(): Promise<SupportMessageRecord[]> { return []; },
    async sendPlatformMessage(caseId: string, message: string): Promise<SupportMessageRecord> {
      return { id: Date.now(), senderId: 'local', senderRole: 'superadmin', senderName: 'Soporte local', message, createdAt: new Date().toISOString(), readAt: null };
    },
    async updatePlatformCase(caseId: string, status: SupportCaseRecord['status']) { return { id: caseId, status }; },
  },
};
