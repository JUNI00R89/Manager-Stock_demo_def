import { describe, expect, it } from 'vitest';
import { safePaymentUrl } from './Subscription';

describe('safePaymentUrl', () => {
  it('acepta links https del proveedor', () => {
    expect(safePaymentUrl('https://www.mercadopago.com.co/subscriptions/checkout?preapproval_plan_id=abc'))
      .toBe('https://www.mercadopago.com.co/subscriptions/checkout?preapproval_plan_id=abc');
  });

  it('descarta valores vacíos, inseguros o mal formados', () => {
    for (const value of [undefined, null, '', 'javascript:alert(1)', 'http://inseguro.example', 'no es un link', 'data:text/html,hola']) {
      expect(safePaymentUrl(value)).toBeNull();
    }
  });
});
