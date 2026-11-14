import { describe, expect, it } from 'vitest'
import type { BusinessConfig } from '../context/BusinessContext'
import { fitWithin, imagesEnabled, productImageUrl } from './productImage'

describe('productImageUrl', () => {
  it('turns an uploaded photo path into an absolute URL on the API server', () => {
    const url = productImageUrl('/uploads/products/a.jpg', true)
    expect(url).toMatch(/^http/)
    expect(url).toMatch(/\/uploads\/products\/a\.jpg$/)
    expect(url).not.toContain('/api/uploads')
  })

  it('treats legacy icon keys and empty values as no photo', () => {
    expect(productImageUrl('food', true)).toBeNull()
    expect(productImageUrl('', true)).toBeNull()
    expect(productImageUrl(undefined, true)).toBeNull()
  })

  it('hides photos when the business switch is off', () => {
    expect(productImageUrl('/uploads/products/a.jpg', false)).toBeNull()
  })
})

describe('imagesEnabled', () => {
  const base = { type: 'retail', name: 'T', currency: 'COP', taxRate: 0, features: { inventory: true, pos: true, reservations: false, tables: false, rooms: false, warehouse: false, services: false, delivery: false } } as BusinessConfig

  it('is on by default (no config or switch never set)', () => {
    expect(imagesEnabled(null)).toBe(true)
    expect(imagesEnabled(base)).toBe(true)
  })

  it('is off only when the owner turned it off', () => {
    expect(imagesEnabled({ ...base, features: { ...base.features, productImages: false } })).toBe(false)
  })
})

describe('fitWithin', () => {
  it('shrinks the longest side to the limit and keeps the proportion', () => {
    expect(fitWithin(1600, 800, 400)).toEqual({ width: 400, height: 200 })
    expect(fitWithin(500, 1000, 400)).toEqual({ width: 200, height: 400 })
  })

  it('never enlarges a small crop', () => {
    expect(fitWithin(120, 90, 400)).toEqual({ width: 120, height: 90 })
  })
})
