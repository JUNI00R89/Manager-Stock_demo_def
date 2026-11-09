import { createContext, useCallback, useContext, useLayoutEffect, useState, type ReactNode } from 'react';

export type DesignMode = 'editorial' | 'classic';

interface DesignModeContextType {
  designMode: DesignMode;
  setDesignMode: (mode: DesignMode) => void;
  isEditorial: boolean;
}

const STORAGE_KEY = 'designMode';
const DesignModeContext = createContext<DesignModeContextType | undefined>(undefined);

function readStoredDesignMode(): DesignMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'classic' ? 'classic' : 'editorial';
  } catch {
    return 'editorial';
  }
}

/**
 * Preferencia visual por dispositivo. El modo editorial se aplica al marco
 * autenticado y a las pantallas de configuración/suspensión; el modo clásico
 * restaura el diseño original sin modificar ninguna regla base.
 */
export function DesignModeProvider({ children }: { children: ReactNode }) {
  const [designMode, setDesignModeState] = useState<DesignMode>(readStoredDesignMode);

  const setDesignMode = useCallback((mode: DesignMode) => {
    setDesignModeState(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // La preferencia es local; si el navegador bloquea el almacenamiento,
      // el cambio sigue funcionando durante la sesión actual.
    }
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.design = designMode;
  }, [designMode]);

  return (
    <DesignModeContext.Provider value={{ designMode, setDesignMode, isEditorial: designMode === 'editorial' }}>
      {children}
    </DesignModeContext.Provider>
  );
}

export function useDesignMode() {
  const context = useContext(DesignModeContext);
  if (!context) throw new Error('useDesignMode must be used within DesignModeProvider');
  return context;
}
