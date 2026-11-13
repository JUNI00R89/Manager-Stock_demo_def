import { describe, expect, it, vi } from 'vitest'
import type { Product } from './mockData'
import type { SaleRecord } from '../services/dataService'

vi.mock('../services/dataService', () => ({
  colombiaDateKey: (value: Date = new Date()) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(value),
}))

import { analyzeProductRisk } from './productRisk'

function product(overrides: Partial<Product> & Pick<Product, 'id' | 'name' | 'price' | 'stock'>): Product {
  return {
    sku: overrides.id,
    category: 'Comidas',
    minStock: 1,
    description: '',
    image: '',
    ...overrides,
  }
}

function sale(productId: string, daysAgo: number): SaleRecord {
  const date = new Date(Date.now() - daysAgo * 86_400_000)
  return {
    id: `sale-${productId}-${daysAgo}`,
    date: date.toISOString(),
    status: 'completed',
    customer: 'Cliente',
    paymentMethod: 'cash',
    currency: 'COP',
    subtotal: 1000,
    lineDiscount: 0,
    globalDiscount: 0,
    taxRate: 0,
    tax: 0,
    totalPrice: 1000,
    productId,
    productName: productId,
    quantity: 1,
    items: [{
      productId,
      productName: productId,
      quantity: 1,
      price: 1000,
      discountPercent: 0,
      subtotal: 1000,
    }],
  }
}

const products = [
  product({ id: 'out', name: 'Agotado', price: 1000, stock: 0, cost: 500 }),
  product({ id: 'critical', name: 'Crítico', price: 1000, stock: 2, cost: 500 }),
  product({ id: 'over', name: 'Sobre stock', price: 1000, stock: 100, cost: 500 }),
  product({ id: 'dead', name: 'Sin rotación', price: 1000, stock: 10, cost: 500 }),
]

const sales = [
  ...Array.from({ length: 30 }, (_, index) => sale('out', index)),
  ...Array.from({ length: 30 }, (_, index) => sale('critical', index)),
  ...Array.from({ length: 30 }, (_, index) => sale('over', index)),
]

describe('analyzeProductRisk', () => {
  it('clasifica quiebres, críticos, sobre-stock y productos sin rotación', () => {
    const report = analyzeProductRisk(products, sales, 30)

    expect(report).not.toBeNull()
    expect(report!.stockouts.map(row => row.id)).toContain('out')
    expect(report!.critical.map(row => row.id)).toContain('critical')
    expect(report!.overstock.map(row => row.id)).toContain('over')
    expect(report!.dead.map(row => row.id)).toContain('dead')
    expect(report!.rows.find(row => row.id === 'out')?.risk).toBe('quiebre')
    expect(report!.rows.find(row => row.id === 'critical')?.risk).toBe('critico')
    expect(report!.rows.find(row => row.id === 'over')?.risk).toBe('sobre_stock')
    expect(report!.rows.find(row => row.id === 'dead')?.risk).toBe('sin_rotacion')
  })

  it('calcula inversión, capital retenido y margen en riesgo', () => {
    const report = analyzeProductRisk(products, sales, 30)!

    expect(report.revenueAtRisk).toBeGreaterThan(0)
    expect(report.marginAtRisk).toBeGreaterThan(0)
    expect(report.tiedCapital).toBeGreaterThan(0)
    expect(report.reorderInvestment).toBeGreaterThan(0)
    expect(report.uplift).toBeGreaterThanOrEqual(1)
    expect(report.rows.find(row => row.id === 'out')?.reorderQty).toBeGreaterThan(0)
    expect(report.rows.find(row => row.id === 'critical')?.reorderQty).toBeGreaterThan(0)
    expect(report.rows.find(row => row.id === 'over')?.reorderQty).toBe(0)
  })

  it('ignora ingredientes y devuelve null sin productos vendibles', () => {
    const ingredients = [
      product({ id: 'ing', name: 'Ingrediente', price: 500, stock: 10, productType: 'ingredient' }),
    ]

    expect(analyzeProductRisk(ingredients, sales, 30)).toBeNull()
    expect(analyzeProductRisk([], [], 30)).toBeNull()
  })
})
