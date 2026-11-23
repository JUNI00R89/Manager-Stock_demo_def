import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDesktopMode } from './desktop';

const bridge = window as unknown as { managerStockDesktop?: { isDesktop?: boolean } };

describe('isDesktopMode', () => {
  afterEach(() => {
    delete bridge.managerStockDesktop;
    vi.unstubAllEnvs();
  });

  it('la app de escritorio sin servidor trabaja en modo local', () => {
    bridge.managerStockDesktop = { isDesktop: true };
    expect(isDesktopMode()).toBe(true);
  });

  it('la app de escritorio compilada para la nube usa el servidor, no el modo local', () => {
    bridge.managerStockDesktop = { isDesktop: true };
    vi.stubEnv('VITE_DESKTOP_CONNECTED', '1');
    expect(isDesktopMode()).toBe(false);
  });
});
