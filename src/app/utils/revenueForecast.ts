import { colombiaDateKey } from '../services/dataService';

/**
 * Modelo de proyección de ingresos: tendencia lineal sobre la serie
 * desestacionalizada × índice de estacionalidad semanal (con contracción)
 * y banda de incertidumbre normal.
 *
 * Es el mismo enfoque que scripts/forecast_revenue_occupancy.py, portado a TS
 * para calcular la proyección con las ventas ya cargadas en el cliente (sin
 * peticiones adicionales). No sustituye una medición contable: es una
 * estimación de demanda.
 */

const DAY_MS = 86_400_000;
export const WEEKDAY_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

export interface ForecastSale {
  date: string;
  totalPrice: number;
  status: string;
}

export interface DailyRevenue {
  key: string;
  revenue: number;
}

export interface ProjectionPoint extends DailyRevenue {
  low: number;
  high: number;
}

export interface RevenueProjection {
  historyDays: number;
  horizon: number;
  points: ProjectionPoint[];
  lastWeekTotal: number;
  weekTotal: number;
  monthTotal: number;
  monthLow: number;
  monthHigh: number;
  weekdayAverages: number[];
  lowWeekdays: number[];
  highWeekdays: number[];
  slope: number;
  sigma: number;
  reliable: boolean;
}

export interface OccupancyEstimate {
  rooms: number;
  adr: number;
  capacityPerDay: number;
  occupancyPct: number;
  revpar: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const average = (values: number[]) => (values.length ? sum(values) / values.length : 0);

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * DAY_MS);
}

/** Día de la semana (0=domingo) de una clave yyyy-mm-dd, sin depender de la zona del equipo. */
export function weekdayOfKey(key: string): number {
  return new Date(`${key}T12:00:00`).getDay();
}

export function dayOfMonthOfKey(key: string): number {
  return Number(key.slice(8, 10));
}

/** Ingreso diario de los últimos días, alineado a la fecha local de Colombia. */
export function dailyRevenue(sales: ForecastSale[], days: number, now: Date = new Date()): DailyRevenue[] {
  const byDay = new Map<string, number>();
  for (const sale of sales) {
    if (sale.status !== 'completed') continue;
    const key = colombiaDateKey(new Date(sale.date));
    byDay.set(key, (byDay.get(key) ?? 0) + sale.totalPrice);
  }
  return Array.from({ length: days }, (_, index) => {
    const key = colombiaDateKey(addDays(now, -(days - 1 - index)));
    return { key, revenue: byDay.get(key) ?? 0 };
  });
}

export function buildRevenueProjection(
  sales: ForecastSale[],
  historyDays = 90,
  horizon = 30,
  now: Date = new Date(),
): RevenueProjection | null {
  const byDay = new Map<string, number>();
  for (const sale of sales) {
    if (sale.status !== 'completed' || !Number.isFinite(sale.totalPrice)) continue;
    const key = colombiaDateKey(new Date(sale.date));
    byDay.set(key, (byDay.get(key) ?? 0) + sale.totalPrice);
  }

  // Entrenamiento: último día completo = ayer (hoy suele estar incompleto).
  const training: DailyRevenue[] = Array.from({ length: historyDays }, (_, index) => {
    const key = colombiaDateKey(addDays(now, -(historyDays - index)));
    return { key, revenue: byDay.get(key) ?? 0 };
  });
  const values = training.map(point => point.revenue);
  if (values.filter(value => value > 0).length < 5) return null;

  const mean = average(values);
  const sums = Array(7).fill(0);
  const counts = Array(7).fill(0);
  for (const point of training) {
    const weekday = weekdayOfKey(point.key);
    sums[weekday] += point.revenue;
    counts[weekday] += 1;
  }
  // Contracción del 50 % hacia 1 y recorte: una semana atípica no debe dominar.
  const seasonal = Array.from({ length: 7 }, (_, weekday) => {
    if (!counts[weekday] || !mean) return 1;
    const raw = sums[weekday] / counts[weekday] / mean;
    return clamp(1 + (raw - 1) * 0.5, 0.4, 1.8);
  });

  const deseasonalized = training.map(point => point.revenue / seasonal[weekdayOfKey(point.key)]);
  const n = deseasonalized.length;
  const meanX = (n - 1) / 2;
  const meanY = average(deseasonalized);
  let numerator = 0;
  let denominator = 0;
  for (let x = 0; x < n; x += 1) {
    numerator += (x - meanX) * (deseasonalized[x] - meanY);
    denominator += (x - meanX) ** 2;
  }
  const slope = denominator ? numerator / denominator : 0;
  const intercept = meanY - slope * meanX;

  const fitted = training.map((point, x) => (intercept + slope * x) * seasonal[weekdayOfKey(point.key)]);
  const residuals = values.map((value, x) => clamp(value - fitted[x], -3 * mean, 3 * mean));
  const residualMean = average(residuals);
  const sigma = Math.sqrt(average(residuals.map(residual => (residual - residualMean) ** 2)));

  const points: ProjectionPoint[] = Array.from({ length: horizon }, (_, index) => {
    const key = colombiaDateKey(addDays(now, index + 1));
    const base = Math.max(intercept + slope * (n - 1 + index + 1), mean * 0.2);
    const revenue = Math.max(0, base * seasonal[weekdayOfKey(key)]);
    const band = 1.2816 * sigma; // intervalo central del 80 %
    return { key, revenue, low: Math.max(0, revenue - band), high: revenue + band };
  });

  const monthDays = Math.min(30, horizon);
  const monthTotal = sum(points.slice(0, monthDays).map(point => point.revenue));
  const monthBand = 1.2816 * sigma * Math.sqrt(monthDays);
  const weekdayAverages = sums.map((total, weekday) => (counts[weekday] ? total / counts[weekday] : 0));
  const ranked = Array.from({ length: 7 }, (_, weekday) => weekday)
    .sort((a, b) => seasonal[a] - seasonal[b]);

  return {
    historyDays,
    horizon,
    points,
    lastWeekTotal: sum(values.slice(-7)),
    weekTotal: sum(points.slice(0, Math.min(7, horizon)).map(point => point.revenue)),
    monthTotal,
    monthLow: Math.max(0, monthTotal - monthBand),
    monthHigh: monthTotal + monthBand,
    weekdayAverages,
    lowWeekdays: ranked.slice(0, 2),
    highWeekdays: ranked.slice(-2).reverse(),
    slope,
    sigma,
    reliable: values.filter(value => value > 0).length >= 14,
  };
}

/**
 * Ocupación estimada a partir del ingreso proyectado y la tarifa media (ADR).
 * Es un proxy de demanda: el POS no registra la tarifa por noche.
 */
export function estimateOccupancy(
  points: ProjectionPoint[],
  rooms: { pricePerNight: number }[],
  days = 30,
): OccupancyEstimate | null {
  const validRooms = rooms.filter(room => Number.isFinite(room.pricePerNight) && room.pricePerNight > 0);
  if (!validRooms.length || !points.length) return null;
  const adr = average(validRooms.map(room => room.pricePerNight));
  const capacityPerDay = adr * validRooms.length;
  const span = Math.min(days, points.length);
  const revenue = sum(points.slice(0, span).map(point => point.revenue));
  const occupancyPct = capacityPerDay ? clamp((revenue / (capacityPerDay * span)) * 100, 0, 100) : 0;
  return {
    rooms: validRooms.length,
    adr,
    capacityPerDay,
    occupancyPct,
    revpar: capacityPerDay ? revenue / (validRooms.length * span) : 0,
  };
}
