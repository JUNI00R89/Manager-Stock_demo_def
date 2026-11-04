import { useAuth } from '../context/AuthContext';
import { useBusiness } from '../context/BusinessContext';
import { normalizeScope } from './restaurantStorage';

/**
 * Identificador estable del negocio para todos los datos del flujo de
 * restaurante. Se prefiere el id de configuración y, si no viene, el id de la
 * cuenta autenticada.
 */
export function useRestaurantScope(): string {
  const { config } = useBusiness();
  const { user } = useAuth();
  return normalizeScope(config?.id || user?.businessId || config?.name || 'default');
}

export function useRestaurantCurrency(): string {
  const { config } = useBusiness();
  return config?.currency || 'COP';
}
