import '@testing-library/jest-dom/vitest'

// jsdom no implementa matchMedia; ThemeProvider y las animaciones lo consultan.
window.matchMedia ??= (query: string) => ({
  matches: false, media: query, onchange: null,
  addListener: () => {}, removeListener: () => {},
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
}) as MediaQueryList
