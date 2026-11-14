'use client';

import { Toaster as Sonner, ToasterProps } from 'sonner';
import { useTheme } from '../../context/ThemeContext';

const Toaster = ({ ...props }: ToasterProps) => {
  // El tema real de la aplicación vive en ThemeContext (aquí no hay provider de
  // next-themes), así las notificaciones siguen al tema claro/oscuro activo.
  const { theme } = useTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
