import type { Product, Supplier } from '../utils/types';
import { desktop, isDesktopMode } from './desktop';

export type SaleStatus = 'completed' | 'pending' | 'cancelled';
export type PaymentMethod = 'cash' | 'card' | 'digital' | 'split' | 'transfer';
export type PaymentPartMethod = 'cash' | 'card' | 'digital' | 'transfer';
export interface PaymentPartRecord { method: PaymentPartMethod; amount: number; }
export interface CashSessionRecord { openedByUserId?: string; id: string; openedBy: string; openingAmount: number; closingAmount?: number | null; expectedAmount?: number | null; difference?: number | null; status: 'open' | 'closed'; openedAt: string; closedAt?: string | null; }

export interface SaleItemInput {
  productId: string;
  quantity: number;
  discountPercent?: number;
}

export interface SaleItemRecord {
  productId: string;
  productName: string;
  sku?: string;
  quantity: number;
  price: number;
  unitCost?: number;
  discountPercent: number;
  subtotal: number;
}

export interface SaleRecord {
  id: string;
  date: string;
  status: SaleStatus;
  customer: string;
  paymentMethod: PaymentMethod;
  currency: string;
  subtotal: number;
  lineDiscount: number;
  globalDiscount: number;
  taxRate: number;
  tax: number;
  totalPrice: number;
  productId: string;
  productName: string;
  quantity: number;
  items: SaleItemRecord[];
  idempotencyKey?: string;
  cashSessionId?: string | null;
  payments?: PaymentPartRecord[];
  inventoryEffects?: { productId: string; quantityDelta: number }[];
}

export interface CreateSaleInput {
  /** Order lines are resolved by the server; items contains only extras. */
  orderIds?: string[];
  /** Attended appointments, charged by the server at their booked price. */
  appointmentIds?: string[];
  items: SaleItemInput[];
  customer?: string;
  paymentMethod?: PaymentMethod;
  globalDiscountPercent?: number;
  taxRate?: number;
  status?: 'completed' | 'pending';
  idempotencyKey?: string;
  cashSessionId?: string | null;
  payments?: PaymentPartRecord[];
}

export interface RecipeIngredientRecord {
  ingredientId: string;
  name: string;
  quantity: number;
  unit: string;
  stock?: number;
}

export interface RecipeRecord {
  id: string;
  productId: string;
  productName: string;
  yieldQuantity: number;
  instructions: string;
  ingredients: RecipeIngredientRecord[];
}

export interface RecipeInput {
  productId: string;
  yieldQuantity: number;
  instructions?: string;
  ingredients: { ingredientId: string; quantity: number; unit?: string }[];
}

export type OrderChannel = 'counter' | 'takeaway' | 'delivery' | 'table';
export type OrderStatus = 'received' | 'preparing' | 'ready' | 'delivered' | 'cancelled';

export interface OrderItemRecord {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  notes?: string;
}

export interface OrderRecord {
  restaurantMetadata?: Record<string, any>;
  saleId?: string;
  id: string;
  channel: OrderChannel;
  customer: string;
  phone: string;
  address: string;
  status: OrderStatus;
  notes: string;
  total: number;
  created_at: string;
  items: OrderItemRecord[];
  tableId?: string | null;
  tableNumber?: number | null;
  waiter?: string;
}

export interface CreateOrderInput {
  restaurantMetadata?: Record<string, any>;
  channel: OrderChannel;
  customer?: string;
  phone?: string;
  address?: string;
  notes?: string;
  items: { productId: string; quantity: number; notes?: string }[];
  tableId?: string | null;
  tableNumber?: number | null;
  waiter?: string;
}

// Mesas del salón. Se administran desde /restaurant/tables y viven en SQLite
// cuando hay backend; en modo escritorio usan el paquete local.
export interface RestaurantTableRecord {
  id: string;
  number: number;
  zone: string;
  capacity: number;
  status: 'active' | 'inactive';
  openOrders: number;
  openTotal: number;
  waiter: string;
  since: string | null;
}

export interface CreateTableInput {
  number: number;
  zone?: string;
  capacity?: number;
}

export interface UpdateTableInput {
  number?: number;
  zone?: string;
  capacity?: number;
  status?: 'active' | 'inactive';
}

export interface AuditLogRecord {
  id: number;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export type InventoryMovementType = 'opening' | 'purchase' | 'customer_return' | 'donation' | 'sale' | 'sale_cancelled' | 'recipe_consumption' | 'consumption' | 'adjustment' | 'transfer_in' | 'transfer_out' | 'waste' | 'count_adjustment' | 'production';
export interface InventoryMovementRecord {
  id: number | string;
  productId: string;
  productName: string;
  saleId?: string | null;
  movementType: InventoryMovementType;
  quantityDelta: number;
  stockBefore: number;
  stockAfter: number;
  note: string;
  createdAt: string;
  sku?: string;
  productUnit?: string;
  reason?: string;
  createdByName?: string;
  createdById?: string | null;
  lotId?: string | null;
  lotCode?: string | null;
  locationId?: string | null;
  locationCode?: string | null;
  referenceType?: string;
  referenceId?: string;
  unitCost?: number;
}

export interface InventoryLocationRecord {
  id: string; code: string; name: string; zone: string; aisle: string; rack: string;
  level: number; capacity: number; active: boolean; productCount: number; lotUnits: number;
  label: string; createdAt: string;
}

export interface InventoryLotRecord {
  id: string; productId: string; productName: string; sku: string; productUnit: string;
  lotCode: string; quantity: number; expiryDate: string | null; daysLeft: number | null;
  status: 'vencido' | 'por_vencer' | 'vigente' | 'sin_vencimiento';
  unitCost: number; locationId: string | null; locationCode: string | null;
  locationName: string | null; receivedAt: string; value: number;
}

export interface InventoryAlertRecord {
  type: 'low_stock' | 'out_of_stock' | 'negative_stock' | 'expired_lot' | 'expiring_lot';
  severity: 'high' | 'medium' | 'low'; productId: string; productName: string; sku: string;
  stock?: number; minStock?: number; unit?: string; lotCode?: string;
  expiryDate?: string | null; daysLeft?: number | null; quantity?: number; message: string;
}

export interface InventoryOperationRecord {
  id: string; operationType: string; supplierId: string | null; reference: string;
  reason: string; reasonCode: string; invoiceRef: string; attachmentUrl: string;
  notes: string; createdBy: string | null; createdByName: string; createdAt: string;
  items: Array<{
    movementId: number; productId: string; productName: string; productUnit: string;
    movementType: InventoryMovementType; quantity: number; stockBefore: number;
    stockAfter: number; unitCost: number; lotId: string | null;
    locationId: string | null; locationCode: string | null; reason: string;
  }>;
  reasonLabel?: string;
}

export interface InventoryOverviewRecord {
  totalValue: number; totalRetailValue: number; totalUnits: number; productCount: number;
  lowStockCount: number; outOfStockCount: number; negativeStockCount: number;
  expiringCount: number; expiredCount: number; wasteCost: number;
  lowStockProducts: Product[]; expiringLots: InventoryLotRecord[];
  recentMovements: InventoryMovementRecord[]; generatedAt: string;
  settings: InventorySettingsRecord;
}

export interface InventorySettingsRecord {
  allowNegativeStock: boolean; expiryAlertDays: number; lowStockAlerts: boolean;
  defaultLocationId: string | null; defaultLocationName?: string | null;
  negativeStockPermission?: boolean;
}

export interface EntryItemInput {
  productId: string; quantity: number; unit?: string; unitCost?: number;
  lotCode?: string; expiryDate?: string | null; locationId?: string | null;
}
export interface EntryInput {
  entryType: 'purchase' | 'customer_return' | 'donation' | 'opening';
  supplierId?: string | null; reference?: string; invoiceRef?: string;
  notes?: string; attachmentUrl?: string; items: EntryItemInput[];
}
export interface ExitInput {
  exitType: 'consumption' | 'direct_sale' | 'other'; reason?: string; notes?: string;
  items: Array<{ productId: string; quantity: number; unit?: string; lotId?: string | null }>;
}
export interface WasteInput {
  reasonCode: string; reason: string; notes?: string;
  items: Array<{ productId: string; quantity: number; unit?: string; lotId?: string | null }>;
}
export interface AdjustmentInput {
  reason: string; notes?: string;
  items: Array<{ productId: string; quantityDelta: number; unit?: string; lotId?: string | null }>;
}

export interface PurchaseOrderItemRecord {
  id: number; productId: string; productName: string; sku: string;
  productUnit: string; unit: string; quantityOrdered: number; quantityReceived: number;
  pendingQuantity: number; unitCost: number; lineTotal: number;
}
export interface PurchaseOrderRecord {
  id: string; supplierId: string; supplierName: string; supplierContact: string;
  status: 'draft' | 'sent' | 'partial' | 'received' | 'cancelled';
  expectedDate: string | null; notes: string; createdBy: string | null; createdByName: string;
  approvedBy: string | null; approvedAt: string | null; createdAt: string; updatedAt: string;
  total: number; items: PurchaseOrderItemRecord[]; pendingLines: number; operationId?: string;
}
export interface PurchaseOrderInput {
  supplierId: string; expectedDate?: string | null; notes?: string;
  items: Array<{ productId: string; quantity: number; unitCost: number; unit?: string }>;
}
export interface ReceivePurchaseOrderInput {
  invoiceRef?: string; notes?: string;
  items: Array<{ itemId: number; quantity: number; unit?: string; unitCost?: number | null; lotCode?: string; expiryDate?: string | null; locationId?: string | null }>;
}

export interface PhysicalCountRecord {
  id: string; status: 'open' | 'closed' | 'cancelled'; notes: string;
  createdBy: string | null; createdByName: string; createdAt: string; closedAt: string | null;
  items: Array<{
    id: number; productId: string; productName: string; sku: string; productUnit: string;
    systemQuantity: number; countedQuantity: number; difference: number; adjustmentMovementId: number | null;
  }>;
  differenceCount: number; totalDifference: number; operationId?: string;
}

export interface TransferRecord {
  id: string; status: 'draft' | 'pending' | 'in_transit' | 'received' | 'cancelled';
  notes: string; originLocationId: string | null; originCode: string | null; originName: string | null;
  destinationLocationId: string | null; destinationCode: string | null; destinationName: string | null;
  createdBy: string | null; createdByName: string; createdAt: string;
  sentAt: string | null; receivedAt: string | null;
  items: Array<{
    id: number; productId: string; productName: string; sku: string; productUnit: string;
    quantity: number; lotId: string | null; lotCode: string; expiryDate: string | null; unitCost: number;
    allocations: Array<{ id: number; lotCode: string; expiryDate: string | null; quantity: number; unitCost: number }>;
  }>;
  totalUnits: number; totalCost: number; operationId?: string;
}

export interface SupplierPriceHistoryRecord {
  id: number; productId: string; productName: string; sku: string; productUnit: string;
  supplierId: string | null; supplierName: string | null; unitCost: number; source: string;
  referenceType: string; referenceId: string; createdBy: string | null; createdAt: string;
}

export interface InventoryReportsRecord {
  totalValue: number; totalUnits: number; productCount: number;
  criticalStock: Product[]; criticalStockCount: number;
  expiringItems: InventoryLotRecord[]; expiringCount: number;
  wasteCost: number; wasteByReason: Array<{ reasonCode: string; reasonLabel: string; quantity: number; cost: number }>;
  rotation: Array<{ productId: string; productName: string; sku: string; unit: string; quantity: number; cost: number; movements: number }>;
  noMovement: Array<{ productId: string; productName: string; sku: string; stock: number; unit: string; lastMovementAt: string | null }>;
  countDifferences: Array<{ countId: string; productId: string; productName: string; sku: string; systemQuantity: number; countedQuantity: number; difference: number; unit: string; createdAt: string }>;
  periodDays: number; noMovementDays: number; generatedAt: string;
}

export interface DishCostingRecord {
  recipeId: string; productId: string; productName: string; yieldQuantity: number;
  cost: number; price: number; margin: number; marginPercent: number;
  ingredients: Array<{ ingredientId: string; name: string; quantity: number; unit: string; baseQuantity: number; productUnit: string; unitCost: number; cost: number }>;
}

export interface ProductSubstitutionRecord {
  productId: string; productName: string; substituteId: string; substituteName: string;
  substituteStock: number; substituteUnit: string; priority: number; notes: string;
}

interface LocalDatabase {
  hotelCharges?: HotelChargeRecord[];
  hotelPayments?: HotelPaymentRecord[];
  hotelRefunds?: HotelRefundRecord[];
  hotelClosures?: Record<string, HotelReceipt>;
  version: 1;
  products: Product[];
  suppliers: Supplier[];
  sales: SaleRecord[];
  recipes: RecipeRecord[];
  orders: OrderRecord[];
  tables: RestaurantTableRecord[];
  movements: InventoryMovementRecord[];
  cashSession: CashSessionRecord | null;
}

const API_BASE = (
  import.meta.env.VITE_API_URL ||
  (
    typeof window !== 'undefined' &&
    window.location.hostname &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '[::1]'
      ? `${window.location.protocol}//${window.location.hostname}:8000/api`
      : 'http://127.0.0.1:8000/api'
  )
).replace(/\/$/, '');
/** Server origin without `/api`, for files served outside the API (product photos). */
export const API_ORIGIN = API_BASE.replace(/\/api$/, '');
const STORAGE_KEY = 'manager_stock_database_v1';
const CURRENCY = 'COP';
const DEFAULT_TAX_RATE = 0.19;

export function colombiaDateKey(value: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const INITIAL_PRODUCTS: Product[] = [
  { id: 'PRD-HAM-001', name: 'Hamburguesa clásica', sku: 'HAM-001', category: 'Hamburguesas', price: 18000, stock: 32, minStock: 8, description: 'Carne, queso, vegetales y salsas.', image: 'burger' },
  { id: 'PRD-SAL-001', name: 'Salchipapa personal', sku: 'SAL-001', category: 'Comidas rápidas', price: 15000, stock: 26, minStock: 7, description: 'Papa, salchicha y salsas.', image: 'fries' },
  { id: 'PRD-PER-001', name: 'Perro caliente', sku: 'PER-001', category: 'Comidas rápidas', price: 12000, stock: 18, minStock: 6, description: 'Pan, salchicha, salsas y acompañamientos.', image: 'hotdog' },
  { id: 'PRD-EMP-001', name: 'Empanada de carne', sku: 'EMP-001', category: 'Fritos', price: 3500, stock: 80, minStock: 20, description: 'Empanada preparada de carne.', image: 'empanada' },
  { id: 'PRD-GAS-001', name: 'Gaseosa 400 ml', sku: 'GAS-001', category: 'Bebidas', price: 4500, stock: 40, minStock: 10, description: 'Bebida personal.', image: 'drink' },
  { id: 'PRD-PAP-001', name: 'Papas fritas', sku: 'PAP-001', category: 'Acompañamientos', price: 8000, stock: 30, minStock: 8, description: 'Porción de papas fritas.', image: 'fries' },
  { id: 'PRD-JUG-001', name: 'Jugo natural', sku: 'JUG-001', category: 'Bebidas', price: 6500, stock: 15, minStock: 5, description: 'Jugo natural preparado al momento.', image: 'drink' },
];

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.name = 'ApiError'; this.status = status; }
}

