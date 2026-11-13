import { defineConfig } from 'vitest/config'
import path from 'path'
import react from '@vitejs/plugin-react'

// Node 22+ trae su propio `localStorage` global; sin `--localstorage-file` queda
// vacío (undefined en Node 25+) y tapa el de jsdom. Se desactiva en los procesos
// de prueba para que jsdom provea el almacenamiento, como en el navegador.
const nodeMajor = Number(process.versions.node.split('.')[0])
const execArgv = nodeMajor >= 22 ? ['--no-experimental-webstorage'] : []

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
    poolOptions: {
      forks: { execArgv },
      threads: { execArgv },
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/test/**', 'src/**/*.d.ts'],
    },
  },
})
