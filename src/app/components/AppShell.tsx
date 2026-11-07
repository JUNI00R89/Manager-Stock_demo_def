import { useLocation, useOutlet } from 'react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { LayoutChromeHost } from './Layout';
import { EASE_OUT, pageExit } from './motion/Reveal';

/**
 * Marco persistente de la aplicación.
 *
 * Cada página monta su propio <Layout>, pero dentro de este shell ese Layout es
 * transparente: la sidebar y el header se montan una única vez durante toda la
 * sesión. Gracias a eso los indicadores deslizantes conservan la continuidad al
 * navegar y el contenido puede animar su salida y su entrada
 * (AnimatePresence mode="wait") sin volver a montar el marco.
 *
 * Las URLs, los permisos y la lógica de cada pantalla no cambian.
 */
export function AppShell() {
  const location = useLocation();
  const outlet = useOutlet();
  const reduceMotion = useReducedMotion();

  return (
    <LayoutChromeHost>
      {reduceMotion ? (
        outlet
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={pageExit}
            transition={{ duration: 0.5, ease: EASE_OUT }}
          >
            {outlet}
          </motion.div>
        </AnimatePresence>
      )}
    </LayoutChromeHost>
  );
}
