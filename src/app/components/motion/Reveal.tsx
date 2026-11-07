import { type ReactNode } from 'react';
import { motion, useReducedMotion, type Variants } from 'motion/react';

/**
 * Variantes de entrada compartidas por toda la aplicación.
 * hidden → show: opacity 0→1 y y 12→0. Sin blur: animar el filtro sobre
 * páginas llenas de tarjetas con backdrop-filter provocaba artifacts de
 * composición (tarjetas borrosas o cortadas a mitad de la transición).
 * Se reutilizan en el contenedor de páginas (AppShell) y pueden usarse en
 * cualquier bloque con <Reveal> / <RevealGroup> / <RevealItem>.
 */
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const revealVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: EASE_OUT },
  },
};

/** Contenedor con staggerChildren 0.08 (topado a los ~12 primeros bloques). */
export const revealContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.02 } },
};

/** Salida al cambiar de ruta: fade + desplazamiento corto (~0.3 s). */
export const pageExit = {
  opacity: 0,
  y: 8,
  transition: { duration: 0.25, ease: EASE_OUT },
};

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Retardo extra antes de entrar (segundos). */
  delay?: number;
  /** Duración de la entrada (segundos). */
  duration?: number;
}

/** Bloque que entra con fade + desplazamiento corto. */
export function Reveal({ children, className, delay = 0, duration = 0.6 }: RevealProps) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.div>
  );
}

interface RevealGroupProps {
  children: ReactNode;
  className?: string;
  /** Retardo antes de que arranque el escalonado (segundos). */
  delayChildren?: number;
}

/** Contenedor que escalona la entrada de sus <RevealItem> hijos. */
export function RevealGroup({ children, className, delayChildren = 0 }: RevealGroupProps) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      variants={revealContainer}
      initial="hidden"
      animate="show"
      transition={{ delayChildren }}
    >
      {children}
    </motion.div>
  );
}

/** Hijo de <RevealGroup>: hereda el escalonado del contenedor. */
export function RevealItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} variants={revealVariants}>
      {children}
    </motion.div>
  );
}
