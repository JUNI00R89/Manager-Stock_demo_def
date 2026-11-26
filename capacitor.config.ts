import type { CapacitorConfig } from '@capacitor/cli';

// App de Android conectada al servidor de la nube (npm run android:sync).
const config: CapacitorConfig = {
  appId: 'com.managerstock.app',
  appName: 'Manager Stock',
  webDir: 'dist',
  server: {
    // Origen http://localhost: el servidor ya lo acepta en CORS (como la app de escritorio),
    // y Chromium lo trata como contexto seguro, así que la cámara del escáner sigue funcionando.
    androidScheme: 'http',
  },
};

export default config;
