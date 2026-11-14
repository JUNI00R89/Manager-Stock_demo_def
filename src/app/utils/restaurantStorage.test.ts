import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createScopedLocalStore, normalizeScope, readJson, uniqueRestaurantId } from './restaurantStorage';

beforeEach(() => {
  localStorage.clear();
});

describe('normalizeScope', () => {
  it('normaliza caracteres no seguros', () => {
    expect(normalizeScope('Mi Negocio!')).toBe('Mi_Negocio_');
    expect(normalizeScope('tienda-aurora')).toBe('tienda-aurora');
    expect(normalizeScope('a/b')).toBe('a_b');
  });

  it('usa default cuando el valor está vacío', () => {
    expect(normalizeScope('')).toBe('default');
    expect(normalizeScope('   ')).toBe('default');
    expect(normalizeScope(null)).toBe('default');
    expect(normalizeScope(undefined)).toBe('default');
  });
});

describe('readJson', () => {
  it('parsea JSON válido', () => {
    expect(readJson('{"a":1}', {})).toEqual({ a: 1 });
  });

  it('devuelve el fallback si el JSON es inválido o no hay datos', () => {
    expect(readJson('{invalid', { ok: true })).toEqual({ ok: true });
    expect(readJson(null, { ok: true })).toEqual({ ok: true });
  });
});

describe('uniqueRestaurantId', () => {
  it('genera ids con prefijo y unicidad', () => {
    const first = uniqueRestaurantId('mesa');
    const second = uniqueRestaurantId('mesa');

    expect(first.startsWith('mesa-')).toBe(true);
    expect(second.startsWith('mesa-')).toBe(true);
    expect(first).not.toBe(second);
  });
});

describe('createScopedLocalStore', () => {
  it('guarda por ámbito y notifica cambios', () => {
    const store = createScopedLocalStore('test_store_', () => ({ count: 0 }));
    const listener = vi.fn();
    const unsubscribe = store.subscribe('negocio-a', listener);

    expect(store.get('negocio-a')).toEqual({ count: 0 });
    expect(store.get('negocio-b')).toEqual({ count: 0 });

    store.set('negocio-a', { count: 5 });
    expect(store.get('negocio-a')).toEqual({ count: 5 });
    expect(store.get('negocio-b')).toEqual({ count: 0 });
    expect(listener).toHaveBeenCalledTimes(1);

    store.update('negocio-a', current => ({ count: current.count + 1 }));
    expect(store.get('negocio-a')).toEqual({ count: 6 });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    store.set('negocio-a', { count: 9 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('persiste en localStorage y permite reiniciar', () => {
    const store = createScopedLocalStore('test_reset_', () => ({ count: 0 }));

    store.set('a', { count: 3 });
    expect(localStorage.getItem('test_reset_a')).toBe('{"count":3}');

    store.reset('a');
    expect(localStorage.getItem('test_reset_a')).toBeNull();
    expect(store.get('a')).toEqual({ count: 0 });
  });

  it('aplica el normalizador al leer datos existentes', () => {
    localStorage.setItem('test_normalize_a', JSON.stringify({ count: '7' }));
    const store = createScopedLocalStore(
      'test_normalize_',
      () => ({ count: 0 }),
      value => {
        const record = value as { count?: unknown };
        return { count: Number(record?.count) || 0 };
      },
    );

    expect(store.get('a')).toEqual({ count: 7 });
  });
});
