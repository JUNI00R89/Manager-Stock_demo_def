#!/usr/bin/env bash
# Linux/macOS version of PREPARAR_BACKEND.bat: creates .venv and installs the backend dependencies.
set -euo pipefail
cd "$(dirname "$0")"
unset PYTHONHOME PYTHONPATH

echo "============================================"
echo "  MANAGER STOCK - PREPARAR BACKEND PYTHON"
echo "============================================"

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: no se encontró python3. Instala Python 3.11 o superior (por ejemplo: sudo apt install python3 python3-venv)."
  exit 1
fi

if [ ! -x ".venv/bin/python" ]; then
  echo "Creando el entorno virtual del proyecto..."
  python3 -m venv .venv || { echo "ERROR: no se pudo crear .venv. En Ubuntu/Debian instala python3-venv."; exit 1; }
fi

if ! .venv/bin/python -c "import fastapi, uvicorn, httpx, openpyxl" >/dev/null 2>&1; then
  echo "Instalando o reparando las dependencias del backend..."
  .venv/bin/python -m pip install -r backend/requirements.txt
fi

echo "Entorno listo. Las dependencias del backend están disponibles."
