import { describe, expect, it } from 'vitest';
import { paymentParts } from './PaymentFields';

describe('paymentParts', () => {
  it('lleva el proveedor y la referencia en la parte digital', () => {
    expect(paymentParts({ cash: '5000', digital: '4000', digitalProvider: 'nequi', digitalReference: ' R1 ' })).toEqual(
      [
        { method: 'cash', amount: 5000 },
        { method: 'digital', amount: 4000, provider: 'nequi', reference: 'R1' },
      ],
    );
  });

  it('pide el proveedor si hay monto digital', () => {
    expect(() => paymentParts({ digital: '4000' })).toThrow(/proveedor/i);
  });

  it('ignora el proveedor si no hay monto digital', () => {
    expect(paymentParts({ card: '9000', digitalProvider: 'nequi' })).toEqual([{ method: 'card', amount: 9000 }]);
  });
});
