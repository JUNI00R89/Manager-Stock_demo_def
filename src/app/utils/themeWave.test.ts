import { describe, expect, it } from 'vitest';
import { waveFrames } from './themeWave';

const points = (clipPath: string) =>
  clipPath
    .replace(/^polygon\(|\)$/g, '')
    .split(',')
    .map(pair =>
      pair
        .trim()
        .split(/\s+/)
        .map(v => parseFloat(v)),
    );

describe('waveFrames', () => {
  const origin = { x: 1200, y: 30 };
  const frames = waveFrames(origin, 1360, 768);

  it('todas las formas tienen el mismo número de puntos, para que el navegador las interpole', () => {
    const counts = new Set(frames.map(f => points(f.clipPath).length));
    expect(counts.size).toBe(1);
    expect(frames.length).toBeGreaterThanOrEqual(8);
  });

  it('empieza diminuta junto al botón y termina cubriendo toda la pantalla', () => {
    const first = points(frames[0].clipPath);
    expect(Math.max(...first.map(([x, y]) => Math.hypot(x - origin.x, y - origin.y)))).toBeLessThan(5);

    // The farthest corner from the button (bottom-left) must be inside the last shape.
    const farthest = Math.hypot(origin.x - 0, origin.y - 768);
    const last = points(frames[frames.length - 1].clipPath);
    expect(Math.min(...last.map(([x, y]) => Math.hypot(x - origin.x, y - origin.y)))).toBeGreaterThan(farthest);
  });

  it('el borde ondula mientras avanza (no es un círculo perfecto)', () => {
    const middle = points(frames[Math.floor(frames.length / 2)].clipPath).map(([x, y]) =>
      Math.hypot(x - origin.x, y - origin.y),
    );
    expect(Math.max(...middle) / Math.min(...middle)).toBeGreaterThan(1.05);
  });
});
