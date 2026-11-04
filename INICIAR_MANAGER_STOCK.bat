@echo off
setlocal
cd /d "%~dp0"
set "PYTHONHOME="
set "PYTHONPATH="

echo ============================================
echo        MANAGER STOCK - INICIO LOCAL
echo ============================================

where py >nul 2>nul
if errorlevel 1 (
  echo ERROR: No se encontro Python Launcher ^(py^). Instala Python 3.11 o superior.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: No se encontro npm. Instala Node.js LTS.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Creando entorno virtual de Python...
  py -3 -m venv .venv
  if errorlevel 1 goto :error
)

".venv\Scripts\python.exe" -c "import fastapi, uvicorn, httpx, tzdata" >nul 2>nul
if errorlevel 1 (
  echo Instalando o reparando las dependencias del backend...
  ".venv\Scripts\python.exe" -m ensurepip --upgrade >nul 2>nul
  ".venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
  if errorlevel 1 goto :error
  ".venv\Scripts\python.exe" -c "import fastapi, uvicorn, httpx, tzdata" >nul 2>nul
  if errorlevel 1 goto :error
)
type nul > ".venv\manager_stock_deps.ok"

if not exist "node_modules\vite\bin\vite.js" (
  echo Instalando dependencias de la interfaz...
  call npm install
  if errorlevel 1 goto :error
)

start "Manager Stock API" /D "%~dp0" cmd /k ".venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000"
timeout /t 2 /nobreak >nul
start "Manager Stock Web" /D "%~dp0" cmd /k "npm run dev"
echo.
echo Se abrieron dos terminales. Espera a que ambas indiquen que iniciaron.
echo Interfaz: http://127.0.0.1:5173/
echo API:     http://127.0.0.1:8000/docs
echo.
pause
exit /b 0

:error
echo.
echo No se pudo completar la instalacion. Revisa el mensaje anterior y la conexion a internet.
pause
exit /b 1
