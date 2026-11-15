const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

export function formatMoney(value: number, currency = 'COP'): string {
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(Number.isFinite(value) ? value : 0);
  } catch {
    return `$${Math.round(Number.isFinite(value) ? value : 0).toLocaleString('es-CO')}`;
  }
}

/** Lowercase without accents, so "cafe" finds "Café". */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function formatTime(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

export function formatDayMonth(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return `${WEEKDAYS[date.getDay()]} ${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function parseTimeToMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return 6 * 60;
  const hours = Math.max(0, Math.min(23, Number(match[1])));
  const minutes = Math.max(0, Math.min(59, Number(match[2])));
  return hours * 60 + minutes;
}

export function formatMinutesAsTime(totalMinutes: number): string {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

/**
 * Clave de jornada: si la jornada inicia a las 06:00, las 05:30 del martes
 * todavía pertenecen al lunes. Así la numeración reinicia a la hora configurada
 * y no a medianoche.
 */
export function getJornadaKey(date: Date, startTime: string): string {
  const startMinutes = parseTimeToMinutes(startTime);
  const shifted = new Date(date.getTime() - startMinutes * 60_000);
  const year = shifted.getFullYear();
  const month = String(shifted.getMonth() + 1).padStart(2, '0');
  const day = String(shifted.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function jornadaDateFromKey(key: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
}

export function formatJornadaTitle(jornadaKey: string, startTime: string): string {
  const date = jornadaDateFromKey(jornadaKey);
  const start = parseTimeToMinutes(startTime);
  const end = (start + 24 * 60 - 1) % (24 * 60);
  return `Jornada del ${formatDayMonth(date)} · ${formatMinutesAsTime(start)} a ${formatMinutesAsTime(end)}`;
}

export function minutesSince(value: string | undefined, now = new Date()): number {
  if (!value) return 0;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
}

export function formatElapsed(value: string | undefined, now = new Date()): string {
  if (!value) return '';
  const minutes = minutesSince(value, now);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `hace ${hours} h ${minutes % 60 ? `${minutes % 60} min` : ''}`.trim();
}

export function formatReadyElapsed(value: string | undefined, now = new Date()): string {
  if (!value) return 'Listo';
  const minutes = minutesSince(value, now);
  if (minutes < 1) return 'Listo ahora';
  if (minutes < 60) return `Listo hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `Listo hace ${hours} h`;
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function orderItemSummary(totalItems: number): string {
  return totalItems === 1 ? '1 producto' : `${totalItems} productos`;
}
