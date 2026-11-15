import { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'motion/react';

interface AnimatedCounterProps {
  /** Valor real (viene del estado o de la API). */
  value: number;
  /** Formatea el valor en curso, por ejemplo el helper money() de cada página. */
  format?: (value: number) => string;
  /** Duración de la cuenta en segundos. */
  duration?: number;
  /** Retardo antes de empezar a contar (segundos). */
  delay?: number;
  className?: string;
}

const EASE_COUNT: [number, number, number, number] = [0.16, 1, 0.3, 1];

/**
 * Contador animado: sube desde el valor anterior (0 en el primer montaje) hasta
 * `value` con ease-out. Si el valor cambia —por ejemplo cuando terminan de cargar
 * los datos— anima desde el valor que se está mostrando hasta el nuevo, nunca
 * desde cero. Con prefers-reduced-motion muestra el valor final de inmediato.
 */
export function AnimatedCounter({ value, format, duration = 1.2, delay = 0, className }: AnimatedCounterProps) {
  const target = Number.isFinite(value) ? value : 0;
  const reduceMotion = useReducedMotion();
  // Último valor pintado: es el punto de partida de la siguiente cuenta.
  const shown = useRef(reduceMotion ? target : 0);
  const [display, setDisplay] = useState(shown.current);

  useEffect(() => {
    if (reduceMotion) {
      shown.current = target;
      setDisplay(target);
      return;
    }
    const from = shown.current;
    if (from === target) return;
    const controls = animate(from, target, {
      duration,
      delay,
      ease: EASE_COUNT,
      onUpdate: latest => {
        shown.current = latest;
        setDisplay(latest);
      },
      onComplete: () => {
        shown.current = target;
        setDisplay(target);
      },
    });
    return () => controls.stop();
  }, [target, duration, delay, reduceMotion]);

  const text = format ? format(display) : Math.round(display).toLocaleString('es-CO');
  return <span className={className ? `num ${className}` : 'num'}>{text}</span>;
}
