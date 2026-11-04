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

export function useRestaurantTables() {
  const [tables, setTables] = useState<RestaurantTableRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await dataService.getTables();
      setTables(rows.slice().sort((a, b) => a.number - b.number));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudieron cargar las mesas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    dataService.getTables()
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
  }, [refresh]);

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
