import { useCallback, useEffect, useState } from 'react';
import { dataService, type RestaurantTableRecord } from '../services/dataService';
import type { Pedido } from './restaurantTypes';
import { getPedidosRepository } from './restaurantPedidosRepository';

export function useRestaurantOrders(scope: string) {
  const [orders, setOrders] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const repository = getPedidosRepository();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const unsubscribe = repository.suscribirse(scope, (rows) => {
      if (!active) return;
      setOrders(rows);
      setLoading(false);
    });
    repository.listar(scope)
      .then((rows) => {
        if (active) {
          setOrders(rows);
          setLoading(false);
        }
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : 'No se pudieron cargar los pedidos.');
        setLoading(false);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [scope, repository]);

  return { orders, loading, error, repository };
}

import { useRestaurantBusinessId } from './restaurantScope';
import { firebaseDb, ensureFirebaseSignedIn } from './firebaseClient';
import { collection, onSnapshot, query } from 'firebase/firestore';

export function useRestaurantTables() {
  const businessId = useRestaurantBusinessId();
  const [tables, setTables] = useState<RestaurantTableRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (import.meta.env.VITE_RESTAURANT_BACKEND !== 'firebase') {
      try {
        const rows = await dataService.getTables();
        setTables(rows.slice().sort((a, b) => a.number - b.number));
        setError(null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'No se pudieron cargar las mesas.');
      } finally {
        setLoading(false);
      }
      return;
    }
    // Firebase: las mesas viven en Firestore.
    try {
      await ensureFirebaseSignedIn();
      // La suscripción se gestiona en el efecto; refresh solo fuerza un re-render.
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudieron cargar las mesas.');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    if (import.meta.env.VITE_RESTAURANT_BACKEND !== 'firebase') {
      let active = true;
      dataService
        .getTables()
        .then((rows) => {
          if (!active) return;
          setTables(rows.slice().sort((a, b) => a.number - b.number));
          setLoading(false);
        })
        .catch((reason) => {
          if (!active) return;
          setError(reason instanceof Error ? reason.message : 'No se pudieron cargar las mesas.');
          setLoading(false);
        });
      const onFocus = () => { refresh(); };
      window.addEventListener('focus', onFocus);
      return () => {
        active = false;
        window.removeEventListener('focus', onFocus);
      };
    }

    // Firebase mode
    let active = true;
    let unsubscribe = () => {};
    setLoading(true);
    ensureFirebaseSignedIn()
      .then(() => {
        if (!active) return;
        const q = query(collection(firebaseDb, `businesses/${businessId}/tables`));
        const unsub = onSnapshot(
          q,
          (snap) => {
            if (!active) return;
            const rows = snap.docs.map((d) => {
              const data = d.data() as Record<string, unknown>;
              return {
                id: d.id,
                number: Number(data.number || 0),
                zone: String(data.zone || ''),
                capacity: Number(data.capacity || 4),
                status: (data.status === 'inactive' ? 'inactive' : 'active') as 'active' | 'inactive',
                openOrders: 0,
                openTotal: 0,
                waiter: '',
                since: null,
              } as RestaurantTableRecord;
            });
            setTables(rows.slice().sort((a, b) => a.number - b.number));
            setLoading(false);
            setError(null);
          },
          (err) => {
            if (!active) return;
            setError(err instanceof Error ? err.message : 'No se pudieron cargar las mesas.');
            setLoading(false);
          },
        );
        unsubscribe = unsub;
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : 'No se pudieron cargar las mesas.');
        setLoading(false);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [businessId, refresh]);

  return { tables, loading, error, refresh };
}

export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
