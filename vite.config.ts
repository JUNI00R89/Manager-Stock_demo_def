import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'


function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

// La app de escritorio "nube" sin dirección real abriría una app que no conecta a nada: mejor fallar al compilar.
function assertCloudApiUrl(mode: string) {
  if (mode !== 'nube' && mode !== 'android') return
  const url = loadEnv(mode, __dirname, 'VITE_').VITE_API_URL || ''
  if (!/^https:\/\/[^/]+\/api$/.test(url) || url.includes('TU-SERVICIO'))
    throw new Error(`Pon en .env.${mode} la dirección real del servidor, por ejemplo https://manager-stock.onrender.com/api (ahora: "${url}").`)
}

export default defineConfig(({ mode }) => (assertCloudApiUrl(mode), {
  plugins: [
    figmaAssetResolver(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
}))
