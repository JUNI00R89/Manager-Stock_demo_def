import { colombiaDateKey } from '../services/dataService';
import type { SaleRecord } from '../services/dataService';
import type { Product } from './mockData';
import { buildRevenueProjection } from './revenueForecast';

/**
 * Plan anti-pérdidas por producto.
 *
 * Cruza existencias, precio/costo y ventas de los últimos 30 días para detectar
 * quiebres (venta perdida), cobertura crítica, sobre-stock (capital detenido)
 * y productos sin rotación. La demanda se escala con la proyección de ingresos
 * (tope +25 % para no comprar de más cuando el modelo tiene incertidumbre).
 */

const DAY_MS = 86_400_000;
export type ProductRiskLevel = 'quiebre' | 'critico' | 'sobre_stock' | 'sin_rotacion' | 'ok';

export interface ProductRiskRow {
  id: string;
  name: string;
  category: string;
  price: number;
  cost: number;
  stock: number;
  minStock: number;
  unit: string;
  units: number;
  daily: number;
  dailyProjected: number;
  coverDays: number;
  marginPct: number;
  risk: ProductRiskLevel;
  reorderQty: number;
  reorderPoint: number;
  action: string;
}

export interface ProductRiskReport {
  rows: ProductRiskRow[];
  stockouts: ProductRiskRow[];
  critical: ProductRiskRow[];
  overstock: ProductRiskRow[];
  dead: ProductRiskRow[];
  revenueAtRisk: number;
  marginAtRisk: number;
  tiedCapital: number;
  reorderInvestment: number;
  uplift: number;
  windowDays: number;
}

export function analyzeProductRisk(products: Product[], sales: SaleRecord[], windowDays = 30): ProductRiskReport | null {
  const sellable = products.filter(product => !product.productType || product.productType === 'sale_item');
  if (!sellable.length) return null;

  const now = new Date();
  const cutoff = colombiaDateKey(new Date(now.getTime() - windowDays * DAY_MS));
  const units = new Map<string, number>();
  let revenueWindow = 0;
  for (const sale of sales) {
    if (sale.status !== 'completed') continue;
    const key = colombiaDateKey(new Date(sale.date));
    if (key < cutoff) continue;
    revenueWindow += sale.totalPrice;
    for (const item of sale.items ?? []) {
      units.set(item.productId, (units.get(item.productId) ?? 0) + item.quantity);
    }
  }

  const projection = buildRevenueProjection(sales, 90, 30, now);
  const uplift = projection && revenueWindow > 0
    ? Math.min(1.25, Math.max(1, projection.monthTotal / revenueWindow))
    : 1;

  const rows: ProductRiskRow[] = sellable.map(product => {
    const price = product.price;
    const cost = product.cost ?? price * 0.5;
    const stock = product.stock;
    const quantity = units.get(product.id) ?? 0;
    const daily = quantity / windowDays;
    const dailyProjected = daily * uplift;
    const coverDays = daily > 0 ? stock / daily : (stock > 0 ? Number.POSITIVE_INFINITY : 0);

    let risk: ProductRiskLevel = 'ok';
    if (stock <= 0 && daily > 0) risk = 'quiebre';
    else if (daily > 0 && coverDays < 7) risk = 'critico';
    else if (daily > 0 && coverDays > 60) risk = 'sobre_stock';
    else if (daily === 0 && stock > 0) risk = 'sin_rotacion';

    const reorderQty = risk === 'quiebre' || risk === 'critico'
      ? Math.max(0, Math.ceil(dailyProjected * 14 - stock))
      : 0;
    const reorderPoint = Math.ceil(dailyProjected * 7 * 1.2);
    const action = risk === 'quiebre'
      ? `Reponer ${reorderQty} uds ya`
      : risk === 'critico'
        ? `Reponer ${reorderQty} uds antes del fin de semana`
        : risk === 'sobre_stock'
          ? 'Congelar compra · mover con combo'
          : risk === 'sin_rotacion'
            ? 'Liquidar o descontinuar'
            : 'Mantener';

    return {
      id: product.id, name: product.name, category: product.category,
      price, cost, stock, minStock: product.minStock, unit: product.unit ?? 'unidad',
      units: quantity, daily, dailyProjected, coverDays,
      marginPct: price > 0 ? ((price - cost) / price) * 100 : 0,
      risk, reorderQty, reorderPoint, action,
    };
  });

  const stockouts = rows.filter(row => row.risk === 'quiebre');
  const critical = rows.filter(row => row.risk === 'critico');
  const overstock = rows.filter(row => row.risk === 'sobre_stock');
  const dead = rows.filter(row => row.risk === 'sin_rotacion');
  const atRisk = [...stockouts, ...critical];

  return {
    rows,
    stockouts,
    critical,
    overstock,
    dead,
    revenueAtRisk: atRisk.reduce((total, row) => total + row.dailyProjected * 30 * row.price, 0),
    marginAtRisk: atRisk.reduce((total, row) => total + row.dailyProjected * 30 * (row.price - row.cost), 0),
    tiedCapital: overstock.reduce((total, row) => total + Math.max(0, row.stock - row.daily * 45) * row.cost, 0)
      + dead.reduce((total, row) => total + row.stock * row.cost, 0),
    reorderInvestment: atRisk.reduce((total, row) => total + row.reorderQty * row.cost, 0),
    uplift,
    windowDays,
  };
}