function defaultHttpErrorMessage(status: number): string {
  if (status === 400) return 'La solicitud no es válida. Revisa los datos e inténtalo de nuevo.';
  if (status === 401) return 'La sesión no es válida o venció. Inicia sesión nuevamente.';
  if (status === 403) return 'No tienes permisos para realizar esta acción.';
  if (status === 404) return 'El recurso solicitado no existe o fue eliminado.';
  if (status === 409) return 'La operación choca con el estado actual de los datos. Actualiza e inténtalo de nuevo.';
  if (status === 422) return 'El servidor rechazó los datos enviados. Revisa los campos e inténtalo de nuevo.';
  if (status === 429) return 'Se hicieron demasiadas solicitudes. Espera un momento e inténtalo de nuevo.';
  if (status >= 500) return `El servidor no pudo completar la solicitud (HTTP ${status}). Inténtalo de nuevo en unos segundos.`;
  return `La solicitud falló con el código HTTP ${status}.`;
}

function extractApiErrorMessage(body: any, status: number, rawBody = ''): string {
  const detail = body?.detail ?? body?.message ?? body?.error ?? body?.msg;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((item: any) => {
      const field = Array.isArray(item?.loc)
        ? item.loc.filter((part: any) => part !== 'body' && part !== 'query' && part !== 'path').join('.')
        : '';
      const message = item?.msg || item?.message || item?.detail || (typeof item === 'string' ? item : '');
      return field && message ? `${field}: ${message}` : (message || JSON.stringify(item));
    }).filter(Boolean);
    if (parts.length) return parts.join('; ');
  }
  if (detail && typeof detail === 'object') {
    if (typeof detail.message === 'string') return detail.message;
    try { return JSON.stringify(detail); } catch { /* ignore */ }
  }
  if (typeof body?.message === 'string' && body.message.trim()) return body.message;
  if (typeof body === 'string' && body.trim() && !body.trim().startsWith('<')) return body.trim().slice(0, 400);
  if (rawBody.trim() && !rawBody.trim().startsWith('<') && rawBody.length <= 400) return rawBody.trim();
  return defaultHttpErrorMessage(status);
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  // La app de escritorio no levanta FastAPI: todo se resuelve con el paquete
  // local. Lanzar TypeError permite que los métodos con respaldo local lo usen.
  if (isDesktopMode()) throw new TypeError('Modo escritorio local: los datos viven en este equipo.');
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(localStorage.getItem('manager_stock_auth_token') ? { Authorization: `Bearer ${localStorage.getItem('manager_stock_auth_token')}` } : {}), ...(init.headers || {}) },
  });
  const rawBody = await response.text().catch(() => '');
  let body: any = null;
  if (rawBody) {
    try { body = JSON.parse(rawBody); }
    catch { body = rawBody; }
  }
  if (response.status === 401 && localStorage.getItem('manager_stock_auth_token')) {
    localStorage.removeItem('manager_stock_auth_token');
    localStorage.removeItem('businessConfig');
    if (window.location.pathname !== '/login' && window.location.pathname !== '/register') window.location.assign('/login');
  }
  if (!response.ok) throw new ApiError(response.status, extractApiErrorMessage(body, response.status, rawBody));
  return body as T;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'superadmin' | 'owner' | 'business_admin' | 'cashier';
  businessId: string | null;
  active?: boolean;
  businessActive?: boolean;
  suspensionReason?: string;
  suspensionDescription?: string;
  suspendedAt?: string | null;
  customRoleId?: string | null;
  customRoleName?: string | null;
  permissions?: string[];
  subscription: 'basic' | 'premium';
}

export interface AuthResponse { access_token: string; token_type: 'bearer'; user: AuthUser; }

export const authService = {
  login(email: string, password: string) {
    if (isDesktopMode()) return desktop.auth.login(email, password);
    return api<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  },
  register(name: string, email: string, password: string) {
    if (isDesktopMode()) return desktop.auth.register(name, email, password);
    return api<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) });
  },
  me() {
    if (isDesktopMode()) return desktop.auth.me();
    return api<AuthUser>('/auth/me');
  },
  logout() {
    if (isDesktopMode()) return desktop.auth.logout();
    return api<{ ok: boolean }>('/auth/logout', { method: 'POST' });
  },
};

export async function getBusinessConfig<T>(): Promise<T | null> {
  if (isDesktopMode()) return desktop.config.get<T>();
  return api<T | null>('/business/config');
}

export async function saveBusinessConfig<T>(config: T): Promise<T> {
  if (isDesktopMode()) return desktop.config.save(config);
  return api<T>('/business/config', { method: 'PUT', body: JSON.stringify(config) });
}

export interface ProductCategoryRecord {
  id: string; name: string; description: string; active: boolean; custom: boolean; createdAt?: string | null;
}
export async function getProductCategories() {
  if (isDesktopMode()) return desktop.categories.list();
  return api<ProductCategoryRecord[]>('/product-categories');
}
export async function createProductCategory(payload: { name: string; description?: string; active?: boolean }) {
  if (isDesktopMode()) return desktop.categories.create(payload);
  return api<ProductCategoryRecord>('/product-categories', { method: 'POST', body: JSON.stringify(payload) });
}

export interface BusinessTypeTransitionRecord {
  id: string; businessId: string; oldType: string; newType: string; oldBusinessName: string;
  createdAt: string; expiresAt: string; status: 'pending'; pendingModules: string[]; message: string;
}
export async function getBusinessTypeTransitions() {
  if (isDesktopMode()) return [] as BusinessTypeTransitionRecord[];
  return api<BusinessTypeTransitionRecord[]>('/business/type-transitions');
}
export async function restoreBusinessTypeTransition(id: string) {
  if (isDesktopMode()) {
    const config = await getBusinessConfig<import('../context/BusinessContext').BusinessConfig>();
    return { ok: true, config: config as import('../context/BusinessContext').BusinessConfig };
  }
  return api<{ ok: boolean; config: import('../context/BusinessContext').BusinessConfig }>(`/business/type-transitions/${encodeURIComponent(id)}/restore`, { method: 'POST' });
}

