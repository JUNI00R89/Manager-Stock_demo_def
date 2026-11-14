#!/usr/bin/env bash
# Linux/macOS version of CREAR_SUPERADMIN.bat.
set -euo pipefail
cd "$(dirname "$0")"
./preparar_backend.sh
.venv/bin/python scripts/create_superadmin.py
