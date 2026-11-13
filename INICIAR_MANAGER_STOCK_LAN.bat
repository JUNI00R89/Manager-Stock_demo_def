@echo off
setlocal
cd /d "%~dp0"
set "PYTHONHOME="
set "PYTHONPATH="

echo ============================================
echo    MANAGER STOCK - MODO CELULAR (LAN)
echo ============================================
echo.

if not exist ".venv\Scripts\python.exe" (
  echo ERROR: No existe .venv. Ejecuta primero INICIAR_MANAGER_STOCK.bat
  pause
  exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
  echo ERROR: Faltan dependencias de la interfaz. Ejecuta: npm install
  pause
  exit /b 1
)

rem Permite que el navegador del celular llame a la API desde una IP privada.
set "MANAGER_STOCK_ALLOW_LAN=1"

rem IP de la red Wi-Fi para mostrar la direccion correcta.
set "LANIP="
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4" ^| findstr "192.168. 10. 172."') do (
  if not defined LANIP set "LANIP=%%a"
)
if defined LANIP set "LANIP=%LANIP: =%"

echo Iniciando backend (API) en 0.0.0.0:8000 ...
start "Manager Stock API (LAN)" /D "%~dp0" cmd /k ".venv\Scripts\python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8000"

timeout /t 3 /nobreak >nul

echo Iniciando emuladores Firebase + interfaz en 0.0.0.0:5173 ...
start "Manager Stock Web (LAN)" /D "%~dp0" cmd /k "npx.cmd firebase emulators:exec --project demo-manager-stock --only auth,firestore,functions ""node scripts/seed_firebase_emulator.mjs && npx.cmd vite --host 0.0.0.0 --port 5173"""

echo.
echo Se abrieron dos terminales. Espera a que ambas indiquen que iniciaron.
echo.
if defined LANIP (
  echo Desde el celular, en la misma red Wi-Fi:
  echo   App: http://%LANIP%:5173
  echo   API: http://%LANIP%:8000/api/health
) else (
  echo No se pudo detectar la IP de la red. Ejecuta ipconfig y usa la IPv4 de Wi-Fi.
)
echo.
echo Si el celular no carga, revisa el Firewall de Windows para los puertos 8000 y 5173.
echo.
pause
exit /b 0
