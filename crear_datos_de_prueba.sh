#!/usr/bin/env bash
# Linux/macOS version of CREAR_DATOS_DE_PRUEBA.bat.
set -euo pipefail
cd "$(dirname "$0")"
if [ "${MANAGER_STOCK_ENV:-}" = "production" ] || [ "${APP_ENV:-}" = "production" ]; then
  echo "ERROR: el seed de demostración no se puede ejecutar en producción."
  exit 1
fi
./preparar_backend.sh
.venv/bin/python scripts/seed_demo_data.py --allow-demo-data
echo "Consulta docs/USUARIOS_DE_PRUEBA.md para las credenciales iniciales."
