import { api, authService, dataService } from './dataService';
import { isDesktopMode } from './desktop';
import { canPerformAction } from '../security/permissions';

export interface Customer {
  id: string; name: string; documentType: 'CC' | 'NIT' | 'CE' | 'TI' | 'PP' | 'FOREIGN';
  documentNumber: string; email: string; phone: string; address: string; municipalityCode: string;
  personType: 'natural' | 'legal'; taxResponsibilities: string; active: boolean; revision: number;
}
export const emptyCustomer: Omit<Customer, 'id'> = { name: '', documentType: 'CC', documentNumber: '', email: '', phone: '', address: '', municipalityCode: '', personType: 'natural', taxResponsibilities: '', active: true, revision: 1 };

async function localCustomers(write = false) {
  const user = await authService.me();
  if (!user.businessId || !canPerformAction(user, write ? 'customers.manage' : 'customers.view')) throw new Error('No tienes permiso para administrar clientes.');
  const key = `manager_stock_customers:${user.businessId}`;
  const read = (): Customer[] => JSON.parse(localStorage.getItem(key) || '[]');
  return { key, read };
}

export async function listCustomers(search = '', includeInactive = false, offset = 0): Promise<Customer[]> {
  if (!isDesktopMode()) return api(`/customers?search=${encodeURIComponent(search)}&include_inactive=${includeInactive}&offset=${offset}`);
  const { read } = await localCustomers();
  const term = search.trim().toLocaleLowerCase();
  return read().filter(c => (includeInactive || c.active) && [c.name, c.documentNumber, c.phone, c.email].some(v => v.toLocaleLowerCase().includes(term)))
    .sort((a, b) => a.name.localeCompare(b.name)).slice(offset, offset + 100);
}

export async function saveCustomer(input: Omit<Customer, 'id'> & { id?: string }): Promise<Customer> {
  if (!isDesktopMode()) return api(`/customers${input.id ? '/' + encodeURIComponent(input.id) : ''}`, { method: input.id ? 'PUT' : 'POST', body: JSON.stringify(input) });
  const { key, read } = await localCustomers(true);
  const save = () => {
    const list = read();
    const normalized = { ...input, name: input.name.trim().replace(/\s+/g, ' '), documentNumber: input.documentNumber.trim().toUpperCase(), email: input.email.trim().toLowerCase() };
    if (normalized.name.length < 2 || normalized.name.length > 120) throw new Error('Ingresa un nombre de entre 2 y 120 caracteres.');
    if (normalized.documentNumber && !/^[A-Z0-9-]{1,30}$/.test(normalized.documentNumber)) throw new Error('Documento inválido; usa números y letras sin puntos ni espacios.');
    if (normalized.documentType === 'NIT' && normalized.documentNumber && !/^\d{1,15}$/.test(normalized.documentNumber)) throw new Error('Ingresa el NIT sin dígito de verificación.');
    if (normalized.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) throw new Error('Correo inválido.');
    if (normalized.municipalityCode && !/^\d{5}$/.test(normalized.municipalityCode)) throw new Error('El código de municipio debe tener cinco dígitos.');
    if (list.some(c => c.id !== input.id && normalized.documentNumber && c.documentType === input.documentType && c.documentNumber === normalized.documentNumber)) throw new Error('Ya existe un cliente con ese documento.');
    const old = list.find(c => c.id === input.id);
    if (input.id && (!old || old.revision !== input.revision)) throw new Error('El cliente cambió. Actualiza antes de guardar.');
    const customer: Customer = { ...normalized, id: input.id || `CLI-${crypto.randomUUID()}`, revision: (old?.revision ?? 1) + 1 };
    localStorage.setItem(key, JSON.stringify([customer, ...list.filter(c => c.id !== customer.id)]));
    return customer;
  };
  return navigator.locks ? navigator.locks.request(key, save) : save();
}

export async function customerHistory(id: string) {
  if (!isDesktopMode()) return api<{ sales: Awaited<ReturnType<typeof dataService.getSales>> }>(`/customers/${encodeURIComponent(id)}/history`);
  const { read } = await localCustomers();
  if (!read().some(c => c.id === id)) throw new Error('Cliente no encontrado.');
  const user = await authService.me();
  if (!canPerformAction(user, 'sales.view')) return { sales: [] };
  return { sales: (await dataService.getSales()).filter(s => s.customerId === id).slice(0, 100) };
}

export interface BillingProfile {
  legalName: string; nit: string; address: string; municipalityCode: string; taxResponsibilities: string;
  provider: 'undecided' | 'factus' | 'alegra' | 'siigo'; revision: number;
}
export interface BillingDraft {
  id: string; sourceType: 'sale' | 'hotel'; sourceId: string; createdAt: string; snapshotHash: string;
  snapshot: { customer: Customer; pendingChecks: string[]; notice: string; operation: unknown };
}
export const billingService = {
  profile: () => api<BillingProfile>('/billing/profile'),
  saveProfile: (input: BillingProfile) => api<BillingProfile>('/billing/profile', { method: 'PUT', body: JSON.stringify(input) }),
  drafts: () => api<BillingDraft[]>('/billing/drafts'),
  prepare: (sourceType: 'sale' | 'hotel', sourceId: string, customerId: string) => api<BillingDraft>('/billing/drafts', { method: 'POST', body: JSON.stringify({ sourceType, sourceId, customerId }) }),
};
