import { describe, expect, it } from 'vitest'
import { quickCashAmounts } from './quickCash'

describe('quickCashAmounts', () => {
  it('suggests the next round amounts and the bills that cover the total', () => {
    expect(quickCashAmounts(21420)).toEqual([22000, 25000, 50000, 100000])
    expect(quickCashAmounts(3500)).toEqual([4000, 5000, 10000, 20000])
  })

  it('handles large totals by rounding up', () => {
    expect(quickCashAmounts(151000)).toEqual([155000, 200000])
  })

  it('suggests nothing when the total is already round or empty', () => {
    expect(quickCashAmounts(100000)).toEqual([])
    expect(quickCashAmounts(0)).toEqual([])
  })
})
