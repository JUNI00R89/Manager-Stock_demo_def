import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '..', 'dist');
const target = path.join(here, 'web');

if (!fs.existsSync(path.join(source, 'index.html'))) {
  console.error('No existe dist/index.html. Ejecuta primero: npm run build o vite build --mode desktop');
  process.exit(1);
}
if (!fs.existsSync(path.join(source, 'desktop-seed.json'))) {
  console.error('No existe dist/desktop-seed.json. Ejecuta scripts/generate_desktop_seed.py y vuelve a compilar.');
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });
console.log(`Interfaz copiada a ${target}`);
