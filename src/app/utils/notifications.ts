import { toast } from 'sonner';
import { getErrorMessage } from './errors';

/** Los errores permanecen más tiempo en pantalla para que se puedan leer. */
export const ERROR_TOAST_DURATION = 12000;

/** Longitud máxima del título; el resto del texto pasa al detalle. */
const MAX_TITLE_LENGTH = 72;

/**
 * Separa un mensaje largo en un título corto y el resto como detalle.
 * Así la notificación se lee de un vistazo sin perder información.
 */
function splitMessage(text: string): { title: string; detail: string } {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean.length <= MAX_TITLE_LENGTH) return { title: clean, detail: '' };

  // Preferimos cortar en el primer punto: deja un título natural.
  const sentence = clean.match(new RegExp(`^(.{1,${MAX_TITLE_LENGTH}}?[.!?])(?:\\s+|$)`));
  if (sentence) return { title: sentence[1], detail: clean.slice(sentence[1].length).trim() };

  // Sin puntuación útil: cortamos en la última palabra completa.
  const slice = clean.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > 20 ? slice.slice(0, lastSpace) : slice;
  const title = `${cut.replace(/[\s.,;:]+$/, '')}…`;
  return { title, detail: clean.slice(cut.length).trim() };
}

/**
 * Muestra un error con un título corto y, debajo, la razón concreta.
 * El detalle del servidor tiene prioridad sobre el texto genérico; si no hay
 * detalle, se muestra el resto del mensaje original para no perder contexto.
 */
export function toastError(error: unknown, fallback: string) {
  const reason = getErrorMessage(error, fallback);
  const fullFallback = fallback.trim();
  const { title, detail } = splitMessage(fullFallback || 'Ocurrió un error inesperado.');
  const description = reason && reason !== fullFallback ? reason : detail;
  const options = { duration: ERROR_TOAST_DURATION } as const;

  if (!description) {
    toast.error(title, options);
    return;
  }
  toast.error(title, { description, duration: ERROR_TOAST_DURATION });
}
