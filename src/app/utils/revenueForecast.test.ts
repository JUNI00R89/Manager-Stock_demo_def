import { describe, expect, it, vi } from 'vitest'

vi.mock('../services/dataService', () => ({
  colombiaDateKey: (value: Date = new Date()) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(value),
}))

import type { ForecastSale } from './revenueForecast'
import {
  buildRevenueProjection,
  dailyRevenue,
  dayOfMonthOfKey,
  estimateOccupancy,
  weekdayOfKey,
} from './revenueForecast'

const DAY_MS = 86_400_000

function sale(date: Date, totalPrice: number, status = 'completed'): ForecastSale {
  return { date: date.toISOString(), totalPrice, status }
}

describe('weekdayOfKey', () => {
  it('calcula el día de la semana sin depender de la zona del equipo', () => {
    expect(weekdayOfKey('2026-01-05')).toBe(1) // lunes
    expect(weekdayOfKey('2026-01-11')).toBe(0) // domingo
  })
})

describe('dayOfMonthOfKey', () => {
  it('extrae el día del mes', () => {
    expect(dayOfMonthOfKey('2026-01-05')).toBe(5)
    expect(dayOfMonthOfKey('2026-12-31')).toBe(31)
  })
})

describe('dailyRevenue', () => {
  it('agrupa ventas completadas por día de Colombia', () => {
    const now = new Date('2026-01-10T20:00:00Z')
    const result = dailyRevenue([
      sale(new Date('2026-01-10T15:00:00Z'), 300),
      sale(new Date('2026-01-09T15:00:00Z'), 200),
      sale(new Date('2026-01-08T15:00:00Z'), 100),
      sale(new Date('2026-01-10T16:00:00Z'), 50, 'pending'),
    ], 3, now)

    expect(result.map(point => point.key)).toEqual(['2026-01-08', '2026-01-09', '2026-01-10'])
    expect(result.map(point => point.revenue)).toEqual([100, 200, 300])
  })

  it('rellena con cero los días sin ventas', () => {
    const now = new Date('2026-01-10T20:00:00Z')
    const result = dailyRevenue([sale(new Date('2026-01-10T15:00:00Z'), 500)], 3, now)

    expect(result.map(point => point.revenue)).toEqual([0, 0, 500])
  })
})

describe('buildRevenueProjection', () => {
  const now = new Date('2026-02-01T20:00:00Z')

  it('proyecta con al menos cinco días con ventas', () => {
    const sales = Array.from({ length: 30 }, (_, index) =>
      sale(new Date(now.getTime() - index * DAY_MS), 1000),
    )
    const projection = buildRevenueProjection(sales, 30, 7, now)

    expect(projection).not.toBeNull()
    expect(projection!.points).toHaveLength(7)
    expect(projection!.weekdayAverages).toHaveLength(7)
    expect(projection!.monthTotal).toBeGreaterThan(0)
    expect(projection!.weekTotal).toBeGreaterThan(0)
    expect(projection!.monthLow).toBeLessThanOrEqual(projection!.monthTotal)
    expect(projection!.monthHigh).toBeGreaterThanOrEqual(projection!.monthTotal)
    expect(projection!.reliable).toBe(true)
  })

  it('devuelve null cuando no hay suficiente historia', () => {
    expect(buildRevenueProjection([sale(now, 1000)], 30, 7, now)).toBeNull()
    expect(buildRevenueProjection([], 30, 7, now)).toBeNull()
  })
})

describe('estimateOccupancy', () => {
  const points = [
    { key: '2026-01-01', revenue: 100000, low: 0, high: 0 },
    { key: '2026-01-02', revenue: 100000, low: 0, high: 0 },
  ]

  it('estima ocupación y RevPAR a partir de la proyección y las tarifas', () => {
    const estimate = estimateOccupancy(points, [
      { pricePerNight: 100000 },
      { pricePerNight: 200000 },
    ], 2)

    expect(estimate).not.toBeNull()
    expect(estimate!.rooms).toBe(2)
    expect(estimate!.adr).toBe(150000)
    expect(estimate!.capacityPerDay).toBe(300000)
    expect(estimate!.occupancyPct).toBeCloseTo(33.333, 2)
    expect(estimate!.revpar).toBe(50000)
  })

  it('devuelve null sin habitaciones válidas o sin puntos', () => {
    expect(estimateOccupancy(points, [], 2)).toBeNull()
    expect(estimateOccupancy([], [{ pricePerNight: 100000 }], 2)).toBeNull()
    expect(estimateOccupancy(points, [{ pricePerNight: 0 }], 2)).toBeNull()
  })
})
