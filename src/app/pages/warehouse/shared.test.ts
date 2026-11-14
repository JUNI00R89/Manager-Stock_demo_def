import { describe, expect, it } from 'vitest'
import { withoutLine } from './shared'

describe('withoutLine', () => {
  it('quita la línea pedida pero nunca deja el formulario sin líneas', () => {
    const lines = [{ key: 'a' }, { key: 'b' }]
    expect(withoutLine(lines, 'a')).toEqual([{ key: 'b' }])
    expect(withoutLine([{ key: 'b' }], 'b')).toEqual([{ key: 'b' }])
  })
})
