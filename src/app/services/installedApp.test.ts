import { afterEach, describe, expect, it, vi } from 'vitest';
import { isInstalledApp } from './desktop';

const win = window as unknown as {
  managerStockDesktop?: { isDesktop?: boolean };
  Capacitor?: { isNativePlatform?: () => boolean };
};

describe('isInstalledApp', () => {
  afterEach(() => {
    delete win.managerStockDesktop;
    delete win.Capacitor;
    vi.unstubAllEnvs();
  });

  it('en el navegador es la web (con landing)', () => {
    expect(isInstalledApp()).toBe(false);
  });

  it('la app de escritorio es app instalada, también la conectada a la nube', () => {
    win.managerStockDesktop = { isDesktop: true };
    vi.stubEnv('VITE_DESKTOP_CONNECTED', '1');
    expect(isInstalledApp()).toBe(true);
  });

  it('la app de Android (Capacitor) es app instalada', () => {
    win.Capacitor = { isNativePlatform: () => true };
    expect(isInstalledApp()).toBe(true);
  });
});
