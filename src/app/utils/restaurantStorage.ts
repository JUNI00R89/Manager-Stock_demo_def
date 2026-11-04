import { useSyncExternalStore } from 'react';

/**
 * Pequeño almacén local con ámbito por negocio.
 *
 * La fase 1 del flujo de restaurante vive en localStorage para que las tres
 * pestañas (mesero, cocina y administración) funcionen sin backend adicional.
 * La clave siempre incluye el negocio: dos empresas en el mismo navegador nunca
 * comparten mesas, personal ni pedidos.
 */

type Listener = () => void;

export interface ScopedLocalStore<T> {
  key: (scope: string) => string;
  get: (scope: string) => T;
  set: (scope: string, value: T) => T;
  update: (scope: string, updater: (current: T) => T) => T;
  subscribe: (scope: string, listener: Listener) => () => void;
  reset: (scope: string) => void;
}

interface CacheEntry<T> {
  raw: string | null;
  value: T;
}

export function normalizeScope(value: string | null | undefined): string {
  const scope = (value || 'default').trim();
  return scope.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
}

export function readJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function uniqueRestaurantId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

export function createScopedLocalStore<T>(
  prefix: string,
  createDefault: () => T,
  normalize?: (value: unknown) => T,
): ScopedLocalStore<T> {
  const cache = new Map<string, CacheEntry<T>>();
  const listeners = new Map<string, Set<Listener>>();
  const key = (scope: string) => `${prefix}${normalizeScope(scope)}`;

  const get = (scope: string): T => {
    const storageKey = key(scope);
    let raw: string | null = null;
    try {
      raw = typeof window === 'undefined' ? null : window.localStorage.getItem(storageKey);
    } catch {
      raw = null;
    }
    const cached = cache.get(scope);
    if (cached && cached.raw === raw) return cached.value;
    let value: T;
    if (raw === null) {
      value = createDefault();
    } else {
      const parsed = readJson<unknown>(raw, null);
      value = normalize ? normalize(parsed) : (parsed as T);
    }
    cache.set(scope, { raw, value });
    return value;
  };

  const emit = (scope: string) => {
    const set = listeners.get(scope);
    if (!set) return;
    set.forEach((listener) => {
      try {
        listener();
      } catch {
        // Un componente desmontado no debe romper la sincronización de los demás.
      }
    });
  };

  const set = (scope: string, value: T): T => {
    const storageKey = key(scope);
    const raw = JSON.stringify(value);
    try {
      window.localStorage.setItem(storageKey, raw);
    } catch {
      // Si el navegador está sin espacio, la vista sigue funcionando en memoria.
    }
    cache.set(scope, { raw, value });
    emit(scope);
    return value;
  };

  const update = (scope: string, updater: (current: T) => T): T => {
    return set(scope, updater(get(scope)));
  };

  const subscribe = (scope: string, listener: Listener) => {
    let setForScope = listeners.get(scope);
    if (!setForScope) {
      setForScope = new Set();
      listeners.set(scope, setForScope);
    }
    setForScope.add(listener);
    return () => {
      setForScope?.delete(listener);
      if (setForScope && setForScope.size === 0) listeners.delete(scope);
    };
  };

  const reset = (scope: string) => {
    try {
      window.localStorage.removeItem(key(scope));
    } catch {
      // Sin almacenamiento disponible, basta con invalidar la caché.
    }
    cache.delete(scope);
    emit(scope);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (!event.key || !event.key.startsWith(prefix)) return;
      cache.clear();
      const scopes = new Set<string>(listeners.keys());
      if (event.key) {
        for (const scope of scopes) {
          if (key(scope) === event.key) {
            emit(scope);
            return;
          }
        }
      }
      scopes.forEach(emit);
    });
  }

  return { key, get, set, update, subscribe, reset };
}

export function useScopedLocalStore<T>(store: ScopedLocalStore<T>, scope: string): T {
  return useSyncExternalStore(
    (listener) => store.subscribe(scope, listener),
    () => store.get(scope),
    () => store.get(scope),
  );
}
