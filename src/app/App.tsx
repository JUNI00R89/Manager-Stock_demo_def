import { RouterProvider } from 'react-router';
import { MotionConfig } from 'motion/react';
import { AuthProvider } from './context/AuthContext';
import { BusinessProvider } from './context/BusinessContext';
import { ThemeProvider } from './context/ThemeContext';
import { DesignModeProvider } from './context/DesignModeContext';
import { router } from './routes';
import { Toaster } from './components/ui/sonner';
import { AppErrorBoundary } from './components/AppErrorBoundary';

export default function App() {
  return (
    /* reducedMotion="user": con prefers-reduced-motion motion desactiva
       desplazamientos y transforms; el resto de la interfaz los respeta por su
       cuenta (ver Reveal, AppShell y AnimatedCounter). */
    <MotionConfig reducedMotion="user">
      <DesignModeProvider>
        <ThemeProvider>
          <AuthProvider>
            <BusinessProvider>
              <AppErrorBoundary><RouterProvider router={router} /></AppErrorBoundary>
              <Toaster position="top-right" richColors closeButton />
            </BusinessProvider>
          </AuthProvider>
        </ThemeProvider>
      </DesignModeProvider>
    </MotionConfig>
  );
}
