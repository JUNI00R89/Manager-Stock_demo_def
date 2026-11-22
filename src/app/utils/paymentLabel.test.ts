import { describe, expect, it } from 'vitest';
import { digitalDetail, tillBreakdown } from './paymentLabel';

describe('digitalDetail', () => {
  it('nombra el proveedor y la referencia de las partes digitales', () => {
    expect(digitalDetail([{ method: 'digital', amount: 9000, provider: 'nequi', reference: '123' }])).toBe(
      'Nequi · Ref 123',
    );
    expect(
      digitalDetail([
        { method: 'cash', amount: 5000 },
        { method: 'digital', amount: 4000, provider: 'breb', reference: '' },
      ]),
    ).toBe('Bre-B');
    expect(digitalDetail([{ method: 'card', amount: 1 }])).toBe('');
    expect(digitalDetail(undefined)).toBe('');
  });
});

describe('tillBreakdown', () => {
  it('resume el turno por método y proveedor', () => {
    const line = tillBreakdown([
      { method: 'cash', provider: null, amount: 5000 },
      { method: 'digital', provider: 'nequi', amount: 80000 },
      { method: 'digital', provider: 'daviplata', amount: 40000 },
      { method: 'credit', provider: null, amount: 20000 },
    ]);
    // Intl separates "$" from the amount with a non-breaking space.
    expect(line.replace(/ /g, ' ')).toBe('Efectivo $ 5.000 · Nequi $ 80.000 · Daviplata $ 40.000 · Fiado $ 20.000');
  });
});
