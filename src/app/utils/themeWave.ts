/**
 * Theme switch as a wave: the new theme spreads from the toggle button with a softly rippling edge
 * (an organic, "venom"-like growth) until it covers the screen.
 *
 * It uses the View Transitions API: the browser snapshots the page before and after the switch and we
 * reveal the new snapshot with an animated clip-path. Without that API, or with "reduce motion", the
 * theme simply switches. Kept light on purpose (no tentacles, no overlay layers): an earlier organic
 * sweep was removed for feeling heavy.
 */

const POINTS = 72;
const STEPS = 14;
const DURATION_MS = 700;

type Origin = { x: number; y: number };

// Slow start at the button, fast through the middle, gentle landing: reads as a wave, not a jump.
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/** Keyframes of the expanding shape. Every frame has the same number of points so the browser can interpolate them. */
export function waveFrames(origin: Origin, width: number, height: number): { clipPath: string; offset: number }[] {
  const farthest = Math.max(
    Math.hypot(origin.x, origin.y),
    Math.hypot(width - origin.x, origin.y),
    Math.hypot(origin.x, height - origin.y),
    Math.hypot(width - origin.x, height - origin.y),
  );
  // A little past the farthest corner, so the last frame covers everything even before the edge settles.
  const cover = farthest * 1.18;
  return Array.from({ length: STEPS }, (_, step) => {
    const t = step / (STEPS - 1);
    const radius = cover * easeInOut(t);
    // The ripple grows mid-way and fades out at both ends: tiny dot at the start, full cover at the end.
    const amplitude = 0.12 * Math.sin(Math.PI * t);
    const flow = t * 5;
    const points = Array.from({ length: POINTS }, (_, i) => {
      const angle = (i / POINTS) * Math.PI * 2;
      const ripple = 0.6 * Math.sin(5 * angle + flow) + 0.4 * Math.sin(9 * angle - flow * 1.4);
      const r = radius * (1 + amplitude * ripple);
      return `${(origin.x + r * Math.cos(angle)).toFixed(1)}px ${(origin.y + r * Math.sin(angle)).toFixed(1)}px`;
    });
    return { clipPath: `polygon(${points.join(', ')})`, offset: t };
  });
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void> };
};

/** Runs `apply` (which must switch the theme synchronously) behind the wave reveal, starting at `origin`. */
export function switchThemeWithWave(origin: Origin | null, apply: () => void) {
  const doc = document as ViewTransitionDocument;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || reduceMotion) {
    apply();
    return;
  }
  const start = origin ?? { x: window.innerWidth - 48, y: 32 };
  const transition = doc.startViewTransition(apply);
  transition.ready
    .then(() => {
      document.documentElement.animate(waveFrames(start, window.innerWidth, window.innerHeight), {
        duration: DURATION_MS,
        easing: 'linear',
        pseudoElement: '::view-transition-new(root)',
      });
    })
    .catch(() => undefined);
}
