import { describe, expect, it, vi } from 'vitest';
import type { Product } from './types';
import type { SaleRecord } from '../services/dataService';

vi.mock('../services/dataService', () => ({
  colombiaDateKey: (value: Date = new Date()) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(value),
}));

import { analyzeInventoryScience, anchorOptions, buildComboPlan, salesWindowStats } from './commercialScience';

function product(overrides: Partial<Product> & Pick<Product, 'id' | 'name' | 'price' | 'stock'>): Product {
  return {
    sku: overrides.id,
    category: 'Comidas',
    minStock: 1,
    description: '',
    image: '',
    ...overrides,
  };
}

const burger = product({
  id: 'burger',
  name: 'Hamburguesa clásica',
  category: 'Comidas',
  price: 10000,
  stock: 10,
  cost: 5000,
});
const fries = product({
  id: 'fries',
  name: 'Papas fritas',
  category: 'Acompañamientos',
  price: 5000,
  stock: 5,
  cost: 2000,
});
const soda = product({
  id: 'soda',
  name: 'Gaseosa 400 ml',
  category: 'Bebidas',
  price: 3000,
  stock: 20,
  cost: 1000,
});
const products = [burger, fries, soda];

let saleSequence = 0;

function sale(productIds: string[], date = new Date()): SaleRecord {
  saleSequence += 1;
  const items = productIds.map(productId => ({
    productId,
    productName: productId,
    quantity: 1,
    price: 1000,
    discountPercent: 0,
    subtotal: 1000,
  }));
  const subtotal = items.reduce((total, item) => total + item.subtotal, 0);

  return {
    id: `s${saleSequence}`,
    date: date.toISOString(),
    status: 'completed',
    customer: 'Cliente',
    paymentMethod: 'cash',
    currency: 'COP',
    subtotal,
    lineDiscount: 0,
    globalDiscount: 0,
    taxRate: 0,
    tax: 0,
    totalPrice: subtotal,
    productId: productIds[0] ?? '',
    productName: productIds[0] ?? '',
    quantity: items.length,
    items,
  };
}

describe('salesWindowStats', () => {
  it('cuenta canastas, unidades y pares', () => {
    const stats = salesWindowStats(
      [
        sale(['burger', 'fries']),
        sale(['burger', 'fries']),
        sale(['burger', 'fries']),
        sale(['burger', 'soda']),
        sale(['fries']),
      ],
      30,
    );

    expect(stats.baskets).toBe(5);
    expect(stats.units.get('burger')).toBe(4);
    expect(stats.units.get('fries')).toBe(4);
    expect(stats.units.get('soda')).toBe(1);
    expect(stats.pairs.get('burger|fries')).toBe(3);
    expect(stats.pairs.get('burger|soda')).toBe(1);
    expect(stats.daily.get('burger')).toHaveLength(30);
  });

  it('incluye las ventas de hoy en la serie diaria', () => {
    const stats = salesWindowStats([sale(['burger'])], 30);
    const series = stats.daily.get('burger');

    expect(series).toHaveLength(30);
    expect(series![series!.length - 1]).toBe(1);
  });

  it('ignora ventas canceladas y fuera de la ventana', () => {
    const old = new Date(Date.now() - 40 * 86_400_000);
    const cancelled = { ...sale(['burger']), status: 'cancelled' as const };

    const stats = salesWindowStats([sale(['burger']), cancelled, sale(['fries'], old)], 30);

    expect(stats.baskets).toBe(1);
    expect(stats.units.get('burger')).toBe(1);
    expect(stats.units.get('fries')).toBeUndefined();
  });
});

describe('anchorOptions', () => {
  it('ordena los anclajes por ingresos', () => {
    const options = anchorOptions(products, [sale(['burger']), sale(['burger']), sale(['fries'])]);

    expect(options).toHaveLength(3);
    expect(options[0].id).toBe('burger');
    expect(options[0].revenue).toBeGreaterThanOrEqual(options[1].revenue);
    expect(options.find(option => option.id === 'soda')?.revenue).toBe(0);
  });
});

describe('buildComboPlan', () => {
  const comboSales = [
    sale(['burger', 'fries']),
    sale(['burger', 'fries']),
    sale(['burger', 'fries']),
    sale(['burger', 'soda']),
  ];

  it('propone acompañamiento y bebida y calcula existencias', () => {
    const plan = buildComboPlan('burger', products, comboSales);

    expect(plan).not.toBeNull();
    expect(plan!.anchor.id).toBe('burger');
    expect(plan!.offers.some(offer => offer.partner.id === 'fries')).toBe(true);
    expect(plan!.offers.some(offer => offer.partner.id === 'soda')).toBe(true);
    expect(plan!.trio).not.toBeNull();
    expect(plan!.trio!.partners.map(partner => partner.id).sort()).toEqual(['fries', 'soda']);
    expect(plan!.trio!.maxCombos).toBe(5);
    expect(plan!.trio!.limiting).toBe('Papas fritas');
  });

  it('no propone trío cuando el anclaje no es un plato principal', () => {
    const plan = buildComboPlan('soda', products, comboSales);

    expect(plan).not.toBeNull();
    expect(plan!.anchor.id).toBe('soda');
    expect(plan!.trio).toBeNull();
  });

  it('devuelve null si el anclaje no existe', () => {
    expect(buildComboPlan('missing', products, comboSales)).toBeNull();
  });
});

describe('analyzeInventoryScience', () => {
  const scienceProducts = [
    product({ id: 'a', name: 'Producto A', price: 1000, stock: 0, cost: 500 }),
    product({ id: 'b', name: 'Producto B', price: 1000, stock: 5, cost: 500 }),
    product({ id: 'c', name: 'Producto C', price: 1000, stock: 50, cost: 500 }),
  ];
  const scienceSales = [
    ...Array.from({ length: 10 }, () => sale(['a'])),
    ...Array.from({ length: 5 }, () => sale(['b'])),
    ...Array.from({ length: 2 }, () => sale(['c'])),
    ...Array.from({ length: 3 }, () => sale(['a', 'b'])),
  ];

  it('clasifica ABC/XYZ y calcula el pedido sugerido', () => {
    const report = analyzeInventoryScience(scienceProducts, scienceSales, 30);

    expect(report.rows).toHaveLength(3);
    expect(report.rows[0].id).toBe('a');
    expect(report.rows[0].abc).toBe('A');
    expect(report.rows[report.rows.length - 1].abc).toBe('C');
    expect(report.rows[0].suggestedOrder).toBeGreaterThan(0);
    expect(report.pareto.count).toBeGreaterThan(0);
    expect(report.pareto.total).toBe(3);
    expect(report.bestPair).not.toBeNull();
  });

  it('devuelve un reporte vacío sin productos', () => {
    const report = analyzeInventoryScience([], [], 30);

    expect(report.rows).toEqual([]);
    expect(report.pareto.total).toBe(0);
    expect(report.mostVariable).toBeNull();
    expect(report.bestPair).toBeNull();
  });
});
