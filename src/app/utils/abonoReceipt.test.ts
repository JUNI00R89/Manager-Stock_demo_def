import { describe, expect, it } from 'vitest';
import { abonoReceiptText } from './abonoReceipt';

describe('abonoReceiptText', () => {
  it('lista negocio, cliente, valor, medio y saldo que queda', () => {
    const text = abonoReceiptText({
      businessName: 'Tienda Don José',
      customerName: 'Don Pedro',
      payment: {
        id: 'ABO-1',
        amount: 15000,
        method: 'digital',
        provider: 'nequi',
        createdAt: '2026-11-21T15:00:00+00:00',
      },
      balance: 20000,
    }).replace(/ /g, ' '); // Intl separates "$" from the amount with a non-breaking space
    expect(text).toContain('Tienda Don José');
    expect(text).toContain('Comprobante de abono ABO-1');
    expect(text).toContain('Cliente: Don Pedro');
    expect(text).toContain('Abono: $ 15.000');
    expect(text).toContain('Medio: Nequi');
    expect(text).toContain('Saldo pendiente: $ 20.000');
  });

  it('dice que la cuenta quedó al día cuando no queda saldo', () => {
    const text = abonoReceiptText({
      businessName: 'Tienda',
      customerName: 'Ana',
      payment: { id: 'ABO-2', amount: 5000, method: 'cash', createdAt: '2026-11-21T15:00:00+00:00' },
      balance: 0,
    });
    expect(text).toContain('Medio: Efectivo');
    expect(text).toContain('Cuenta al día');
  });
});
