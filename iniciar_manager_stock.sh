#!/usr/bin/env bash
# Linux/macOS version of INICIAR_MANAGER_STOCK.bat: starts the API and the web interface.
# Set LAN=1 to open it to phones on the same Wi-Fi (like INICIAR_MANAGER_STOCK_LAN.bat).
set -euo pipefail
cd "$(dirname "$0")"

./preparar_backend.sh
command -v npm >/dev/null 2>&1 || { echo "ERROR: no se encontró npm. Instala Node.js LTS."; exit 1; }
[ -f node_modules/vite/bin/vite.js ] || npm install

HOST=127.0.0.1
if [ "${LAN:-0}" = "1" ]; then
  HOST=0.0.0.0
  export MANAGER_STOCK_ALLOW_LAN=1
fi

.venv/bin/python -m uvicorn backend.main:app --reload --host "$HOST" --port 8000 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null' EXIT INT TERM

echo "Interfaz: http://$HOST:5173/   API: http://$HOST:8000/docs   (Ctrl+C para cerrar ambas)"
npx vite --host "$HOST" --port 5173
