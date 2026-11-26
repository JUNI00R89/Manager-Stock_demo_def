import { describe, expect, it, vi } from 'vitest';
import { isRetailBarcode, lookupProductName } from './productLookup';

const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as Response);

describe('lookupProductName', () => {
  it('arma el nombre con la marca cuando no la incluye', async () => {
    const fetchMock = reply({
      status: 1,
      product: { product_name: 'Gaseosa sabor cola 400 ml', brands: 'Postobón, Otra' },
    });
    expect(await lookupProductName('7702090000000', fetchMock)).toBe('Gaseosa sabor cola 400 ml Postobón');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('openfoodfacts.org/api/v2/product/7702090000000.json'),
      expect.anything(),
    );
  });

  it('prefiere el nombre en español y no repite la marca', async () => {
    const fetchMock = reply({
      status: 1,
      product: { product_name_es: 'Leche Alpina', product_name: 'Milk', brands: 'Alpina' },
    });
    expect(await lookupProductName('7702001000000', fetchMock)).toBe('Leche Alpina');
  });

  it('no consulta afuera un SKU interno', async () => {
    const fetchMock = reply({});
    expect(isRetailBarcode('BEB-0001')).toBe(false);
    expect(await lookupProductName('BEB-0001', fetchMock)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('devuelve null si el producto no está registrado o no hay Internet', async () => {
    expect(await lookupProductName('7700000000000', reply({ status: 0 }))).toBeNull();
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await lookupProductName('7700000000000', offline)).toBeNull();
  });
});
