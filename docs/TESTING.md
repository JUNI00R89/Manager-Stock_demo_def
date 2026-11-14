# Pruebas del frontend

El frontend usa **Vitest** con **jsdom** y **Testing Library**. La configuración vive en `vitest.config.ts` y el setup global en `src/test/setup.ts`.

## Comandos

```bash
npm test              # ejecuta toda la suite una vez
npm run test:watch    # modo interactivo
npm run test:coverage # ejecuta y genera el reporte de cobertura
```

El reporte de cobertura se genera en `coverage/` y está excluido de Git.

Con Node 22 o posterior, `vitest.config.ts` arranca los procesos de prueba con
`--no-experimental-webstorage`: el `localStorage` propio de Node (vacío sin
`--localstorage-file`) tapaba el de jsdom y hacía fallar las pruebas que lo usan.

# Pruebas del backend

Cada `backend/tests/test_*.py` es un script que crea su propia base SQLite
temporal. `backend/tests/conftest.py` los convierte en ítems de pytest y ejecuta
cada uno en un proceso aparte (la configuración de la base se lee al importar la
API, así que no pueden compartir proceso). Siguen funcionando sueltos con
`python backend/tests/test_x.py`.

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest           # toda la suite del backend
.\.venv\Scripts\python.exe -m pytest -k hotel  # solo las de hotel
```

## Pruebas de navegador (E2E)

`test_hotel_browser.py` y `test_hotel_local_browser.py` se saltan salvo que
`MANAGER_STOCK_E2E=1`. Necesitan:

1. Chromium de Playwright: `python -m playwright install chromium` (o `CHROMIUM_PATH` hacia otro Chromium).
2. La API en `127.0.0.1:8000` con una base **temporal** (`MANAGER_STOCK_DB`), porque crean negocios de prueba.
3. Vite en `127.0.0.1:5173` (`npm run dev`).

```powershell
$env:MANAGER_STOCK_DB = "$env:TEMP\hotel-ui-test.db"
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
# en otra terminal: npm run dev
# en otra terminal:
$env:MANAGER_STOCK_E2E = "1"; .\.venv\Scripts\python.exe -m pytest -k browser
```

## Cobertura actual

| Área | Archivo |
| --- | --- |
| Mensajes de error y errores de red | `src/app/utils/errors.test.ts` |
| Notificaciones con título + motivo | `src/app/utils/notifications.test.ts` |
| Permisos por rol, tipo de negocio y ruta | `src/app/security/permissions.test.ts` |
| Formatos de fechas, dinero y jornadas | `src/app/utils/restaurantFormat.test.ts` |
| Almacenamiento local por negocio | `src/app/utils/restaurantStorage.test.ts` |
| Proyección de ingresos y ocupación | `src/app/utils/revenueForecast.test.ts` |
| Canastas, combos y ciencia de inventario | `src/app/utils/commercialScience.test.ts` |
| Riesgo de productos y reposición | `src/app/utils/productRisk.test.ts` |
| Componentes base `Button` y `Badge` | `src/app/components/ui/*.test.tsx` |
| Preferencia local del diseño editorial/clásico | `src/app/context/DesignModeContext.test.tsx` |

## Regresión encontrada

Al agregar las pruebas se detectó que `salesWindowStats` no incluía las ventas del día actual en la serie diaria: la ventana terminaba ayer. Eso afectaba la demanda promedio, el stock de seguridad, el EOQ y la clasificación XYZ. Se corrigió en `src/app/utils/commercialScience.ts` y se agregó una prueba de regresión.

## Próximos pasos recomendados

1. Probar `dataService.ts` con `fetch` simulado: errores HTTP, tokens y modo desktop.
2. Probar componentes con contexto: login, POS, mesero y panel de plataforma.
3. Agregar pruebas de integración para flujos críticos de ventas y pedidos.
4. Ampliar las pruebas de navegador con Playwright (hoy solo cubren hotel).
5. Usar la cobertura como guía, no como objetivo: priorizar rutas de dinero, permisos y datos.