export type HotelRoomStatus = 'available' | 'occupied' | 'reserved' | 'maintenance' | 'cleaning';
export type CleaningStatus = 'sucia' | 'en_limpieza' | 'lista' | 'inspeccionada';
export interface HotelRoomRecord {
  cleaningStatus?: CleaningStatus; cleaningAssignee?: string;
  id: string; number: string; roomNumber: string; type: string; roomType: string; floor: number;
  capacity: number; pricePerNight: number; status: HotelRoomStatus; amenities: string[];
  createdAt?: string | null; updatedAt?: string | null;
}
export type HotelReservationStatus = 'confirmed' | 'checkin' | 'checkout' | 'cancelled';
export interface HotelReservationRecord {
  id: string; roomId: string; roomNumber: string; guestName: string; guestEmail: string; guestPhone: string;
  checkIn: string; checkOut: string; status: HotelReservationStatus; advance: number; totalCharges: number; nights: number; createdAt: string;
}
export async function getHotelRooms() {
  if (isDesktopMode()) return desktop.hotel.rooms();
  return api<HotelRoomRecord[]>('/hotel/rooms');
}
export async function createHotelRoom(input: Omit<HotelRoomRecord, 'id' | 'number' | 'roomNumber' | 'createdAt' | 'updatedAt'> & { roomNumber: string }) {
  if (isDesktopMode()) return desktop.hotel.createRoom(input);
  return api<HotelRoomRecord>('/hotel/rooms', { method: 'POST', body: JSON.stringify(input) });
}
export async function updateHousekeeping(id: string, input: { cleaningStatus: CleaningStatus; cleaningAssignee: string; expectedStatus?: string }) {
  if (isDesktopMode()) return desktop.hotel.updateHousekeeping(id, input);
  return api<HotelRoomRecord>(`/hotel/rooms/${encodeURIComponent(id)}/housekeeping`, { method: 'PATCH', body: JSON.stringify(input) });
}
export async function getHotelReservations() {
  if (isDesktopMode()) {
    const charges = readLocal().hotelCharges || [];
    return (await desktop.hotel.reservations()).map(row => ({ ...row, totalCharges: money(row.totalCharges + charges.filter(c => c.reservationId === row.id && c.status === 'active').reduce((sum, c) => sum + c.total, 0)) }));
  }
  return api<HotelReservationRecord[]>('/hotel/reservations');
}
export async function createHotelReservation(input: { roomId: string; guestName: string; guestEmail?: string; guestPhone?: string; checkIn: string; checkOut: string; advance?: number }) {
  if (isDesktopMode()) return localHotelWrite(async () => { await requireHotelManage(); return desktop.hotel.createReservation(input); });
  return api<HotelReservationRecord>('/hotel/reservations', { method: 'POST', body: JSON.stringify(input) });
}
export async function updateHotelReservationStatus(id: string, status: HotelReservationStatus) {
  if (isDesktopMode()) return localHotelWrite(async () => {
    const db = readLocal();
    if (db.hotelClosures?.[id] && status !== 'checkout') throw new ApiError(409, 'La cuenta está cerrada; la estancia no se puede reabrir.');
    if (status === 'cancelled' && db.hotelPayments?.some(p => p.reservationId === id)) throw new ApiError(409, 'La reserva tiene pagos registrados y no se puede cancelar.');
    return desktop.hotel.updateReservationStatus(id, status);
  });
  return api<HotelReservationRecord>(`/hotel/reservations/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
}

export interface HotelChargeRecord {
  id: string; reservationId: string; productId: string; productName: string;
  quantity: number; unitPrice: number; total: number; status: 'active' | 'cancelled';
  note: string; createdAt: string; cancelledAt?: string | null; idempotencyKey: string;
}
export interface HotelPaymentRecord {
  id: string; amount: number; method: PaymentPartMethod; reference: string; cashSessionId: string;
  createdAt: string; idempotencyKey: string; reservationId?: string;
}
export interface HotelScheduleInput { roomId: string; checkIn: string; expectedRoomId: string; expectedCheckIn: string; expectedCheckOut: string; }
export interface HotelRefundInput { paymentId: string; cashSessionId: string; amount: number; reason: string; idempotencyKey: string; }
export interface HotelRefundRecord extends HotelRefundInput { id: string; reservationId: string; method: PaymentPartMethod; createdAt: string; }
export interface HotelIncomeTransaction { id: string; reservationId: string; guestName: string; roomNumber: string; kind: 'payment' | 'refund'; method: PaymentPartMethod; amount: number; createdAt: string; reference: string; }
export interface HotelIncomeReport { start: string; end: string; gross: number; refunded: number; net: number; methods: Array<{method: PaymentPartMethod; gross: number; refunded: number; net: number}>; transactions: HotelIncomeTransaction[]; }
export async function moveHotelReservation(id: string, input: HotelScheduleInput) {
  if (!isDesktopMode()) return api<HotelReservationRecord>(`/hotel/reservations/${encodeURIComponent(id)}/schedule`, { method: 'PATCH', body: JSON.stringify(input) });
  return localHotelWrite(async () => { await requireHotelManage(); return desktop.hotel.moveReservation(id,input); });
}
export interface HotelReceipt extends Omit<HotelAccount, 'receipt'> { businessName: string; currency: string; }
export interface HotelPaymentInput { amount: number; method: PaymentPartMethod; reference: string; cashSessionId: string; idempotencyKey: string; }
export interface HotelAccount {
  refunds: HotelRefundRecord[]; refundedTotal: number; netPaidTotal: number;
  payments: HotelPaymentRecord[]; paidTotal: number; closedAt?: string | null; receiptId?: string | null; receipt?: HotelReceipt | null;
  reservation: HotelReservationRecord; charges: HotelChargeRecord[];
  accommodationTotal: number; consumptionTotal: number; total: number; advance: number; balance: number;
}
export interface HotelChargeInput { productId: string; quantity: number; note?: string; idempotencyKey: string; }
export async function getHotelProducts(): Promise<Product[]> {
  if (isDesktopMode()) return (await dataService.getProducts()).filter(p => !p.productType || p.productType === 'sale_item');
  return api<Product[]>('/hotel/products');
}
export async function getHotelAccount(id: string): Promise<HotelAccount> {
  if (!isDesktopMode()) return api<HotelAccount>(`/hotel/reservations/${encodeURIComponent(id)}/account`);
  const reservation = (await desktop.hotel.reservations()).find(r => r.id === id);
  if (!reservation) throw new ApiError(422, 'Reserva no encontrada.');
  const charges = (readLocal().hotelCharges || []).filter(c => c.reservationId === id);
  const consumptionTotal = money(charges.filter(c => c.status === 'active').reduce((sum, c) => sum + c.total, 0));
  const total = money(reservation.totalCharges + consumptionTotal);
  const db = readLocal();
  const payments = (db.hotelPayments || []).filter(p => p.reservationId === id);
  const paidTotal = money(payments.reduce((sum,p) => sum+p.amount,0));
  const refunds = (db.hotelRefunds || []).filter(r => r.reservationId === id);
  const refundedTotal = money(refunds.reduce((sum,r) => sum+r.amount,0));
  const netPaidTotal = money(paidTotal-refundedTotal);
  const receipt = db.hotelClosures?.[id];
  return { refunds, refundedTotal, netPaidTotal, payments, paidTotal, closedAt: receipt?.closedAt, receiptId: receipt?.receiptId, receipt, reservation: { ...reservation, totalCharges: total, ...(receipt ? { status: 'checkout' as const } : {}) }, charges, accommodationTotal: reservation.totalCharges, consumptionTotal, total, advance: reservation.advance, balance: receipt ? 0 : money(Math.max(0, total - reservation.advance - netPaidTotal)) };
}
async function localHotelWrite<T>(action: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request(`hotel-charges:${localKey()}`, action);
  return action();
}
async function requireHotelManage() {
  const user = await desktop.auth.me();
  if (!['owner', 'business_admin'].includes(user.role) && !user.permissions?.includes('hotel.manage')) throw new ApiError(422, 'No tienes permiso para gestionar consumos.');
}
export async function addHotelCharge(id: string, input: HotelChargeInput): Promise<HotelAccount> {
  if (!isDesktopMode()) return api<HotelAccount>(`/hotel/reservations/${encodeURIComponent(id)}/charges`, { method: 'POST', body: JSON.stringify(input) });
  return localHotelWrite(async () => {
    await requireHotelManage();
    const account = await getHotelAccount(id);
    const previous = account.charges.find(c => c.idempotencyKey === input.idempotencyKey);
    if (previous) {
      if (previous.productId !== input.productId || previous.quantity !== input.quantity || previous.note !== (input.note || '').trim()) throw new ApiError(422, 'La solicitud ya se utilizó para otro consumo.');
      return account;
    }
    if (account.closedAt) throw new ApiError(409, 'La cuenta ya está cerrada.');
    if (account.reservation.status !== 'checkin') throw new ApiError(422, 'Solo puedes cargar consumos a una estancia con check-in activo.');
    const db = readLocal();
    const product = db.products.find(p => p.id === input.productId && (!p.productType || p.productType === 'sale_item'));
    if (!product) throw new ApiError(422, 'Producto no disponible en este hotel.');
    validateLocalQuantity(product, input.quantity);
    if (product.stock < input.quantity) throw new ApiError(422, 'Stock insuficiente para este consumo.');
    const charge: HotelChargeRecord = { ...input, id: uniqueId('HC'), reservationId: id, productName: product.name, unitPrice: product.price, total: money(product.price * input.quantity), status: 'active', note: (input.note || '').trim(), createdAt: new Date().toISOString() };
    const before = product.stock;
    product.stock = money(before - input.quantity);
    db.hotelCharges = [...(db.hotelCharges || []), charge];
    db.movements.unshift({ id: uniqueId('MOV'), productId: product.id, productName: product.name, movementType: 'consumption', quantityDelta: -input.quantity, stockBefore: before, stockAfter: product.stock, note: `Consumo habitación ${account.reservation.roomNumber}`, createdAt: charge.createdAt, referenceType: 'hotel_charge', referenceId: charge.id });
    writeLocal(db);
    return getHotelAccount(id);
  });
}
export async function cancelHotelCharge(id: string, chargeId: string): Promise<HotelAccount> {
  if (!isDesktopMode()) return api<HotelAccount>(`/hotel/reservations/${encodeURIComponent(id)}/charges/${encodeURIComponent(chargeId)}/cancel`, { method: 'POST' });
  return localHotelWrite(async () => {
    await requireHotelManage();
    const account = await getHotelAccount(id);
    const db = readLocal();
    const charge = (db.hotelCharges || []).find(c => c.reservationId === id && c.id === chargeId);
    if (!charge) throw new ApiError(422, 'Consumo no encontrado.');
    if (charge.status === 'cancelled') return account;
    if (account.closedAt) throw new ApiError(409, 'La cuenta ya está cerrada.');
    if (account.reservation.status !== 'checkin') throw new ApiError(422, 'La estancia está cerrada; no puedes modificar sus consumos.');
    if (money(account.total - charge.total) < money(account.advance + account.netPaidTotal)) throw new ApiError(409, 'La anulación requiere gestionar una devolución del saldo a favor.');
    const product = db.products.find(p => p.id === charge.productId);
    if (!product) throw new ApiError(422, 'No se encontró el producto para devolver sus existencias.');
    const before = product.stock;
    product.stock = money(before + charge.quantity);
    charge.status = 'cancelled'; charge.cancelledAt = new Date().toISOString();
    db.movements.unshift({ id: uniqueId('MOV'), productId: product.id, productName: product.name, movementType: 'adjustment', quantityDelta: charge.quantity, stockBefore: before, stockAfter: product.stock, note: `Anulación de consumo habitación ${account.reservation.roomNumber}`, createdAt: charge.cancelledAt, referenceType: 'hotel_charge', referenceId: charge.id });
    writeLocal(db);
    return getHotelAccount(id);
  });
}

async function requireHotelCashManage() {
  await requireHotelManage();
  const user = await desktop.auth.me();
  if (!['owner','business_admin'].includes(user.role) && !user.permissions?.includes('cash.manage')) throw new ApiError(403, 'Necesitas permiso de caja para cobrar.');
  return user;
}
export async function addHotelPayment(id: string, input: HotelPaymentInput): Promise<HotelAccount> {
  if (!isDesktopMode()) return api<HotelAccount>(`/hotel/reservations/${encodeURIComponent(id)}/payments`, { method: 'POST', body: JSON.stringify(input) });
  return localHotelWrite(async () => {
    const user = await requireHotelCashManage();
    const account = await getHotelAccount(id);
    const previous = account.payments.find(p => p.idempotencyKey === input.idempotencyKey);
    if (previous) {
      if (previous.amount !== input.amount || previous.method !== input.method || previous.reference !== input.reference.trim() || previous.cashSessionId !== input.cashSessionId) throw new ApiError(409, 'La solicitud ya corresponde a otro pago.');
      return account;
    }
    if (account.closedAt || account.reservation.status === 'cancelled') throw new ApiError(409, 'La cuenta está cerrada o cancelada.');
    if (!['cash','card','transfer','digital'].includes(input.method) || input.idempotencyKey.length < 8 || input.reference.length > 200 || !Number.isFinite(input.amount) || input.amount > 1e9 || input.amount <= 0 || Math.abs(input.amount-money(input.amount)) > 0.000001 || input.amount > account.balance) throw new ApiError(422, 'El importe debe ser positivo, tener máximo dos decimales y no superar el saldo.');
    const db = readLocal();
    if (!db.cashSession || db.cashSession.status !== 'open' || db.cashSession.id !== input.cashSessionId || db.cashSession.openedByUserId !== user.id) throw new ApiError(409, 'Abre tu propio turno de caja antes de registrar el pago.');
    db.hotelPayments = [...(db.hotelPayments || []), { ...input, reference: input.reference.trim(), id: uniqueId('HP'), reservationId: id, createdAt: new Date().toISOString() }];
    writeLocal(db);
    return getHotelAccount(id);
  });
}
export async function closeHotelAccount(id: string): Promise<HotelAccount> {
  if (!isDesktopMode()) return api<HotelAccount>(`/hotel/reservations/${encodeURIComponent(id)}/close`, { method: 'POST' });
  return localHotelWrite(async () => {
    await requireHotelCashManage();
    const account = await getHotelAccount(id);
    if (!account.closedAt) {
      if (!['checkin','checkout'].includes(account.reservation.status) || account.balance > 0) throw new ApiError(409, 'La estancia debe estar iniciada y sin saldo pendiente.');
      const config = await desktop.config.get<{name: string}>();
      const receipt: HotelReceipt = { ...account, businessName: config?.name || 'Hotel', currency: 'COP', receiptId: uniqueId('HOT'), closedAt: new Date().toISOString() };
      const db = readLocal(); db.hotelClosures = { ...db.hotelClosures, [id]: receipt }; writeLocal(db);
    }
    await desktop.hotel.updateReservationStatus(id,'checkout');
    return getHotelAccount(id);
  });
}

export async function refundHotelPayment(id: string, input: HotelRefundInput): Promise<HotelAccount> {
  if (!isDesktopMode()) return api<HotelAccount>(`/hotel/reservations/${encodeURIComponent(id)}/refunds`, { method: 'POST', body: JSON.stringify(input) });
  return localHotelWrite(async () => {
    const user = await requireHotelCashManage();
    const account = await getHotelAccount(id);
    const prior = account.refunds.find(r => r.idempotencyKey === input.idempotencyKey);
    if (prior) {
      if (prior.paymentId !== input.paymentId || prior.cashSessionId !== input.cashSessionId || prior.amount !== input.amount || prior.reason !== input.reason.trim()) throw new ApiError(409,'La solicitud corresponde a otra devolución.');
      return account;
    }
    const payment = account.payments.find(p => p.id === input.paymentId);
    if (!payment) throw new ApiError(404,'Pago no encontrado.');
    const available = money(payment.amount-account.refunds.filter(r => r.paymentId === payment.id).reduce((sum,r) => sum+r.amount,0));
    if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > available || Math.abs(input.amount-money(input.amount)) > 0.000001 || input.reason.trim().length < 3 || input.reason.length > 500 || input.idempotencyKey.length < 8) throw new ApiError(422,'Revisa el importe disponible y el motivo de la devolución.');
    const session = await dataService.getCurrentCashSession();
    if (!session || session.status !== 'open' || session.id !== input.cashSessionId || session.openedByUserId !== user.id) throw new ApiError(409,'Abre tu propio turno de caja.');
    if (payment.method === 'cash' && input.amount > (session.expectedAmount ?? 0)) throw new ApiError(409,'El turno no tiene suficiente efectivo esperado.');
    const db = readLocal();
    db.hotelRefunds = [...(db.hotelRefunds || []), { ...input, reason: input.reason.trim(), id: uniqueId('HR'), reservationId: id, method: payment.method, createdAt: new Date().toISOString() }];
    writeLocal(db);
    return getHotelAccount(id);
  });
}
export async function getHotelIncomeReport(start: string, end: string): Promise<HotelIncomeReport> {
  if (!isDesktopMode()) return api<HotelIncomeReport>(`/hotel/reports/income?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
  const user = await desktop.auth.me();
  if (!['owner','business_admin'].includes(user.role) && !(user.permissions?.includes('hotel.view') && user.permissions?.includes('reports.view'))) throw new ApiError(403,'Necesitas permisos de hotel y reportes.');
  const range = (Date.parse(end)-Date.parse(start))/86400000;
  if (!Number.isFinite(range) || range < 0 || range > 365) throw new ApiError(422,'Selecciona un periodo de hasta 366 días.');
  const reservations = await desktop.hotel.reservations();
  const db = readLocal();
  const transactions: HotelIncomeTransaction[] = [];
  for (const [kind, rows] of [['payment',db.hotelPayments || []],['refund',db.hotelRefunds || []]] as const) {
    for (const row of rows) {
      const day = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota'}).format(new Date(row.createdAt));
      if (day < start || day > end) continue;
      const reservation = reservations.find(r => r.id === row.reservationId);
      if (!reservation) continue;
      transactions.push({ id: row.id, reservationId: reservation.id, guestName: reservation.guestName, roomNumber: reservation.roomNumber, kind, method: row.method, amount: row.amount, createdAt: row.createdAt, reference: 'reason' in row ? row.reason : row.reference });
    }
  }
  const methods = (['cash','card','transfer','digital'] as const).map(method => {
    const gross = money(transactions.filter(r => r.method === method && r.kind === 'payment').reduce((sum,r) => sum+r.amount,0));
    const refunded = money(transactions.filter(r => r.method === method && r.kind === 'refund').reduce((sum,r) => sum+r.amount,0));
    return { method, gross, refunded, net: money(gross-refunded) };
  });
  const gross = money(methods.reduce((sum,r) => sum+r.gross,0));
  const refunded = money(methods.reduce((sum,r) => sum+r.refunded,0));
  return { start, end, gross, refunded, net: money(gross-refunded), methods, transactions: transactions.sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)) };
}

