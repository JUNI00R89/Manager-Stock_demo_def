"""Permite ejecutar los scripts de prueba del backend con `pytest`.

Cada `test_*.py` es un script independiente: fija `MANAGER_STOCK_DB` hacia una
base temporal *antes* de importar la API y ejecuta `run()` (o código suelto)
al lanzarse con `python archivo.py`. Como la configuración se lee al importar,
no pueden compartir un mismo proceso; por eso cada script se ejecuta como un
ítem de pytest en su propio subproceso, igual que si se lanzara a mano.

Las pruebas de navegador (`*_browser.py`) necesitan Playwright, Chromium, Vite
y la API en marcha; solo se ejecutan con `MANAGER_STOCK_E2E=1` (ver README).
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT_TIMEOUT_SECONDS = 600


def _is_script(file_path: Path) -> bool:
    return file_path.suffix == ".py" and file_path.name.startswith("test_") and file_path.parent == Path(__file__).parent


def pytest_collect_file(parent, file_path: Path):
    if _is_script(file_path):
        return ScriptFile.from_parent(parent, path=file_path)
    return None


def pytest_pycollect_makemodule(module_path: Path, parent):
    # Nunca importar los scripts dentro del proceso de pytest (p. ej. al pasar
    # un archivo por línea de comandos): importarlos cambia la base de datos
    # y las pruebas de navegador se ejecutarían al importarse.
    if _is_script(module_path):
        return _NoImportModule.from_parent(parent, path=module_path)
    return None


class _NoImportModule(pytest.Module):
    def collect(self):
        return []


class ScriptFile(pytest.File):
    def collect(self):
        yield ScriptItem.from_parent(self, name=self.path.stem)


class ScriptItem(pytest.Item):
    def runtest(self):
        if self.path.stem.endswith("_browser") and os.getenv("MANAGER_STOCK_E2E") != "1":
            pytest.skip("Prueba de navegador: define MANAGER_STOCK_E2E=1 con Vite y la API en marcha.")
        env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
        result = subprocess.run(
            [sys.executable, str(self.path)],
            cwd=ROOT, env=env, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=SCRIPT_TIMEOUT_SECONDS,
        )
        if result.returncode != 0:
            raise ScriptFailed(result)

    def repr_failure(self, excinfo):
        if isinstance(excinfo.value, ScriptFailed):
            r = excinfo.value.result
            return f"El script terminó con código {r.returncode}\n--- stdout ---\n{r.stdout[-4000:]}\n--- stderr ---\n{r.stderr[-4000:]}"
        return super().repr_failure(excinfo)

    def reportinfo(self):
        return self.path, None, f"script {self.path.name}"


class ScriptFailed(Exception):
    def __init__(self, result: subprocess.CompletedProcess):
        super().__init__(result.returncode)
        self.result = result
