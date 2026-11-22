import { describe, expect, it } from 'vitest';
import { groupsForProduct, optionsLabel, optionsPrice, selectionError, type OptionGroup } from './productOptions';

const size: OptionGroup = {
  id: 'g-size',
  name: 'Tamaño',
  minSelect: 1,
  maxSelect: 1,
  productIds: ['burger'],
  options: [
    { id: 'small', name: 'Sencilla', priceDelta: 0 },
    { id: 'double', name: 'Doble', priceDelta: 6000 },
  ],
};
const extras: OptionGroup = {
  id: 'g-extras',
  name: 'Adicionales',
  minSelect: 0,
  maxSelect: 2,
  productIds: ['burger', 'hotdog'],
  options: [
    { id: 'cheese', name: 'Queso', priceDelta: 2000 },
    { id: 'bacon', name: 'Tocineta', priceDelta: 3000 },
    { id: 'egg', name: 'Huevo', priceDelta: 1500 },
  ],
};
const all = [size, extras];

describe('product options', () => {
  it('lista solo los grupos asignados al producto, los obligatorios primero', () => {
    expect(groupsForProduct([extras, size], 'burger').map(g => g.id)).toEqual(['g-size', 'g-extras']);
    expect(groupsForProduct(all, 'hotdog').map(g => g.id)).toEqual(['g-extras']);
    expect(groupsForProduct(all, 'juice')).toEqual([]);
  });

  it('exige el mínimo y respeta el máximo de cada grupo', () => {
    const burger = groupsForProduct(all, 'burger');
    expect(selectionError(burger, [])).toBe('Elige 1 en «Tamaño».');
    expect(selectionError(burger, ['double', 'cheese', 'bacon', 'egg'])).toBe('Máximo 2 en «Adicionales».');
    expect(selectionError(burger, ['double', 'cheese'])).toBeNull();
  });

  it('suma el precio y arma la etiqueta en el orden de los grupos', () => {
    const burger = groupsForProduct(all, 'burger');
    expect(optionsPrice(burger, ['cheese', 'double'])).toBe(8000);
    expect(optionsLabel(burger, ['cheese', 'double'])).toBe('Doble, Queso');
    expect(optionsLabel(burger, [])).toBe('');
  });
});