export interface ServiceCatalogRecord { id: string; nombre: string; name: string; duracion: number; durationMinutes: number; precio: number; price: number; categoria: string; category: string; color: string; active: boolean; }
export interface ServiceProfessionalRecord { id: string; nombre: string; name: string; especialidad: string; specialty: string; color: string; horario: { dia?: number; inicio?: string; fin?: string }[]; availability: { dia?: number; inicio?: string; fin?: string }[]; active: boolean; }
export interface ServiceAppointmentRecord {
  id: string; clienteId?: string | null; clienteNombre: string; clienteTelefono: string; clienteEmail: string;
  servicioId: string; servicioNombre: string; profesionalId: string; profesionalNombre: string;
  fecha: string; horaInicio: string; horaFin: string; estado: 'reserved' | 'confirmed' | 'attended' | 'cancelled' | 'no_show'; saleId?: string | null;
  notes: string; durationMinutes: number; price: number; createdAt: string;
}
export async function getServicesCatalog() {
  if (isDesktopMode()) return desktop.services.catalog();
  return api<ServiceCatalogRecord[]>('/services/catalog');
}
export async function createServiceCatalogItem(input: { name: string; durationMinutes: number; price: number; category?: string; color?: string }) {
  if (isDesktopMode()) return desktop.services.createCatalogItem(input);
  return api<ServiceCatalogRecord>('/services/catalog', { method: 'POST', body: JSON.stringify(input) });
}
export async function getServiceProfessionals() {
  if (isDesktopMode()) return desktop.services.professionals();
  return api<ServiceProfessionalRecord[]>('/services/professionals');
}
export async function createServiceProfessional(input: { name: string; specialty?: string; color?: string; availability?: { dia?: number; inicio?: string; fin?: string }[] }) {
  if (isDesktopMode()) return desktop.services.createProfessional(input);
  return api<ServiceProfessionalRecord>('/services/professionals', { method: 'POST', body: JSON.stringify(input) });
}
export async function getServiceAppointments(from?: string, to?: string) {
  if (isDesktopMode()) return desktop.services.appointments();
  const query = new URLSearchParams(); if (from) query.set('from', from); if (to) query.set('to', to);
  return api<ServiceAppointmentRecord[]>(`/services/appointments${query.size ? `?${query.toString()}` : ''}`);
}
export async function createServiceAppointment(input: { serviceId: string; professionalId: string; clientName: string; clientEmail?: string; clientPhone?: string; appointmentDate: string; startTime: string; notes?: string }) {
  if (isDesktopMode()) return desktop.services.createAppointment(input);
  return api<ServiceAppointmentRecord>('/services/appointments', { method: 'POST', body: JSON.stringify(input) });
}
export async function editServiceAppointment(id: string, input: { serviceId: string; professionalId: string; clientName: string; clientEmail?: string; clientPhone?: string; appointmentDate: string; startTime: string; notes?: string }) {
  if (isDesktopMode()) return desktop.services.editAppointment(id, input);
  return api<ServiceAppointmentRecord>(`/services/appointments/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });
}
export async function deleteServiceAppointment(id: string) {
  if (isDesktopMode()) return desktop.services.deleteAppointment(id);
  return api<void>(`/services/appointments/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function updateServiceAppointmentStatus(id: string, status: ServiceAppointmentRecord['estado']) {
  if (isDesktopMode()) return desktop.services.updateAppointmentStatus(id, status);
  return api<ServiceAppointmentRecord>(`/services/appointments/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
}

export interface SubscriptionPlanRecord { id: 'free' | 'entrepreneur' | 'business' | 'enterprise'; name: string; priceCOP: number; maxUsers: number; maxProducts: number; }
export interface BusinessSubscriptionRecord { businessId: string; plan: SubscriptionPlanRecord; status: 'active' | 'pending_payment' | 'expired' | 'cancelled'; pendingPlan: SubscriptionPlanRecord | null; startedAt: string | null; expiresAt: string | null; updatedAt: string | null; }
export async function getSubscriptionPlans() {
  if (isDesktopMode()) return desktop.subscription.plans();
  return api<SubscriptionPlanRecord[]>('/subscription/plans');
}
export async function getBusinessSubscription() {
  if (isDesktopMode()) return desktop.subscription.current();
  return api<BusinessSubscriptionRecord>('/subscription');
}
export async function selectSubscriptionPlan(planId: SubscriptionPlanRecord['id']) {
  if (isDesktopMode()) return desktop.subscription.select(planId);
  return api<BusinessSubscriptionRecord>('/subscription', { method: 'PUT', body: JSON.stringify({ planId }) });
}

export interface PlatformSubscriptionRecord extends BusinessSubscriptionRecord { businessName: string; }
export async function getPlatformSubscriptions() {
  if (isDesktopMode()) return desktop.platform.subscriptions();
  return api<PlatformSubscriptionRecord[]>('/platform/subscriptions');
}
export async function updatePlatformSubscription(businessId: string, action: 'confirm_payment' | 'cancel_request', paymentReference?: string) {
  if (isDesktopMode()) return desktop.platform.updateSubscription(businessId, action, paymentReference);
  return api<BusinessSubscriptionRecord>(`/platform/subscriptions/${encodeURIComponent(businessId)}`, { method: 'PATCH', body: JSON.stringify({ action, paymentReference }) });
}

export async function getPlatformStats() {
  if (isDesktopMode()) return desktop.platform.stats();
  return api<{ businesses: number; activeBusinesses: number; users: number; activeUsers: number; completedSales: number; salesVolumeCOP: number }>('/platform/stats');
}

export async function getPlatformBusinesses() {
  if (isDesktopMode()) return desktop.platform.businesses();
  return api<{ id: string; name: string; type: string; currency: string; active: boolean; createdAt: string; users: number; suspensionReason?: string; suspensionDescription?: string; suspendedAt?: string }[]>('/platform/businesses');
}

export async function setPlatformBusinessStatus(id: string, active: boolean, reason = '', description = '') {
  if (isDesktopMode()) return desktop.platform.setBusinessStatus(id, active, reason, description);
  const params = new URLSearchParams({ active: String(active) });
  if (!active) { params.set('reason', reason); params.set('description', description); }
  return api<{ id: string; active: boolean; caseId?: string | null }>(`/platform/businesses/${encodeURIComponent(id)}/status?${params.toString()}`, { method: 'PATCH' });
}
export interface PlatformUserRecord {
  id: string; businessId: string | null; businessName: string | null; name: string; email: string;
  role: 'superadmin' | 'owner' | 'business_admin' | 'cashier'; active: boolean; createdAt: string;
}
export async function getPlatformUsers(search = '') {
  if (isDesktopMode()) return desktop.platform.users(search);
  return api<PlatformUserRecord[]>(`/platform/users${search ? `?search=${encodeURIComponent(search)}` : ''}`);
}
export interface PlatformAuditRecord {
  id: number; actorId: string; actorName: string; action: string; entityId: string; details: Record<string, unknown>; createdAt: string;
}
export async function getPlatformAudit(limit = 50) {
  if (isDesktopMode()) return desktop.platform.audit(limit);
  return api<PlatformAuditRecord[]>(`/platform/audit?limit=${Math.min(200, Math.max(1, limit))}`);
}
export async function createPlatformUser(input: { name: string; email: string; password: string; role: 'superadmin' | 'owner' | 'business_admin' | 'cashier'; businessId?: string | null }) {
  if (isDesktopMode()) return desktop.platform.createUser(input);
  return api<PlatformUserRecord>('/platform/users', { method: 'POST', body: JSON.stringify(input) });
}

export async function setPlatformUserStatus(id: string, active: boolean) {
  if (isDesktopMode()) return desktop.platform.setUserStatus(id, active);
  return api<{ id: string; active: boolean }>(`/platform/users/${encodeURIComponent(id)}/status?active=${active}`, { method: 'PATCH' });
}

export interface BusinessUserRecord {
  id: string; businessId: string; name: string; email: string; role: 'owner' | 'business_admin' | 'cashier'; customRoleId?: string | null; customRoleName?: string | null; active: boolean; createdAt: string;
}
export interface CustomRoleRecord { id: string; name: string; permissions: string[]; createdAt: string; }
export async function getBusinessUsers() {
  if (isDesktopMode()) return desktop.users.list();
  return api<BusinessUserRecord[]>('/users');
}
export async function getCustomRoles() {
  if (isDesktopMode()) return desktop.users.roles();
  return api<CustomRoleRecord[]>('/custom-roles');
}
export async function createCustomRole(payload: { name: string; permissions: string[] }) {
  if (isDesktopMode()) return desktop.users.createRole(payload);
  return api<CustomRoleRecord>('/custom-roles', { method: 'POST', body: JSON.stringify(payload) });
}
export async function updateCustomRole(id: string, payload: { name: string; permissions: string[] }) {
  return api<CustomRoleRecord>(`/custom-roles/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
}
export async function deleteCustomRole(id: string) {
  await api<void>(`/custom-roles/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
export async function createBusinessUser(payload: { name: string; email: string; password: string; role: 'business_admin' | 'cashier'; customRoleId?: string | null }) {
  if (isDesktopMode()) return desktop.users.create(payload);
  return api<BusinessUserRecord>('/users', { method: 'POST', body: JSON.stringify(payload) });
}
export async function updateBusinessUser(id: string, patch: { role?: 'business_admin' | 'cashier'; customRoleId?: string | null; active?: boolean }) {
  if (isDesktopMode()) return desktop.users.update(id, patch);
  return api<BusinessUserRecord>(`/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export interface SupportMessageRecord { id: number; senderId: string; senderRole: string; senderName: string; message: string; createdAt: string; readAt?: string | null; }
export interface SupportCaseRecord { id: string; businessId: string; businessName?: string | null; reason: string; description: string; status: 'open'|'in_review'|'awaiting_business'|'resolved'|'closed'; createdAt: string; updatedAt: string; unreadCount: number; }
export interface SuspensionStatusRecord { businessId: string; businessName: string; active: boolean; reason: string; description: string; suspendedAt?: string | null; case: SupportCaseRecord | null; messages: SupportMessageRecord[]; }
export async function getSuspensionStatus() {
  if (isDesktopMode()) return desktop.support.suspension();
  return api<SuspensionStatusRecord>('/suspension/status');
}
export async function getOwnerSupportCase() {
  if (isDesktopMode()) return desktop.support.ownerCase();
  return api<SupportCaseRecord | null>('/support/case');
}
export async function getOwnerSupportMessages() {
  if (isDesktopMode()) return desktop.support.ownerMessages();
  return api<SupportMessageRecord[]>('/support/messages');
}
export async function sendOwnerSupportMessage(message: string) {
  if (isDesktopMode()) return desktop.support.sendOwnerMessage(message);
  return api<SupportMessageRecord>('/support/messages', { method: 'POST', body: JSON.stringify({ message }) });
}
export async function getPlatformSupportCases() {
  if (isDesktopMode()) return desktop.support.platformCases();
  return api<SupportCaseRecord[]>('/platform/support/cases');
}
export async function getPlatformSupportMessages(caseId: string) {
  if (isDesktopMode()) return desktop.support.platformMessages(caseId);
  return api<SupportMessageRecord[]>(`/platform/support/cases/${encodeURIComponent(caseId)}/messages`);
}
export async function sendPlatformSupportMessage(caseId: string, message: string) {
  if (isDesktopMode()) return desktop.support.sendPlatformMessage(caseId, message);
  return api<SupportMessageRecord>(`/platform/support/cases/${encodeURIComponent(caseId)}/messages`, { method: 'POST', body: JSON.stringify({ message }) });
}
export async function updatePlatformSupportCase(caseId: string, status: SupportCaseRecord['status']) {
  if (isDesktopMode()) return desktop.support.updatePlatformCase(caseId, status);
  return api<{ id: string; status: SupportCaseRecord['status'] }>(`/platform/support/cases/${encodeURIComponent(caseId)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
}

function localKey(): string {
  return isDesktopMode() ? desktop.database.key() : STORAGE_KEY;
}

function makeLocalDatabase(): LocalDatabase {
  const key = localKey();
  try {
    const saved = localStorage.getItem(key);
    if (saved) {
      const parsed = JSON.parse(saved) as LocalDatabase;
      if (parsed.version === 1 && Array.isArray(parsed.products) && Array.isArray(parsed.sales)) {
        const safe = { ...parsed, suppliers: Array.isArray(parsed.suppliers) ? parsed.suppliers : [], recipes: Array.isArray(parsed.recipes) ? parsed.recipes : [], orders: Array.isArray(parsed.orders) ? parsed.orders : [], tables: Array.isArray(parsed.tables) ? parsed.tables : [], movements: Array.isArray(parsed.movements) ? parsed.movements : [], cashSession: parsed.cashSession ?? null };
        localStorage.setItem(key, JSON.stringify(safe));
        return safe;
      }
    }
  } catch { /* A corrupted local cache will be rebuilt from safe demo data. */ }
  const initial: LocalDatabase = isDesktopMode()
    ? { version: 1, products: [], suppliers: [], sales: [], recipes: [], orders: [], tables: [], movements: [], cashSession: null }
    : { version: 1, products: INITIAL_PRODUCTS, suppliers: [], sales: [], recipes: [], orders: [], tables: [], movements: [], cashSession: null };
  localStorage.setItem(key, JSON.stringify(initial));
  return initial;
}

function readLocal(): LocalDatabase { return makeLocalDatabase(); }
function writeLocal(db: LocalDatabase) { localStorage.setItem(localKey(), JSON.stringify(db)); }
function networkError(error: unknown): boolean { return error instanceof TypeError; }
function hasAuthenticatedSession(): boolean { return Boolean(localStorage.getItem('manager_stock_auth_token')); }
// Local fallback is allowed only for the unauthenticated preview mode. Once signed in,
// a network outage must never split transactional records between SQLite and localStorage.
// En escritorio no hay servidor: el almacenamiento local ES la fuente de verdad.
function canFallbackToLocal(error: unknown): boolean { return networkError(error) && (isDesktopMode() || !hasAuthenticatedSession()); }
function uniqueId(prefix: string) { return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`; }
function money(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }

function validateLocalQuantity(product: Product, quantity: number) {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('La cantidad debe ser mayor que cero.');
  const discrete = ['unidad', 'porcion', 'paquete', 'tajada', 'caja', 'pieza', 'par', 'botella', 'lata', 'servicio'];
  const unit = (product.unit || 'unidad').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (discrete.includes(unit) && !Number.isInteger(quantity)) throw new Error('La cantidad debe ser entera para esta unidad de medida.');
}

export const dataService = {
  currency: CURRENCY,
  defaultTaxRate: DEFAULT_TAX_RATE,
  async apiIsAvailable(): Promise<boolean> {
    if (isDesktopMode()) return false;
    try { await api('/health'); return true; }
    catch (error) {
      // A signed-in user must never silently move to the browser's local cache.
      if (networkError(error) && !hasAuthenticatedSession()) return false;
      if (networkError(error)) throw new Error('No hay conexión con la API. La sesión sigue activa y no se usarán datos locales para evitar inconsistencias.');
      throw error;
    }
  },
  async getProducts(): Promise<Product[]> {
    try {
      const data = await api<Product[]>('/products');
      const db = readLocal(); db.products = data; writeLocal(db);
      return data;
    } catch (error) {
      if (!canFallbackToLocal(error)) throw error;
      return readLocal().products;
    }
  },
  async getProduct(id: string): Promise<Product | undefined> {
    const products = await this.getProducts();
    return products.find((product) => product.id === id);
  },
  async createProduct(input: Omit<Product, 'id'> & { id?: string; cost?: number; productType?: 'sale_item' | 'ingredient' | 'supplies'; unit?: string }): Promise<Product> {
    const payload = { ...input, productType: input.productType || 'sale_item', unit: input.unit || 'unidad', cost: input.cost || 0 };
    try {
      const created = await api<Product>('/products', { method: 'POST', body: JSON.stringify(payload) });
      const db = readLocal(); db.products = [...db.products.filter(p => p.id !== created.id), created]; writeLocal(db);
      return created;
    } catch (error) {
      if (!canFallbackToLocal(error)) throw error;
      const db = readLocal();
      if (db.products.some(p => p.sku.toLowerCase() === payload.sku.trim().toLowerCase())) throw new Error('Ya existe un producto con ese SKU.');
      const created: Product = { ...payload, id: input.id || uniqueId('PRD') };
      db.products.push(created);
      if (created.stock > 0) db.movements.unshift({ id: uniqueId('MOV'), productId: created.id, productName: created.name, movementType: 'opening', quantityDelta: created.stock, stockBefore: 0, stockAfter: created.stock, note: 'Existencias iniciales del producto', createdAt: new Date().toISOString() });
      writeLocal(db); return created;
    }
  },
  uploadProductImage(id: string, dataUrl: string): Promise<Product> {
    return api<Product>(`/products/${encodeURIComponent(id)}/image`, { method: 'PUT', body: JSON.stringify({ dataUrl }) });
  },
  removeProductImage(id: string): Promise<Product> {
    return api<Product>(`/products/${encodeURIComponent(id)}/image`, { method: 'DELETE' });
  },
  async updateProduct(id: string, input: Omit<Product, 'id'> & { cost?: number; productType?: 'sale_item' | 'ingredient' | 'supplies'; unit?: string }): Promise<Product> {
    const payload = { ...input, productType: input.productType || 'sale_item', unit: input.unit || 'unidad', cost: input.cost || 0 };
    try {
      const updated = await api<Product>(`/products/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
      const db = readLocal(); db.products = db.products.map(p => p.id === id ? updated : p); writeLocal(db); return updated;
    } catch (error) {
      if (!canFallbackToLocal(error)) throw error;
      const db = readLocal();
      if (db.products.some(p => p.id !== id && p.sku.toLowerCase() === payload.sku.trim().toLowerCase())) throw new Error('Ya existe un producto con ese SKU.');
      const index = db.products.findIndex(p => p.id === id);
      if (index < 0) throw new Error('No se encontró el producto.');
      const previous = db.products[index];
      const updated: Product = { ...payload, id };
      if (updated.stock !== previous.stock) db.movements.unshift({ id: uniqueId('MOV'), productId: id, productName: updated.name, movementType: 'adjustment', quantityDelta: updated.stock - previous.stock, stockBefore: previous.stock, stockAfter: updated.stock, note: 'Ajuste manual desde edición de producto', createdAt: new Date().toISOString() });
      db.products[index] = updated; writeLocal(db); return updated;
    }
  },
  async deleteProduct(id: string): Promise<void> {
    try { await api(`/products/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
    catch (error) {
      if (!canFallbackToLocal(error)) throw error;
      const db = readLocal(); db.products = db.products.filter(p => p.id !== id); writeLocal(db); return;
    }
    const db = readLocal(); db.products = db.products.filter(p => p.id !== id); writeLocal(db);
  },
  async getSales(): Promise<SaleRecord[]> {
    try {
      const pageSize = 500;
      const data: SaleRecord[] = [];
      let offset = 0;
      while (true) {
        const page = await api<SaleRecord[]>(`/sales?limit=${pageSize}&offset=${offset}`);
        data.push(...page);
        if (page.length < pageSize) break;
        offset += page.length;
      }
      // Never silently destroy offline-only records when the server is enabled later.
      const local = readLocal();
      const serverIds = new Set(data.map(sale => sale.id));
      const offlineOnly = local.sales.filter(sale => !serverIds.has(sale.id));
      if (offlineOnly.length) {
        const backupKey = 'manager_stock_offline_backup_v1';
        try {
          const oldBackup = localStorage.getItem(backupKey);
          const backup = oldBackup ? JSON.parse(oldBackup) : null;
          const previousSales = Array.isArray(backup?.sales) ? backup.sales as SaleRecord[] : [];
          const allSales = new Map<string, SaleRecord>();
          [...previousSales, ...offlineOnly].forEach(sale => allSales.set(sale.id, sale));
          localStorage.setItem(backupKey, JSON.stringify({ savedAt: new Date().toISOString(), sales: [...allSales.values()], note: 'Registros que existían en modo local y no están en la base SQLite del servidor. No fueron importados automáticamente para evitar duplicar ventas e inventario.' }));
        } catch { /* Preserve the current server data even if the browser cannot create a backup. */ }
      }
      // Con sesión el servidor es la fuente de verdad y la copia local nunca se lee
      // (canFallbackToLocal). Guardar todo el historial llenaba el límite de ~5 MB de
      // localStorage y rompía Ventas/Reportes/Dashboard en negocios con muchas ventas.
      if (isDesktopMode() || !hasAuthenticatedSession()) { local.sales = data; writeLocal(local); }
      return data;
    } catch (error) {
      if (!canFallbackToLocal(error)) throw error;
      return readLocal().sales.sort((a, b) => b.date.localeCompare(a.date));
    }
  },
  async getSale(id: string): Promise<SaleRecord | undefined> {
    try {
      const sale = await api<SaleRecord>(`/sales/${encodeURIComponent(id)}`);
      const db = readLocal(); db.sales = [sale, ...db.sales.filter(s => s.id !== sale.id)]; writeLocal(db); return sale;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return undefined;
      if (!canFallbackToLocal(error)) throw error;
      return readLocal().sales.find(s => s.id === id);
    }
  },
  async createSale(input: CreateSaleInput): Promise<SaleRecord> {
    const request = { ...input, idempotencyKey: input.idempotencyKey || (globalThis.crypto?.randomUUID?.() ?? uniqueId('REQ')), customer: input.customer || 'Cliente general', paymentMethod: input.paymentMethod || 'cash', globalDiscountPercent: input.globalDiscountPercent || 0, taxRate: input.taxRate ?? DEFAULT_TAX_RATE, status: input.status || 'completed' };
    // Select local mode before submitting. A network failure after POST is ambiguous, so never silently create a local twin.
    const serverAvailable = await this.apiIsAvailable();
    let serverCreated: SaleRecord | undefined;
    if (serverAvailable) {
      try {
        serverCreated = await api<SaleRecord>('/sales', { method: 'POST', body: JSON.stringify(request) });
      } catch (error) {
        if (!networkError(error)) throw error;
        try {
          serverCreated = await api<SaleRecord>(`/sales/by-key/${encodeURIComponent(request.idempotencyKey)}`);
        } catch (lookupError) {
          if (lookupError instanceof ApiError && lookupError.status === 404) {
            try { serverCreated = await api<SaleRecord>('/sales', { method: 'POST', body: JSON.stringify(request) }); }
            catch { throw new Error('No se pudo confirmar la venta por un problema de conexión. Consulta el historial antes de volver a intentarlo.'); }
          } else {
            throw new Error('No se pudo confirmar si la venta quedó registrada. Consulta el historial antes de volver a intentarlo.');
          }
        }
      }
    }
    if (serverCreated) {
      const db = readLocal(); db.sales = [serverCreated, ...db.sales.filter(s => s.id !== serverCreated!.id)];
      try { db.products = await api<Product[]>('/products'); } catch { /* Sale is already committed; never retry it because a refresh failed. */ }
      writeLocal(db);
      return serverCreated;
    }
    {
      const db = readLocal();
      const previous = db.sales.find(s => s.idempotencyKey === request.idempotencyKey || s.id === request.idempotencyKey);
      if (previous) return previous;
      if (request.orderIds?.length && request.status !== 'completed') throw new Error('El cobro de pedidos debe ser una venta completada.');
      const linkedOrders = [...new Set(request.orderIds || [])].map(id => {
        const order = db.orders.find(row => row.id === id);
        if (!order) throw new Error('Pedido no encontrado.');
        if (order.saleId || ['delivered', 'cancelled'].includes(order.status)) throw new Error('El pedido ya fue cobrado o cerrado.');
        return order;
      });
      request.items = [...request.items, ...linkedOrders.flatMap(order => order.items.map(item => ({ productId: item.productId, quantity: item.quantity })))];
      if (!request.items.length) throw new Error('Agrega al menos un producto a la venta.');
      if (request.globalDiscountPercent < 0 || request.globalDiscountPercent > 100) throw new Error('El descuento general debe estar entre 0 y 100 %.');
      if (request.taxRate < 0 || request.taxRate > 0.3) throw new Error('La tasa de impuesto debe estar entre 0 y 30 %.');
      if (request.items.some(item => !Number.isFinite(item.quantity) || item.quantity <= 0 || (item.discountPercent || 0) < 0 || (item.discountPercent || 0) > 100)) throw new Error('Revisa las cantidades y descuentos de los productos.');

      if (request.cashSessionId && (db.cashSession?.id !== request.cashSessionId || db.cashSession.status !== 'open')) throw new Error('El turno de caja no está abierto. Abre una caja antes de cobrar.');
      const quantityByProduct = new Map<string, number>();
      request.items.forEach(item => quantityByProduct.set(item.productId, (quantityByProduct.get(item.productId) || 0) + item.quantity));
      const rows = request.items.map(item => {
        const product = db.products.find(p => p.id === item.productId);
        if (!product) throw new Error(`No se encontró el producto ${item.productId}.`);
        validateLocalQuantity(product, item.quantity);
        if (product.productType === 'ingredient' || product.productType === 'supplies') throw new Error(`${product.name} es un insumo y no se puede vender directamente.`);
        if (product.stock < (quantityByProduct.get(item.productId) || item.quantity)) throw new Error(`Stock insuficiente para ${product.name}. Disponible: ${product.stock}; solicitado: ${quantityByProduct.get(item.productId) || item.quantity}.`);
        return { input: item, product };
      });
      let subtotal = 0; let lineDiscount = 0;
      const saleItems: SaleItemRecord[] = rows.map(({ input: item, product }) => {
        if (item.quantity <= 0) throw new Error('La cantidad debe ser mayor a cero.');
        const gross = money(product.price * item.quantity); const disc = money(gross * ((item.discountPercent || 0) / 100));
        subtotal += gross; lineDiscount += disc;
        const unitCost = product.cost || 0;
        return { productId: product.id, productName: product.name, sku: product.sku, quantity: item.quantity, price: product.price, unitCost: money(unitCost), discountPercent: item.discountPercent || 0, subtotal: money(gross - disc) };
      });
      subtotal = money(subtotal); lineDiscount = money(lineDiscount);
      const globalDiscount = money(Math.max(0, subtotal - lineDiscount) * (request.globalDiscountPercent / 100));
      const taxable = Math.max(0, money(subtotal - lineDiscount - globalDiscount));
      const tax = money(taxable * request.taxRate); const total = money(taxable + tax);
      const created: SaleRecord = {
        id: `VTA-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        date: new Date().toISOString(), status: request.status, customer: request.customer, paymentMethod: request.paymentMethod, currency: CURRENCY, cashSessionId: request.cashSessionId || null, payments: request.payments || (request.paymentMethod !== 'split' ? [{ method: request.paymentMethod as PaymentPartMethod, amount: total }] : []),
        subtotal, lineDiscount, globalDiscount, taxRate: request.taxRate, tax, totalPrice: total,
        productId: saleItems[0]?.productId || '', productName: saleItems.length > 2 ? `${saleItems[0].productName}, ${saleItems[1].productName} y ${saleItems.length - 2} más` : saleItems.map(i => i.productName).join(', '),
        quantity: saleItems.reduce((sum, i) => sum + i.quantity, 0), items: saleItems, idempotencyKey: request.idempotencyKey,
      };
      const inventoryEffects: { productId: string; quantityDelta: number }[] = [];
      rows.forEach(({ input, product }) => {
        const before = product.stock; product.stock = money(product.stock - input.quantity);
        inventoryEffects.push({ productId: product.id, quantityDelta: -input.quantity });
        db.movements.unshift({ id: uniqueId('MOV'), productId: product.id, productName: product.name, saleId: created.id, movementType: 'sale', quantityDelta: -input.quantity, stockBefore: before, stockAfter: product.stock, note: `Venta ${created.id}`, createdAt: created.date });
      });
      created.inventoryEffects = inventoryEffects;
      linkedOrders.forEach(order => { order.status = 'delivered'; order.saleId = created.id; });
      db.sales.unshift(created); writeLocal(db); return created;
    }
  },
  async cancelSale(id: string): Promise<SaleRecord> {
    let serverCancelled: SaleRecord | undefined;
    try {
      serverCancelled = await api<SaleRecord>(`/sales/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
    } catch (error) {
      if (!canFallbackToLocal(error)) throw error;
    }
    if (serverCancelled) {
      const db = readLocal();
      db.sales = [serverCancelled, ...db.sales.filter(s => s.id !== id)];
      // A successful cancellation is final; a failed refresh must never trigger a second local reversal.
      try { db.products = await api<Product[]>('/products'); } catch { /* Refresh is best-effort after commit. */ }
      writeLocal(db);
      return serverCancelled;
    }
    const db = readLocal(); const sale = db.sales.find(s => s.id === id);
    if (!sale) throw new Error('No se encontró la venta.');
    if (sale.status !== 'cancelled') {
      const effects = sale.inventoryEffects || sale.items.map(item => ({ productId: item.productId, quantityDelta: -item.quantity }));
      effects.forEach(effect => {
        const product = db.products.find(p => p.id === effect.productId);
        if (product) {
          const before = product.stock; product.stock = money(product.stock - effect.quantityDelta);
          db.movements.unshift({ id: uniqueId('MOV'), productId: product.id, productName: product.name, saleId: sale.id, movementType: 'sale_cancelled', quantityDelta: -effect.quantityDelta, stockBefore: before, stockAfter: product.stock, note: `Reversión de venta ${sale.id}`, createdAt: new Date().toISOString() });
        }
      });
      sale.status = 'cancelled'; writeLocal(db);
    }
    return sale;
  },
  async getCurrentCashSession(): Promise<CashSessionRecord | null> {
    try {
      const session = await api<CashSessionRecord | null>('/cash/sessions/current');
      const db = readLocal(); db.cashSession = session; writeLocal(db); return session;
    } catch (error) {
      if (!canFallbackToLocal(error)) throw error;
      const db = readLocal();
      const user = await desktop.auth.me();
      const session = db.cashSession;
      if (!session || (session.openedByUserId && session.openedByUserId !== user.id)) return null;
      const cashSales = db.sales.filter(s => s.cashSessionId === session.id && s.status === 'completed').reduce((sum,s) => sum + (s.payments?.filter(p => p.method === 'cash').reduce((v,p) => v+p.amount,0) ?? (s.paymentMethod === 'cash' ? s.totalPrice : 0)),0);
      const hotelCash = (db.hotelPayments || []).filter(p => p.cashSessionId === session.id && p.method === 'cash').reduce((sum,p) => sum+p.amount,0);
      return { ...session, expectedAmount: money(session.openingAmount + cashSales + hotelCash - (db.hotelRefunds || []).filter(r => r.cashSessionId === session.id && r.method === 'cash').reduce((sum,r) => sum+r.amount,0)) };
    }
  },
  async openCashSession(openingAmount: number, openedBy: string): Promise<CashSessionRecord> {
    if (!Number.isFinite(openingAmount) || openingAmount < 0) throw new Error('El monto inicial no puede ser negativo.');
    const serverAvailable = await this.apiIsAvailable();
    if (serverAvailable) {
      try {
        const session = await api<CashSessionRecord>('/cash/sessions', { method: 'POST', body: JSON.stringify({ openingAmount, openedBy }) });
        const db = readLocal(); db.cashSession = session; writeLocal(db); return session;
      } catch (error) {
        if (!canFallbackToLocal(error)) throw error;
        try {
          const current = await api<CashSessionRecord | null>('/cash/sessions/current');
          if (current && current.openingAmount === openingAmount && current.openedBy === openedBy) { const db = readLocal(); db.cashSession = current; writeLocal(db); return current; }
        } catch { /* Report the ambiguous result instead of opening a duplicate turn. */ }
        throw new Error('No se pudo confirmar la apertura de caja. Actualiza el estado de caja antes de volver a intentarlo.');
      }
    }
    return localHotelWrite(async () => {
      const userId = (await desktop.auth.me()).id;
      const db = readLocal();
      if (db.cashSession?.status === 'open') throw new Error('Ya hay un turno local abierto.');
      const session: CashSessionRecord = { openedByUserId: userId, id: uniqueId('CAJ'), openedBy, openingAmount: money(openingAmount), expectedAmount: money(openingAmount), status: 'open', openedAt: new Date().toISOString() };
      db.cashSession = session; writeLocal(db); return session;
    });
  },
  async closeCashSession(id: string, closingAmount: number): Promise<CashSessionRecord> {
    if (!Number.isFinite(closingAmount) || closingAmount < 0) throw new Error('El efectivo contado no puede ser negativo.');
    const serverAvailable = await this.apiIsAvailable();
    if (serverAvailable) {
      try {
        const session = await api<CashSessionRecord>(`/cash/sessions/${encodeURIComponent(id)}/close`, { method: 'POST', body: JSON.stringify({ closingAmount }) });
        const db = readLocal(); db.cashSession = null; writeLocal(db); return session;
      } catch (error) {
        if (!canFallbackToLocal(error)) throw error;
        try {
          const session = await api<CashSessionRecord>(`/cash/sessions/${encodeURIComponent(id)}`);
          if (session.status === 'closed') { const db = readLocal(); db.cashSession = null; writeLocal(db); return session; }
        } catch { /* Keep the current local state if the server cannot confirm closure. */ }
        throw new Error('No se pudo confirmar el cierre de caja. Consulta el estado del turno antes de repetirlo.');
      }
    }
    return localHotelWrite(async () => {
      const db = readLocal(); const session = db.cashSession;
      if (!session || session.id !== id || session.status !== 'open') throw new Error('No se encontró un turno local abierto.');
      const cashSales = db.sales.filter(s => s.cashSessionId === id && s.status === 'completed').reduce((sum, sale) => sum + (sale.payments?.filter(p => p.method === 'cash').reduce((total, payment) => total + payment.amount, 0) ?? (sale.paymentMethod === 'cash' ? sale.totalPrice : 0)), 0);
      const hotelCash = (db.hotelPayments || []).filter(p => p.cashSessionId === id && p.method === 'cash').reduce((sum,p) => sum+p.amount,0);
      const expected = money(session.openingAmount + cashSales + hotelCash - (db.hotelRefunds || []).filter(r => r.cashSessionId === session.id && r.method === 'cash').reduce((sum,r) => sum+r.amount,0));
      const closed: CashSessionRecord = { ...session, closingAmount: money(closingAmount), expectedAmount: expected, difference: money(closingAmount - expected), status: 'closed', closedAt: new Date().toISOString() };
      db.cashSession = null; writeLocal(db); return closed;
    });
  },
  async getSuppliers(): Promise<Supplier[]> {
    try {
      const data = await api<Supplier[]>('/suppliers'); const db = readLocal(); db.suppliers = data; writeLocal(db); return data;
    } catch (error) {
      if (!canFallbackToLocal(error)) throw error;
      return readLocal().suppliers;
    }
  },
  async createSupplier(input: Omit<Supplier, 'id'>): Promise<Supplier> {
    try {
      const created = await api<Supplier>('/suppliers', { method: 'POST', body: JSON.stringify(input) });
      const db = readLocal(); db.suppliers = [...db.suppliers.filter(s => s.id !== created.id), created]; writeLocal(db); return created;
    } catch (error) {
      if (!canFallbackToLocal(error)) throw error;
      const db = readLocal(); const created: Supplier = { ...input, id: uniqueId('PROV') };
      db.suppliers.push(created); writeLocal(db); return created;
    }
  },
  async deleteSupplier(id: string): Promise<void> {
    try { await api(`/suppliers/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
    catch (error) {
      if (!canFallbackToLocal(error)) throw error;
      const db = readLocal(); db.suppliers = db.suppliers.filter(s => s.id !== id); writeLocal(db); return;
    }
    const db = readLocal(); db.suppliers = db.suppliers.filter(s => s.id !== id); writeLocal(db);
  },
  async getRecipes(): Promise<RecipeRecord[]> {
    try {
      const data = await api<RecipeRecord[]>('/recipes');
      const db = readLocal(); db.recipes = data; writeLocal(db); return data;
    } catch (error) {
      if (!canFallbackToLocal(error)) throw error;
      const db = readLocal();
      return db.recipes.map(recipe => ({ ...recipe, ingredients: recipe.ingredients.map(ingredient => ({ ...ingredient, stock: db.products.find(p => p.id === ingredient.ingredientId)?.stock })) }));
    }
  },
  async saveRecipe(input: RecipeInput): Promise<RecipeRecord> {
    try {
      const data = await api<RecipeRecord>('/recipes', { method: 'POST', body: JSON.stringify({ ...input, ingredients: input.ingredients.map(item => ({ ingredientId: item.ingredientId, quantity: item.quantity, unit: item.unit || '' })) }) });
      const db = readLocal(); db.recipes = [...db.recipes.filter(r => r.productId !== data.productId), data]; writeLocal(db); return data;
    } catch (error) {
      if (!canFallbackToLocal(error)) throw error;
      const db = readLocal();
      const product = db.products.find(p => p.id === input.productId && p.productType !== 'ingredient' && p.productType !== 'supplies');
      if (!product) throw new Error('Selecciona un producto válido para vender.');
      if (input.ingredients.some(i => !db.products.some(p => p.id === i.ingredientId && p.productType === 'ingredient'))) throw new Error('Todas las líneas de la receta deben ser ingredientes registrados.');
      if (new Set(input.ingredients.map(i => i.ingredientId)).size !== input.ingredients.length) throw new Error('No repitas el mismo ingrediente.');
      const ingredients = input.ingredients.map(item => {
        const p = db.products.find(productRow => productRow.id === item.ingredientId)!;
        return { ingredientId: p.id, name: p.name, quantity: item.quantity, unit: item.unit || p.unit || 'unidad', stock: p.stock };
      });
      const existing = db.recipes.find(r => r.productId === input.productId);
      const record: RecipeRecord = { id: existing?.id || uniqueId('REC'), productId: product.id, productName: product.name, yieldQuantity: input.yieldQuantity, instructions: input.instructions, ingredients };
      db.recipes = [...db.recipes.filter(r => r.productId !== input.productId), record]; writeLocal(db); return record;
    }
  },
  async deleteRecipe(id: string): Promise<void> {
    try { await api(`/recipes/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
    catch (error) { if (!canFallbackToLocal(error)) throw error; }
    const db = readLocal(); db.recipes = db.recipes.filter(r => r.id !== id); writeLocal(db);
  },
  // ── Mesas del salón ──────────────────────────────────────────────────────
  async getTables(): Promise<RestaurantTableRecord[]> {
    try {
      const data = await api<RestaurantTableRecord[]>('/tables');
      const db = readLocal(); db.tables = data; writeLocal(db);
      return data;
    } catch (error) {
      if (!canFallbackToLocal(error)) throw error;
      return readLocal().tables.slice().sort((a, b) => a.number - b.number);
    }
  },
  async createTable(input: CreateTableInput): Promise<RestaurantTableRecord> {
    const payload = { number: input.number, zone: input.zone || '', capacity: input.capacity || 4 };
    let table: RestaurantTableRecord;
    try {
      table = await api<RestaurantTableRecord>('/tables', { method: 'POST', body: JSON.stringify(payload) });
    } catch (error) {
      if (!canFallbackToLocal(error)) throw error;
      const db = readLocal();
      if (db.tables.some(t => t.number === payload.number)) throw new Error(`Ya existe una mesa con el número ${payload.number}.`);
      table = { id: uniqueId('MESA'), number: payload.number, zone: payload.zone, capacity: payload.capacity, status: 'active', openOrders: 0, openTotal: 0, waiter: '', since: null };
    }
    const db = readLocal();
    db.tables = [...db.tables.filter(t => t.id !== table.id), table].sort((a, b) => a.number - b.number);
    writeLocal(db);
    return table;
  },
  async updateTable(id: string, input: UpdateTableInput): Promise<RestaurantTableRecord> {
    let table: RestaurantTableRecord;
    try {
      table = await api<RestaurantTableRecord>(`/tables/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
    } catch (error) {
      if (!canFallbackToLocal(error)) throw error;
      const db = readLocal();
      const local = db.tables.find(t => t.id === id);
      if (!local) throw new Error('Mesa no encontrada.');
      const nextNumber = input.number ?? local.number;
      if (nextNumber !== local.number && db.tables.some(t => t.number === nextNumber)) throw new Error(`Ya existe una mesa con el número ${nextNumber}.`);
      table = {
        ...local,
        number: nextNumber,
        zone: input.zone ?? local.zone,
        capacity: input.capacity ?? local.capacity,
        status: input.status ?? local.status,
      };
    }
    const db = readLocal();
    db.tables = [...db.tables.filter(t => t.id !== table.id), table].sort((a, b) => a.number - b.number);
    writeLocal(db);
    return table;
  },
  async deleteTable(id: string): Promise<void> {
    try { await api(`/tables/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
    catch (error) { if (!canFallbackToLocal(error)) throw error; }
    const db = readLocal(); db.tables = db.tables.filter(t => t.id !== id); writeLocal(db);
  },
  // ── Pedidos por mesa (compatibilidad con la vista de mesero) ────────────
  async getOrder(id: string): Promise<OrderRecord | undefined> {
    return (await this.getOrders()).find(o => o.id === id);
  },
  async getOrdersByTable(tableNumber: number): Promise<OrderRecord[]> {
    return (await this.getOrders()).filter(o => Number(o.tableNumber) === tableNumber);
  },
  async getOpenOrders(): Promise<OrderRecord[]> {
    return (await this.getOrders()).filter(o => o.status !== 'delivered' && o.status !== 'cancelled');
  },
  async addOrderItems(orderId: string, items: { productId: string; quantity: number; notes?: string }[]): Promise<OrderRecord> {
    try {
      await api(`/orders/${encodeURIComponent(orderId)}/items`, { method: 'POST', body: JSON.stringify({ items }) });
    } catch (error) {
      if (!canFallbackToLocal(error)) throw error;
      const db = readLocal();
      const order = db.orders.find(o => o.id === orderId);
      if (!order) throw new Error('Pedido no encontrado.');
      if (order.status !== 'received' && order.status !== 'preparing') throw new Error('La comanda ya no está abierta.');
      let total = order.total;
      for (const item of items) {
        const product = db.products.find(p => p.id === item.productId && p.productType !== 'ingredient' && p.productType !== 'supplies');
        if (!product) throw new Error('Hay un producto que ya no está disponible.');
        validateLocalQuantity(product, item.quantity);
        total += product.price * item.quantity;
        order.items.push({ productId: product.id, productName: product.name, quantity: item.quantity, unitPrice: product.price, notes: item.notes });
      }
      order.total = money(total);
      writeLocal(db);
      return order;
    }
    const updated = await this.getOrder(orderId);
    if (!updated) throw new Error('Pedido no encontrado.');
    return updated;
  },
  async getOrders(): Promise<OrderRecord[]> {
    try {
      const data = await api<any[]>('/orders');
      const normalized = data.map(row => ({ id: row.id, saleId: row.sale_id || undefined, restaurantMetadata: typeof row.restaurant_metadata === 'string' ? JSON.parse(row.restaurant_metadata) : {}, channel: row.channel, customer: row.customer, phone: row.phone, address: row.address, status: row.status, notes: row.notes, total: row.total, created_at: row.created_at, tableId: row.table_id || row.tableId || null, tableNumber: row.table_number || row.tableNumber || null, waiter: row.waiter || '', items: (row.items || []).map((item: any) => ({ productId: item.product_id || item.productId, productName: item.product_name || item.productName, quantity: item.quantity, unitPrice: item.unit_price || item.unitPrice, notes: item.notes })) })) as OrderRecord[];
      const db = readLocal(); db.orders = normalized; writeLocal(db); return normalized;
    } catch (error) {
      if (!canFallbackToLocal(error)) throw error;
      return readLocal().orders.sort((a,b) => b.created_at.localeCompare(a.created_at));
    }
  },
  async createOrder(input: CreateOrderInput): Promise<OrderRecord> {
    let serverCreated: {id: string; status: OrderRecord['status']; total: number; createdAt: string} | undefined;
    try {
      serverCreated = await api<{id: string; status: OrderRecord['status']; total: number; createdAt: string}>('/orders', { method: 'POST', body: JSON.stringify(input) });
    } catch (error) {
      if (!canFallbackToLocal(error)) throw error;
    }
    if (serverCreated) {
      const db = readLocal();
      const items = input.items.map(item => {
        const product = db.products.find(p => p.id === item.productId);
        return { productId: item.productId, productName: product?.name || item.productId, quantity: item.quantity, unitPrice: product?.price || 0, notes: item.notes };
      });
      const normalized: OrderRecord = { id: serverCreated.id, channel: input.channel, customer: input.customer || 'Cliente general', phone: input.phone || '', address: input.address || '', status: serverCreated.status, notes: input.notes || '', total: serverCreated.total, created_at: serverCreated.createdAt, items, tableId: input.tableId || null, tableNumber: input.tableNumber || null, waiter: input.waiter || '' };
      db.orders = [normalized, ...db.orders.filter(o => o.id !== normalized.id)]; writeLocal(db);
      return normalized;
    }
    const db = readLocal();
    const items = input.items.map(item => {
      const product = db.products.find(p => p.id === item.productId && p.productType !== 'ingredient' && p.productType !== 'supplies');
      if (!product) throw new Error('Hay un producto que ya no está disponible.');
      validateLocalQuantity(product, item.quantity);
      const recipe = db.recipes.find(r => r.productId === product.id);
      if (!recipe && product.stock < item.quantity) throw new Error(`Stock insuficiente para ${product.name}.`);
      return { productId: product.id, productName: product.name, quantity: item.quantity, unitPrice: product.price, notes: item.notes };
    });
    const created: OrderRecord = { restaurantMetadata: { ...input.restaurantMetadata, numero: Math.max(0, ...db.orders.map(o => Number(o.restaurantMetadata?.numero) || 0)) + 1 }, id: uniqueId('PED'), channel: input.channel, customer: input.customer || 'Cliente general', phone: input.phone || '', address: input.address || '', status: 'received', notes: input.notes || '', total: money(items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)), created_at: new Date().toISOString(), items, tableId: input.tableId || null, tableNumber: input.tableNumber || null, waiter: input.waiter || '' };
    db.orders.unshift(created); writeLocal(db); return created;
  },
  async updateOrderStatus(id: string, status: OrderRecord['status'], options: { expectedStatus?: string; actorId?: string; actorName?: string; reason?: string } = {}): Promise<void> {
    const params = new URLSearchParams({ status, ...options });
    try { await api(`/orders/${encodeURIComponent(id)}/status?${params}`, { method: 'PATCH' }); }
    catch (error) { if (!canFallbackToLocal(error)) throw error; }
    const db = readLocal(); const order = db.orders.find(o => o.id === id);
    if (isDesktopMode() && order?.saleId) throw new Error('El pedido ya fue cobrado. Gestiona su venta desde el historial.');
    if (isDesktopMode() && order && options.expectedStatus && order.status !== options.expectedStatus) throw new Error('El pedido cambió de estado. Actualiza antes de continuar.');
    if (order) {
      order.status = status;
      const prefix = { preparing: 'tomado', ready: 'finalizado', cancelled: 'cancelado', delivered: 'entregado', received: '' }[status];
      if (prefix) order.restaurantMetadata = { ...order.restaurantMetadata, [`${prefix}PorId`]: options.actorId, [`${prefix}PorNombre`]: options.actorName, [`${prefix}En`]: new Date().toISOString(), motivoCancelacion: options.reason };
    }
    writeLocal(db);
  },
  async getInventoryMovements(limit = 10000, productId?: string, filters?: { types?: string; search?: string; dateFrom?: string; dateTo?: string; locationId?: string }): Promise<InventoryMovementRecord[]> {
    try {
      const pageSize = 500;
      const rows: any[] = [];
      let offset = 0;
      while (rows.length < limit) {
        const params = new URLSearchParams({ limit: String(Math.min(pageSize, limit - rows.length)), offset: String(offset) });
        if (productId) params.set('productId', productId);
        if (filters?.types) params.set('movementType', filters.types);
        if (filters?.search) params.set('search', filters.search);
        if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
        if (filters?.dateTo) params.set('dateTo', filters.dateTo);
        if (filters?.locationId) params.set('locationId', filters.locationId);
        const page = await api<any[]>(`/inventory/movements?${params.toString()}`);
        rows.push(...page);
        if (page.length < Math.min(pageSize, limit - (rows.length - page.length))) break;
        offset += page.length;
      }
      const normalized: InventoryMovementRecord[] = rows.map(row => ({
        id: row.id, productId: row.product_id, productName: row.product_name, saleId: row.sale_id,
        movementType: row.movement_type, quantityDelta: row.quantity_delta, stockBefore: row.stock_before,
        stockAfter: row.stock_after, note: row.note, createdAt: row.created_at, sku: row.sku,
        productUnit: row.product_unit, reason: row.reason, createdByName: row.created_by_name || '',
        createdById: row.created_by, lotId: row.lot_id, lotCode: row.lot_code || '', locationId: row.location_id, locationCode: row.location_code,
        referenceType: row.reference_type, referenceId: row.reference_id, unitCost: row.unit_cost,
      }));
      const db = readLocal(); db.movements = normalized; writeLocal(db); return normalized;
    } catch (error) {
      if (!canFallbackToLocal(error)) throw error;
      return readLocal().movements.filter(row => !productId || row.productId === productId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
    }
  },
  async getInventoryOverview(): Promise<InventoryOverviewRecord> {
    try { return await api<InventoryOverviewRecord>('/inventory/overview'); }
    catch (error) {
      if (!canFallbackToLocal(error)) throw error;
      const products = readLocal().products;
      const lowStock = products.filter(product => product.stock <= product.minStock);
      return { totalValue: products.reduce((sum, p) => sum + p.stock * (p.cost || 0), 0), totalRetailValue: products.reduce((sum, p) => sum + p.stock * p.price, 0), totalUnits: products.reduce((sum, p) => sum + p.stock, 0), productCount: products.length, lowStockCount: lowStock.length, outOfStockCount: products.filter(p => p.stock <= 0).length, negativeStockCount: products.filter(p => p.stock < 0).length, expiringCount: 0, expiredCount: 0, wasteCost: 0, lowStockProducts: lowStock, expiringLots: [], recentMovements: [], generatedAt: new Date().toISOString(), settings: { allowNegativeStock: false, expiryAlertDays: 30, lowStockAlerts: true, defaultLocationId: null } };
    }
  },
  async getInventoryAlerts(): Promise<{ generatedAt: string; alerts: InventoryAlertRecord[] }> {
    try { return await api<{ generatedAt: string; alerts: InventoryAlertRecord[] }>('/inventory/alerts'); }
    catch (error) { if (!canFallbackToLocal(error)) throw error; return { generatedAt: new Date().toISOString(), alerts: [] }; }
  },
  async getInventorySettings(): Promise<InventorySettingsRecord> {
    try { return await api<InventorySettingsRecord>('/inventory/settings'); }
    catch (error) { if (!canFallbackToLocal(error)) throw error; return { allowNegativeStock: false, expiryAlertDays: 30, lowStockAlerts: true, defaultLocationId: null }; }
  },
  async updateInventorySettings(input: InventorySettingsRecord): Promise<InventorySettingsRecord> {
    return api<InventorySettingsRecord>('/inventory/settings', { method: 'PUT', body: JSON.stringify(input) });
  },
  async getInventoryLocations(includeInactive = false): Promise<InventoryLocationRecord[]> {
    try { return await api<InventoryLocationRecord[]>(`/inventory/locations?includeInactive=${includeInactive ? 'true' : 'false'}`); }
    catch (error) { if (!canFallbackToLocal(error)) throw error; return []; }
  },
  async createInventoryLocation(input: Omit<InventoryLocationRecord, 'id' | 'productCount' | 'lotUnits' | 'label' | 'createdAt'>): Promise<InventoryLocationRecord> {
    return api<InventoryLocationRecord>('/inventory/locations', { method: 'POST', body: JSON.stringify(input) });
  },
  async updateInventoryLocation(id: string, input: Omit<InventoryLocationRecord, 'id' | 'productCount' | 'lotUnits' | 'label' | 'createdAt'>): Promise<InventoryLocationRecord> {
    return api<InventoryLocationRecord>(`/inventory/locations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
  },
  async deleteInventoryLocation(id: string): Promise<{ ok: boolean; id: string }> {
    return api<{ ok: boolean; id: string }>(`/inventory/locations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async getInventoryLots(filters?: { productId?: string; locationId?: string; status?: string; search?: string; includeEmpty?: boolean }): Promise<InventoryLotRecord[]> {
    const params = new URLSearchParams();
    if (filters?.productId) params.set('productId', filters.productId);
    if (filters?.locationId) params.set('locationId', filters.locationId);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.search) params.set('search', filters.search);
    if (filters?.includeEmpty) params.set('includeEmpty', 'true');
    try { return await api<InventoryLotRecord[]>(`/inventory/lots?${params.toString()}`); }
    catch (error) { if (!canFallbackToLocal(error)) throw error; return []; }
  },
  async lookupInventoryBarcode(code: string): Promise<{ products: Product[]; lots: InventoryLotRecord[] }> {
    return api<{ products: Product[]; lots: InventoryLotRecord[] }>(`/inventory/barcode/${encodeURIComponent(code)}`);
  },
  async createInventoryEntry(input: EntryInput): Promise<InventoryOperationRecord> {
    return api<InventoryOperationRecord>('/inventory/entries', { method: 'POST', body: JSON.stringify(input) });
  },
  async createInventoryExit(input: ExitInput): Promise<InventoryOperationRecord> {
    return api<InventoryOperationRecord>('/inventory/exits', { method: 'POST', body: JSON.stringify(input) });
  },
  async createInventoryWaste(input: WasteInput): Promise<InventoryOperationRecord> {
    return api<InventoryOperationRecord>('/inventory/waste', { method: 'POST', body: JSON.stringify(input) });
  },
  async createInventoryAdjustment(input: AdjustmentInput): Promise<InventoryOperationRecord> {
    return api<InventoryOperationRecord>('/inventory/adjustments', { method: 'POST', body: JSON.stringify(input) });
  },
  async getPurchaseOrders(filters?: { status?: string; supplierId?: string; search?: string }): Promise<PurchaseOrderRecord[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.supplierId) params.set('supplierId', filters.supplierId);
    if (filters?.search) params.set('search', filters.search);
    try { return await api<PurchaseOrderRecord[]>(`/inventory/purchase-orders?${params.toString()}`); }
    catch (error) { if (!canFallbackToLocal(error)) throw error; return []; }
  },
  async createPurchaseOrder(input: PurchaseOrderInput): Promise<PurchaseOrderRecord> {
    return api<PurchaseOrderRecord>('/inventory/purchase-orders', { method: 'POST', body: JSON.stringify(input) });
  },
  async approvePurchaseOrder(id: string): Promise<PurchaseOrderRecord> {
    return api<PurchaseOrderRecord>(`/inventory/purchase-orders/${encodeURIComponent(id)}/approve`, { method: 'POST' });
  },
  async sendPurchaseOrder(id: string): Promise<PurchaseOrderRecord> {
    return api<PurchaseOrderRecord>(`/inventory/purchase-orders/${encodeURIComponent(id)}/send`, { method: 'POST' });
  },
  async receivePurchaseOrder(id: string, input: ReceivePurchaseOrderInput): Promise<PurchaseOrderRecord> {
    return api<PurchaseOrderRecord>(`/inventory/purchase-orders/${encodeURIComponent(id)}/receive`, { method: 'POST', body: JSON.stringify(input) });
  },
  async cancelPurchaseOrder(id: string): Promise<PurchaseOrderRecord> {
    return api<PurchaseOrderRecord>(`/inventory/purchase-orders/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  },
  async getPhysicalCounts(limit = 50): Promise<PhysicalCountRecord[]> {
    try { return await api<PhysicalCountRecord[]>(`/inventory/counts?limit=${limit}`); }
    catch (error) { if (!canFallbackToLocal(error)) throw error; return []; }
  },
  async createPhysicalCount(input: { notes?: string; items: Array<{ productId: string; countedQuantity: number }> }): Promise<PhysicalCountRecord> {
    return api<PhysicalCountRecord>('/inventory/counts', { method: 'POST', body: JSON.stringify(input) });
  },
  async getTransfers(status?: string): Promise<TransferRecord[]> {
    const params = status ? `?status=${encodeURIComponent(status)}` : '';
    try { return await api<TransferRecord[]>(`/inventory/transfers${params}`); }
    catch (error) { if (!canFallbackToLocal(error)) throw error; return []; }
  },
  async createTransfer(input: { originLocationId: string; destinationLocationId: string; notes?: string; items: Array<{ productId: string; quantity: number; unit?: string; lotId?: string | null }> }): Promise<TransferRecord> {
    return api<TransferRecord>('/inventory/transfers', { method: 'POST', body: JSON.stringify(input) });
  },
  async sendTransfer(id: string): Promise<TransferRecord> {
    return api<TransferRecord>(`/inventory/transfers/${encodeURIComponent(id)}/send`, { method: 'POST' });
  },
  async receiveTransfer(id: string): Promise<TransferRecord> {
    return api<TransferRecord>(`/inventory/transfers/${encodeURIComponent(id)}/receive`, { method: 'POST' });
  },
  async cancelTransfer(id: string): Promise<TransferRecord> {
    return api<TransferRecord>(`/inventory/transfers/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  },
  async getPriceHistory(filters?: { productId?: string; supplierId?: string; limit?: number }): Promise<SupplierPriceHistoryRecord[]> {
    const params = new URLSearchParams();
    if (filters?.productId) params.set('productId', filters.productId);
    if (filters?.supplierId) params.set('supplierId', filters.supplierId);
    if (filters?.limit) params.set('limit', String(filters.limit));
    try { return await api<SupplierPriceHistoryRecord[]>(`/inventory/price-history?${params.toString()}`); }
    catch (error) { if (!canFallbackToLocal(error)) throw error; return []; }
  },
  async getInventoryReports(days = 30, noMovementDays = 60): Promise<InventoryReportsRecord> {
    try { return await api<InventoryReportsRecord>(`/inventory/reports?days=${days}&noMovementDays=${noMovementDays}`); }
    catch (error) { if (!canFallbackToLocal(error)) throw error; return { totalValue: 0, totalUnits: 0, productCount: 0, criticalStock: [], criticalStockCount: 0, expiringItems: [], expiringCount: 0, wasteCost: 0, wasteByReason: [], rotation: [], noMovement: [], countDifferences: [], periodDays: days, noMovementDays, generatedAt: new Date().toISOString() }; }
  },
  async getReplenishment(): Promise<Array<Product & { suggestedQuantity: number; lastCost: number; estimatedCost: number }>> {
    try { return await api<Array<Product & { suggestedQuantity: number; lastCost: number; estimatedCost: number }>>('/inventory/replenishment'); }
    catch (error) { if (!canFallbackToLocal(error)) throw error; return []; }
  },
  async getDishCosting(): Promise<DishCostingRecord[]> {
    try { return await api<DishCostingRecord[]>('/inventory/dish-costing'); }
    catch (error) { if (!canFallbackToLocal(error)) throw error; return []; }
  },
  async getSubstitutions(productId?: string): Promise<ProductSubstitutionRecord[]> {
    const params = productId ? `?productId=${encodeURIComponent(productId)}` : '';
    try { return await api<ProductSubstitutionRecord[]>(`/inventory/substitutions${params}`); }
    catch (error) { if (!canFallbackToLocal(error)) throw error; return []; }
  },
  async saveSubstitution(input: { productId: string; substituteId: string; priority?: number; notes?: string }): Promise<{ ok: boolean }> {
    return api<{ ok: boolean }>('/inventory/substitutions', { method: 'POST', body: JSON.stringify(input) });
  },
  async deleteSubstitution(productId: string, substituteId: string): Promise<void> {
    await api(`/inventory/substitutions/${encodeURIComponent(productId)}/${encodeURIComponent(substituteId)}`, { method: 'DELETE' });
  },
  async getAuditLog(limit = 300): Promise<AuditLogRecord[]> {
    try {
      const rows = await api<AuditLogRecord[]>(`/audit?limit=${Math.min(500, limit)}`);
      return rows;
    } catch (error) {
      if (!canFallbackToLocal(error)) throw error;
      return [];
    }
  },
  async getDashboard() {
    try { return await api<{salesToday: number; revenueToday: number; revenueLast7Days: number; activeProducts: number; lowStockProducts: number}>('/dashboard'); }
    catch (error) {
      if (!canFallbackToLocal(error)) throw error;
      const db = readLocal(); const today = colombiaDateKey();
      const todays = db.sales.filter(s => colombiaDateKey(new Date(s.date)) === today && s.status === 'completed');
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return { salesToday: todays.length, revenueToday: money(todays.reduce((sum, s) => sum + s.totalPrice, 0)), revenueLast7Days: money(db.sales.filter(s => new Date(s.date).getTime() >= sevenDaysAgo && s.status === 'completed').reduce((sum, s) => sum + s.totalPrice, 0)), activeProducts: db.products.filter(p => p.productType !== 'ingredient' && p.productType !== 'supplies').length, lowStockProducts: db.products.filter(p => p.stock <= p.minStock).length };
    }
  },
};
