import { toast } from 'sonner';
import { getErrorMessage } from './errors';

/**
 * Muestra un error con un título estable y, debajo, la razón concreta.
 * Así el usuario sabe qué falló sin perder el contexto de la operación.
 */
export function toastError(error: unknown, fallback: string) {
  const reason = getErrorMessage(error, fallback);
  if (!reason) {
    toast.error(fallback);
    return;
  }
  if (reason === fallback) {
    toast.error(fallback);
    return;
  }
  toast.error(fallback, { description: reason, duration: 7000 });
}
