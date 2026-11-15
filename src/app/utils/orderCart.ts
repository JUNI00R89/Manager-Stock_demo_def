/**
 * Line of the same product that a new unit can join: only one without a kitchen note.
 * A product whose lines all carry notes gets a new line, so "1 hamburguesa sin cebolla
 * + 1 normal" stays two separate lines on the order.
 */
export function mergeableLine<T extends { productId: string }>(
  lines: T[],
  productId: string,
  noteOf: (line: T) => string,
): T | undefined {
  return lines.find(line => line.productId === productId && !noteOf(line).trim());
}
