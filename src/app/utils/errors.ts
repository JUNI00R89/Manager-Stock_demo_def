const NETWORK_MESSAGES = [
  'failed to fetch',
  'networkerror when attempting to fetch resource',
  'load failed',
  'network request failed',
];

function normalizeMessage(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function messageFromDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail.trim();
  if (Array.isArray(detail)) {
    return detail.map(item => {
      if (typeof item === 'string') return item.trim();
      if (!item || typeof item !== 'object') return '';
      const record = item as Record<string, unknown>;
      const field = Array.isArray(record.loc)
        ? record.loc.filter(part => part !== 'body' && part !== 'query' && part !== 'path').join('.')
        : '';
      const message = normalizeMessage(record.msg) || normalizeMessage(record.message) || normalizeMessage(record.detail);
      return field && message ? `${field}: ${message}` : message;
    }).filter(Boolean).join('; ');
  }
  if (detail && typeof detail === 'object') {
    const record = detail as Record<string, unknown>;
    const message = normalizeMessage(record.message) || normalizeMessage(record.detail) || normalizeMessage(record.error);
    if (message) return message;
    try { return JSON.stringify(detail); } catch { return ''; }
  }
  return '';
}

export function getErrorMessage(error: unknown, fallback = 'Ocurrió un error inesperado.'): string {
  if (error instanceof Error) {
    const message = normalizeMessage(error.message);
    const lowered = message.toLowerCase();
    if (NETWORK_MESSAGES.some(item => lowered.includes(item))) {
      return 'No se pudo conectar con el servidor. Revisa la conexión e intenta de nuevo.';
    }
    if (message) return message;
    return fallback;
  }
  if (typeof error === 'string') {
    return error.trim() || fallback;
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const message = normalizeMessage(record.detail)
      || normalizeMessage(record.message)
      || normalizeMessage(record.error)
      || normalizeMessage(record.msg)
      || messageFromDetail(record.detail);
    if (message) return message;
  }
  return fallback;
}

export function getErrorDescription(error: unknown): string {
  if (error instanceof Error) {
    const message = normalizeMessage(error.message);
    if (!message) return '';
    if (NETWORK_MESSAGES.some(item => message.toLowerCase().includes(item))) {
      return getErrorMessage(error);
    }
    return message;
  }
  return getErrorMessage(error, '');
}
