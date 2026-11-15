const BILLS = [10000, 20000, 50000, 100000];

/** Cash amounts a customer is likely to hand over for this total (COP): next round amounts and bills that cover it. */
export function quickCashAmounts(total: number): number[] {
  if (!(total > 0)) return [];
  const roundUp = (step: number) => Math.ceil(total / step) * step;
  const candidates = [roundUp(1000), roundUp(5000), roundUp(50000), ...BILLS];
  return [...new Set(candidates)]
    .filter(amount => amount > total)
    .sort((a, b) => a - b)
    .slice(0, 4);
}
