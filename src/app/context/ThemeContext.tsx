import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, ReactNode } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/** Duración del fundido de color al cambiar de tema (ms). */
const THEME_TRANSITION_MS = 180;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const themeRef = useRef(theme);
  const transitionTimer = useRef<number | null>(null);

  /**
   * Aplica el modo de forma sincrónica. La clase de transición se añade antes
   * de tocar `.dark`, así el fundido de colores sí alcanza a pintarse; al
   * quitarla, los cambios de color vuelven a ser instantáneos (hovers, avisos,
   * etc.). Es la animación mínima que reemplaza al antiguo barrido orgánico.
   */
  const applyThemeMode = useCallback((next: Theme, animate: boolean) => {
    const root = document.documentElement;
    if (transitionTimer.current !== null) {
      window.clearTimeout(transitionTimer.current);
      transitionTimer.current = null;
    }
    if (animate) {
      root.classList.add('theme-transitioning');
      transitionTimer.current = window.setTimeout(() => {
        root.classList.remove('theme-transitioning');
        transitionTimer.current = null;
      }, THEME_TRANSITION_MS + 40);
    }
    root.classList.toggle('dark', next === 'dark');
    localStorage.setItem('theme', next);
  }, []);

  const setTheme = useCallback(
    (next: Theme) => {
      if (themeRef.current === next) return;
      themeRef.current = next;
      applyThemeMode(next, true);
      setThemeState(next);
    },
    [applyThemeMode],
  );

  // Sincroniza el tema guardado antes del primer pintado, sin animación.
  useLayoutEffect(() => {
    applyThemeMode(themeRef.current, false);
    return () => {
      if (transitionTimer.current !== null) {
        window.clearTimeout(transitionTimer.current);
        transitionTimer.current = null;
      }
    };
  }, [applyThemeMode]);

  // La opción "Cambiar estilo" (clásico/malla) ya no existe. Limpiamos cualquier
  // rastro guardado de versiones anteriores para que no quede una clase pegada.
  useEffect(() => {
    document.documentElement.classList.remove('theme-mesh');
    localStorage.removeItem('themeStyle');
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(themeRef.current === 'light' ? 'dark' : 'light');
  }, [setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, isDark: theme === 'dark' }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
