import { colombiaDateKey } from '../services/dataService';
import type { SaleRecord } from '../services/dataService';
import type { Product } from './mockData';

/**
 * Ciencia de datos comercial para el inventario:
 *
 * 1. Market basket analysis (reglas de asociación: soporte, confianza y lift)
 *    para saber qué productos se venden juntos.
 * 2. Recomendador híbrido: historial de canastas + afinidad de categoría.
 * 3. Factibilidad de combos con el stock actual (cuántos combos completos salen
 *    y qué producto es el limitante).
 * 4. Clasificación ABC/XYZ, stock de seguridad (nivel de servicio 95 %) y
 *    lote económico de pedido (EOQ).
 */

const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ */
/* Estadísticas de canasta                                            */
/* ------------------------------------------------------------------ */

export interface SalesWindowStats {
  baskets: number;
  singles: Map<string, number>;
  pairs: Map<string, number>;
  units: Map<string, number>;
  revenue: Map<string, number>;
  daily: Map<string, number[]>;
  windowDays: number;
}

export function salesWindowStats(sales: SaleRecord[], windowDays = 30): SalesWindowStats {
  const cutoffKey = colombiaDateKey(new Date(Date.now() - windowDays * DAY_MS));
  const cutoffTime = Date.parse(`${cutoffKey}T00:00:00Z`);
  const singles = new Map<string, number>();
  const pairs = new Map<string, number>();
  const units = new Map<string, number>();
  const revenue = new Map<string, number>();
  const daily = new Map<string, number[]>();
  let baskets = 0;

  for (const sale of sales) {
    if (sale.status !== 'completed') continue;
    const key = colombiaDateKey(new Date(sale.date));
    if (key < cutoffKey) continue;
    baskets += 1;
    const dayIndex = Math.floor((Date.parse(`${key}T00:00:00Z`) - cutoffTime) / DAY_MS);
    const ids = Array.from(new Set((sale.items ?? []).map(item => item.productId))).sort();
    for (const item of sale.items ?? []) {
      units.set(item.productId, (units.get(item.productId) ?? 0) + item.quantity);
      revenue.set(item.productId, (revenue.get(item.productId) ?? 0) + item.subtotal);
      const series = daily.get(item.productId) ?? new Array(windowDays).fill(0);
      if (dayIndex >= 0 && dayIndex < windowDays) series[dayIndex] += item.quantity;
      daily.set(item.productId, series);
    }
    for (const id of ids) singles.set(id, (singles.get(id) ?? 0) + 1);
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const pairKey = `${ids[i]}|${ids[j]}`;
        pairs.set(pairKey, (pairs.get(pairKey) ?? 0) + 1);
      }
    }
  }

  return { baskets, singles, pairs, units, revenue, daily, windowDays };
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export interface PairRule {
  anchorId: string;
  partnerId: string;
  together: number;
  anchorCount: number;
  partnerCount: number;
  support: number;
  confidence: number;
  lift: number;
  source: 'historial';
}

export interface AnchorOption {
  id: string;
  name: string;
  revenue: number;
  units: number;
  stock: number;
}

