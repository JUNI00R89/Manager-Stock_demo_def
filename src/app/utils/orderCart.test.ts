import { describe, expect, it } from 'vitest'
import { mergeableLine } from './orderCart'

type Line = { lineId: string; productId: string; note: string }
const noteOf = (line: Line) => line.note

describe('mergeableLine', () => {
  it('returns nothing for an empty cart', () => {
    expect(mergeableLine<Line>([], 'burger', noteOf)).toBeUndefined()
  })

  it('reuses the line of the same product when it has no note', () => {
    const plain = { lineId: 'a', productId: 'burger', note: '' }
    expect(mergeableLine([plain], 'burger', noteOf)).toBe(plain)
  })

  it('does not merge into a line that already has a note (it becomes a new line)', () => {
    expect(mergeableLine([{ lineId: 'a', productId: 'burger', note: 'sin cebolla' }], 'burger', noteOf)).toBeUndefined()
  })

  it('picks the line without note when the product is split', () => {
    const plain = { lineId: 'b', productId: 'burger', note: '' }
    expect(mergeableLine([{ lineId: 'a', productId: 'burger', note: 'sin cebolla' }, plain], 'burger', noteOf)).toBe(plain)
  })

  it('treats a note made only of spaces as no note', () => {
    const blank = { lineId: 'a', productId: 'burger', note: '   ' }
    expect(mergeableLine([blank], 'burger', noteOf)).toBe(blank)
  })

  it('never merges a different product', () => {
    expect(mergeableLine([{ lineId: 'a', productId: 'soda', note: '' }], 'burger', noteOf)).toBeUndefined()
  })
})
