import { describe, expect, it } from 'vitest';

// Phones on the shop Wi-Fi open the app over plain http://192.168.x.x, which is not a secure
// context: there `crypto.randomUUID` does not exist and a direct call throws on every tap.
const pages = import.meta.glob('./**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

describe('pages work on insecure LAN origins', () => {
  it('never call crypto.randomUUID() directly (use uniqueRestaurantId, which falls back)', () => {
    const offenders = Object.entries(pages)
      .filter(([path, source]) => !path.endsWith('.test.tsx') && /(?<!\?\.)\bcrypto\.randomUUID\(\)/.test(source))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
