import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('usa punto y coma, comillas dobles escapadas y vacío para null/undefined', () => {
    expect(toCsv([['Nombre', 'Total'], ['Café "especial"', 2500], [null, undefined]]))
      .toBe('"Nombre";"Total"\r\n"Café ""especial""";"2500"\r\n"";""');
  });
});
