import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, type BezierDefinition } from 'motion/react';

interface ThemeSweepProps {
  /** Centro del botón de tema en coordenadas de viewport: desde ahí nace la forma. */
  origin: { x: number; y: number };
  /** Fondo del tema que entra: la forma lo usa para cubrir la pantalla. */
  color: string;
  /** Se llama cuando la forma cubre toda la pantalla (aquí se cambia el tema). */
  onCovered: () => Promise<void> | void;
  /** Se llama cuando la forma ya se desvaneció y se puede desmontar. */
  onDone: () => void;
}

/**
 * Tentáculos: lóbulos de la misma masa que salen disparados por delante de la
 * onda principal. Al ser del mismo color que la masa se leen como un solo
 * cuerpo viscoso que se estira. `reach` es fracción de la esquina más lejana,
 * `size` va en vmax y `delay` desfasa la salida de cada uno.
 */
const TENDRILS = [
  { reach: 0.55, size: 64, rotate: -22, delay: 0.01, duration: 0.34, radius: '58% 42% 63% 37% / 46% 58% 42% 54%' },
  { reach: 0.42, size: 46, rotate: 26, delay: 0.04, duration: 0.3, radius: '42% 58% 38% 62% / 60% 40% 56% 44%' },
  { reach: 0.62, size: 34, rotate: -34, delay: 0.07, duration: 0.4, radius: '64% 36% 48% 52% / 38% 62% 40% 60%' },
  { reach: 0.36, size: 54, rotate: 16, delay: 0.1, duration: 0.28, radius: '50% 50% 62% 38% / 55% 45% 58% 42%' },
  { reach: 0.5, size: 26, rotate: -14, delay: 0.13, duration: 0.32, radius: '46% 54% 40% 60% / 62% 38% 54% 46%' },
];

/** Estallido inicial y frenada suave: la masa brota de golpe y se asienta. */
const BURST_EASE: BezierDefinition = [0.2, 0.9, 0.25, 1];

/**
 * Barrido de tema: una masa orgánica (borde irregular, no un círculo perfecto)
 * brota desde el botón sol/luna junto con tentáculos que salen disparados,
 * cubre la pantalla, se cambia el tema debajo y finalmente la masa se retrae
 * y se desvanece dejando el nuevo tema a la vista.
 * Se monta en un portal para que el `fixed` no dependa de ancestros animados.
 */
export function ThemeSweep({ origin, color, onCovered, onDone }: ThemeSweepProps) {
  const [phase, setPhase] = useState<'cover' | 'reveal'>('cover');

  // Diagonal más larga desde el botón: le da a cada tentáculo su distancia real.
  const reach = Math.hypot(
    Math.max(origin.x, window.innerWidth - origin.x),
    Math.max(origin.y, window.innerHeight - origin.y),
  );

  return createPortal(
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[9999] overflow-hidden">
      {/* Tentáculos por delante, masa principal encima: al tener el mismo color
          se funden en un solo cuerpo viscoso. */}
      {TENDRILS.map((tendril, index) => {
        const angle = (index / TENDRILS.length) * Math.PI * 2 - Math.PI / 3;
        const distance = reach * tendril.reach;
        return (
          <motion.span
            key={index}
            className="absolute block"
            style={{
              width: `${tendril.size}vmax`,
              height: `${tendril.size}vmax`,
              left: origin.x,
              top: origin.y,
              marginLeft: `-${tendril.size / 2}vmax`,
              marginTop: `-${tendril.size / 2}vmax`,
              background: color,
              borderRadius: tendril.radius,
              willChange: 'transform, opacity',
            }}
            initial={{ scale: 0, x: 0, y: 0, rotate: 0, opacity: 1 }}
            animate={phase === 'cover'
              ? { scale: 1, x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, rotate: tendril.rotate, opacity: 1 }
              : { scale: 0.15, x: 0, y: 0, rotate: 0, opacity: 0 }}
            transition={phase === 'cover'
              ? { duration: tendril.duration, delay: tendril.delay, ease: BURST_EASE }
              : { duration: 0.22, delay: index * 0.02, ease: [0.4, 0, 1, 1] }}
          />
        );
      })}
      <motion.span
        className="absolute block"
        style={{
          width: '320vmax',
          height: '320vmax',
          left: origin.x,
          top: origin.y,
          marginLeft: '-160vmax',
          marginTop: '-160vmax',
          background: color,
          willChange: 'transform, opacity',
        }}
        initial={{ scale: 0, opacity: 1, borderRadius: '47% 53% 43% 57% / 51% 47% 53% 49%' }}
        animate={phase === 'cover'
          ? { scale: 1, opacity: 1, borderRadius: '56% 44% 58% 42% / 43% 57% 45% 55%' }
          : { scale: 0.92, opacity: 0, borderRadius: '50% 50% 50% 50% / 50% 50% 50% 50%' }}
        transition={phase === 'cover'
          ? { duration: 0.42, ease: BURST_EASE }
          : { duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
        onAnimationComplete={() => {
          if (phase === 'cover') {
            void Promise.resolve(onCovered()).then(() => setPhase('reveal'));
            return;
          }
          onDone();
        }}
      />
    </div>,
    document.body,
  );
}
