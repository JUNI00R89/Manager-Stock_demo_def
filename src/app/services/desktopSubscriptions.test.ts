import { beforeEach, describe, expect, it } from 'vitest';
import { desktop } from './desktop';
import type { BusinessSubscriptionRecord } from './dataService';

// El modo escritorio replica las reglas de backend/services/subscriptions.py.
const KEY = 'manager_stock_desktop_subscription_v1:NEG-1';
const DAY = 24 * 60 * 60 * 1000;
const BUSINESS = { id: 'business', name: 'Negocio', priceCOP: 79900, maxUsers: 10, maxProducts: 5000 } as const;
const FREE = { id: 'free', name: 'Gratis', priceCOP: 0, maxUsers: 1, maxProducts: 100 } as const;

function save(record: Partial<BusinessSubscriptionRecord>) {
  const base: BusinessSubscriptionRecord = {
    businessId: 'NEG-1',
    plan: { ...FREE },
    status: 'active',
    pendingPlan: null,
    startedAt: null,
    expiresAt: null,
    updatedAt: null,
  };
  localStorage.setItem(KEY, JSON.stringify({ ...base, ...record }));
}

const near = (actual: string | null, expected: number) => Math.abs(Date.parse(actual ?? '') - expected) < 5000;

beforeEach(() => localStorage.clear());

describe('suscripciones en modo escritorio', () => {
  it('el pago del mes se suma al vencimiento del mismo plan vigente', async () => {
    const expiry = Date.now() + 10 * DAY;
    save({ plan: { ...BUSINESS }, expiresAt: new Date(expiry).toISOString() });
    const renewed = await desktop.platform.updateSubscription('NEG-1', 'renew', 'MP-1');
    expect(renewed.plan.id).toBe('business');
    expect(near(renewed.expiresAt, expiry + 30 * DAY)).toBe(true);
  });

  it('rechaza una referencia repetida sin cambiar la vigencia', async () => {
    save({ plan: { ...BUSINESS }, expiresAt: new Date(Date.now() + 5 * DAY).toISOString() });
    const first = await desktop.platform.updateSubscription('NEG-1', 'renew', 'MP-2');
    await expect(desktop.platform.updateSubscription('NEG-1', 'renew', 'MP-2')).rejects.toThrow(/ya se registró/);
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').expiresAt).toBe(first.expiresAt);
  });

  it('si vence con una renovación pendiente pasa a Gratis y conserva la solicitud', async () => {
    save({
      plan: { ...BUSINESS },
      status: 'pending_payment',
      pendingPlan: { ...BUSINESS },
      expiresAt: new Date(Date.now() - DAY).toISOString(),
    });
    const lapsed = await desktop.platform.updateSubscription('NEG-1', 'confirm_payment', 'MP-3');
    expect(lapsed.plan.id).toBe('business');
    expect(near(lapsed.expiresAt, Date.now() + 30 * DAY)).toBe(true);
  });

  it('pide el plan cuando el negocio nunca pagó', async () => {
    save({});
    await expect(desktop.platform.updateSubscription('NEG-1', 'renew', 'MP-4')).rejects.toThrow(/Indica el plan/);
    const renewed = await desktop.platform.updateSubscription('NEG-1', 'renew', 'MP-4', 'business');
    expect(renewed.plan.id).toBe('business');
  });
});
