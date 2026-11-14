import { csvCell } from './saleMetrics';

/** CSV with `;` separators, the format Excel in Spanish opens directly; csvCell neutralises formulas (=, +, -, @). */
export function toCsv(rows: unknown[][]): string {
  return rows.map(row => row.map(csvCell).join(';')).join('\r\n');
}

/** Downloads rows as a CSV file; the BOM makes Excel read accents correctly. */
export function downloadCsv(filename: string, rows: unknown[][]): void {
  const url = URL.createObjectURL(new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