export function anchorOptions(products: Product[], sales: SaleRecord[], windowDays = 30): AnchorOption[] {
  const stats = salesWindowStats(sales, windowDays);
  return products
    .filter(product => product.price > 0)
    .map(product => ({
      id: product.id,
      name: product.name,
      revenue: stats.revenue.get(product.id) ?? 0,
      units: stats.units.get(product.id) ?? 0,
      stock: product.stock,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.units - a.units);
}

/* ------------------------------------------------------------------ */
/* Recomendador híbrido: historial + afinidad de categoría             */
/* ------------------------------------------------------------------ */

type CategoryGroup = 'main' | 'side' | 'drink' | 'dessert' | 'service' | 'other';

function groupOf(value: string): CategoryGroup {
  const text = value.toLowerCase();
  if (/\bpapas?\b|\baros\b|\bnuggets?\b|snack|acompañ|entrada|frito/.test(text)) return 'side';
  if (/postre|helado|brownie|dulce/.test(text)) return 'dessert';
  if (/bebida|minibar|gaseosa|jugo|café|limonada|malteada|vino|cerveza|refresco|agua/.test(text)) return 'drink';
  if (/recep|servicio|lavander|toalla|aseo|bienvenida/.test(text)) return 'service';
  if (/hamburgu|comida|restaurante|plato|cena|salchipapa|perro/.test(text)) return 'main';
  return 'other';
}

const AFFINITY: Record<CategoryGroup, Partial<Record<CategoryGroup, number>>> = {
  main: { side: 1.5, drink: 1.3, dessert: 0.9, main: 0.8, service: 0.3, other: 0.5 },
  side: { drink: 1.0, main: 0.6, dessert: 0.5, other: 0.4 },
  drink: { dessert: 0.6, side: 0.4, main: 0.4, other: 0.4 },
  dessert: { drink: 0.6, main: 0.4, other: 0.4 },
  service: { service: 0.3, other: 0.2 },
  other: { main: 0.3, drink: 0.3, other: 0.2 },
};

const STOP_WORDS = new Set(['de', 'con', 'para', 'por', 'la', 'el', 'los', 'las', 'y', 'al', 'en', 'x']);

function headWord(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/\s+/)
    .find(word => word.length > 2 && !STOP_WORDS.has(word)) ?? '';
}

function isSubstitute(anchor: Product, candidate: Product): boolean {
  return anchor.category === candidate.category && headWord(anchor.name) === headWord(candidate.name);
}

export interface ComboOffer {
  partner: Product;
  together: number;
  confidence: number;
  lift: number;
  source: 'historial' | 'categoria';
  score: number;
  maxCombos: number;
  limiting: string;
  revenue: number;
  margin: number;
}

export interface ComboPlan {
  anchor: Product;
  anchorUnits: number;
  anchorBaskets: number;
  offers: ComboOffer[];
  trio: { partners: Product[]; maxCombos: number; limiting: string; revenue: number; margin: number } | null;
}

function comboAvailability(parts: Product[]): { maxCombos: number; limiting: string } {
  if (!parts.length) return { maxCombos: 0, limiting: '—' };
  const limiting = parts.reduce((worst, product) => (product.stock < worst.stock ? product : worst), parts[0]);
  return { maxCombos: Math.max(0, Math.floor(Math.min(...parts.map(product => product.stock)))), limiting: limiting.name };
}

export function buildComboPlan(
  anchorId: string,
  products: Product[],
  sales: SaleRecord[],
  windowDays = 30,
): ComboPlan | null {
  const anchor = products.find(product => product.id === anchorId);
  if (!anchor) return null;
  const stats = salesWindowStats(sales, windowDays);
  const anchorCount = stats.singles.get(anchor.id) ?? 0;
  const maxUnits = Math.max(1, ...Array.from(stats.units.values()));

  const candidates: ComboOffer[] = products
    .filter(candidate => candidate.id !== anchor.id && candidate.price > 0 && candidate.stock > 0)
    .filter(candidate => !isSubstitute(anchor, candidate))
    .map(candidate => {
      const together = stats.pairs.get(pairKey(anchor.id, candidate.id)) ?? 0;
      const partnerCount = stats.singles.get(candidate.id) ?? 0;
      const support = stats.baskets ? together / stats.baskets : 0;
      const confidence = anchorCount ? together / anchorCount : 0;
      const lift = anchorCount && partnerCount ? (together * stats.baskets) / (anchorCount * partnerCount) : 0;
      const hasHistory = together >= 3;
      const historyScore = hasHistory ? confidence * lift * 4 : 0;
      const affinity = AFFINITY[groupOf(`${anchor.category} ${anchor.name}`)]?.[groupOf(`${candidate.category} ${candidate.name}`)] ?? 0.2;
      const popularity = Math.min(0.3, (stats.units.get(candidate.id) ?? 0) / maxUnits * 0.3);
      const { maxCombos, limiting } = comboAvailability([anchor, candidate]);
      return {
        partner: candidate,
        together,
        confidence,
        lift,
        source: hasHistory ? ('historial' as const) : ('categoria' as const),
        score: historyScore + affinity + popularity,
        maxCombos,
        limiting,
        revenue: maxCombos * (anchor.price + candidate.price),
        margin: maxCombos * (anchor.price - (anchor.cost ?? anchor.price * 0.5) + candidate.price - (candidate.cost ?? candidate.price * 0.5)),
      };
    })
    .filter(offer => offer.score > 0.2)
    .sort((a, b) => b.score - a.score || b.maxCombos - a.maxCombos);

  const offers = candidates.slice(0, 5);
  const anchorGroup = groupOf(`${anchor.category} ${anchor.name}`);
  const byAvailability = (a: ComboOffer, b: ComboOffer) => b.maxCombos - a.maxCombos || b.score - a.score;

  // El trío solo tiene sentido para un plato principal: acompañamiento + bebida.
  // Para bebidas o servicios se muestran solo los pares.
  let trioPartners: Product[] = [];
  if (anchorGroup === 'main') {
    const side = candidates
      .filter(offer => groupOf(`${offer.partner.category} ${offer.partner.name}`) === 'side')
      .sort(byAvailability)[0];
    const coldDrinkPattern = /gaseosa|limonada|jugo|malteada|cerveza|vino|refresco/;
    const coldDrink = candidates
      .filter(offer => groupOf(`${offer.partner.category} ${offer.partner.name}`) === 'drink' && coldDrinkPattern.test(offer.partner.name.toLowerCase()))
      .sort(byAvailability)[0];
    const anyDrink = coldDrink ?? candidates
      .filter(offer => groupOf(`${offer.partner.category} ${offer.partner.name}`) === 'drink')
      .sort(byAvailability)[0];
    trioPartners = [side, anyDrink].filter((offer): offer is ComboOffer => Boolean(offer)).map(offer => offer.partner);
  }

  const trio = trioPartners.length === 2
    ? (() => {
        const parts = [anchor, ...trioPartners];
        const { maxCombos, limiting } = comboAvailability(parts);
        return {
          partners: trioPartners,
          maxCombos,
          limiting,
          revenue: maxCombos * parts.reduce((total, product) => total + product.price, 0),
          margin: maxCombos * parts.reduce((total, product) => total + product.price - (product.cost ?? product.price * 0.5), 0),
        };
      })()
    : null;

  // El trío puede incluir un producto que no está en el top 5 por afinidad;
  // se agrega a la tabla para que la recomendación sea trazable.
  const displayOffers = [...offers];
  for (const partner of trioPartners) {
    if (!displayOffers.some(offer => offer.partner.id === partner.id)) {
      const candidate = candidates.find(offer => offer.partner.id === partner.id);
      if (candidate) displayOffers.push(candidate);
    }
  }

  return { anchor, anchorUnits: stats.units.get(anchor.id) ?? 0, anchorBaskets: anchorCount, offers: displayOffers, trio };
}

/* ------------------------------------------------------------------ */
/* ABC / XYZ + inventario estadístico                                  */
/* ------------------------------------------------------------------ */

const SERVICE_Z = 1.65; // 95 %
const LEAD_TIME_DAYS = 7;
const ORDER_COST = 50_000;
const HOLDING_RATE = 0.25;

export interface ScienceRow {
  id: string;
  name: string;
  category: string;
  stock: number;
  revenue: number;
  units: number;
  share: number;
  abc: 'A' | 'B' | 'C';
  cv: number;
  xyz: 'X' | 'Y' | 'Z';
  daily: number;
  safetyStock: number;
  eoq: number;
  suggestedOrder: number;
}

export interface ScienceReport {
  rows: ScienceRow[];
  pareto: { count: number; total: number; share: number };
  mostVariable: ScienceRow | null;
  bestPair: PairRule | null;
  windowDays: number;
}

export function analyzeInventoryScience(products: Product[], sales: SaleRecord[], windowDays = 30): ScienceReport {
  const stats = salesWindowStats(sales, windowDays);
  const totalRevenue = Array.from(stats.revenue.values()).reduce((total, value) => total + value, 0);

  const rows: ScienceRow[] = products
    .filter(product => product.price > 0)
    .map(product => {
      const series = stats.daily.get(product.id) ?? new Array(windowDays).fill(0);
      const mean = series.reduce((total, value) => total + value, 0) / windowDays;
      const variance = series.reduce((total, value) => total + (value - mean) ** 2, 0) / Math.max(1, windowDays);
      const sigma = Math.sqrt(variance);
      // XYZ con demanda semanal: reduce el ruido de los días sin venta y separa
      // productos estables (X) de los intermitentes (Z).
      const weekCount = Math.max(1, Math.ceil(windowDays / 7));
      const weekly = new Array(weekCount).fill(0);
      series.forEach((value, index) => {
        const week = Math.min(weekCount - 1, Math.floor(index / 7));
        weekly[week] += value;
      });
      const weeklyMean = weekly.reduce((total, value) => total + value, 0) / weekCount;
      const weeklyVariance = weekly.reduce((total, value) => total + (value - weeklyMean) ** 2, 0) / weekCount;
      const cv = weeklyMean > 0 ? Math.sqrt(weeklyVariance) / weeklyMean : 0;
      const revenueValue = stats.revenue.get(product.id) ?? 0;
      const cost = product.cost ?? product.price * 0.5;
      const safetyStock = mean > 0 ? Math.ceil(SERVICE_Z * sigma * Math.sqrt(LEAD_TIME_DAYS)) : 0;
      const eoqRaw = cost > 0 ? Math.sqrt((2 * mean * 365 * ORDER_COST) / (HOLDING_RATE * cost)) : 0;
      const eoq = Math.max(1, Math.min(Math.ceil(eoqRaw), Math.max(1, Math.ceil(mean * 30))));
      const suggestedOrder = Math.max(0, Math.ceil(safetyStock + mean * LEAD_TIME_DAYS - product.stock));
      return {
        id: product.id,
        name: product.name,
        category: product.category,
        stock: product.stock,
        revenue: revenueValue,
        units: stats.units.get(product.id) ?? 0,
        share: totalRevenue ? revenueValue / totalRevenue : 0,
        abc: 'C' as const,
        cv,
        xyz: weeklyMean === 0 ? ('Z' as const) : cv <= 0.5 ? ('X' as const) : cv <= 1 ? ('Y' as const) : ('Z' as const),
        daily: mean,
        safetyStock,
        eoq,
        suggestedOrder,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  let cumulative = 0;
  for (const row of rows) {
    cumulative += row.share;
    row.abc = cumulative <= 0.8 ? 'A' : cumulative <= 0.95 ? 'B' : 'C';
  }

  let cumulativePareto = 0;
  let paretoCount = 0;
  for (const row of rows) {
    if (row.revenue <= 0) continue;
    if (cumulativePareto >= 0.8) break;
    cumulativePareto += row.share;
    paretoCount += 1;
  }
  const paretoShare = rows.slice(0, paretoCount).reduce((total, row) => total + row.share, 0);

  const mostVariable = rows
    .filter(row => row.revenue > 0)
    .sort((a, b) => b.cv - a.cv)[0] ?? null;

  const rules: PairRule[] = [];
  stats.pairs.forEach((together, key) => {
    if (together < 3) return;
    const [anchorId, partnerId] = key.split('|');
    const anchorCount = stats.singles.get(anchorId) ?? 0;
    const partnerCount = stats.singles.get(partnerId) ?? 0;
    if (!anchorCount || !partnerCount) return;
    rules.push({
      anchorId, partnerId, together, anchorCount, partnerCount,
      support: stats.baskets ? together / stats.baskets : 0,
      confidence: together / anchorCount,
      lift: (together * stats.baskets) / (anchorCount * partnerCount),
      source: 'historial',
    });
  });
  const bestPair = rules.sort((a, b) => b.lift - a.lift)[0] ?? null;

  return {
    rows,
    pareto: { count: paretoCount, total: rows.filter(row => row.revenue > 0).length, share: paretoShare },
    mostVariable,
    bestPair,
    windowDays,
  };
}
