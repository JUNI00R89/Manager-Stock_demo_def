# Ejercicio: app de escritorio conectada a la nube (Render, plan gratis)

Objetivo: que la app de escritorio deje el **"Modo escritorio local"**, muestre **"Base de datos conectada"** y que dos computadores vean los mismos datos.

> **Importante del plan gratis de Render**
> - No tiene disco persistente: **los datos se borran** cada vez que el servidor se reinicia, se actualiza o se duerme.
> - Se duerme tras **15 minutos sin uso**; la primera petición después tarda ~1 minuto en despertarlo.
> - La cuenta superadmin se vuelve a crear sola en cada arranque (con las variables de entorno), así que siempre puedes entrar.
> - Para vender de verdad: plan pago con disco montado en `/data` (el código no cambia).

---

## Parte 1 · Publicar el servidor (lo haces tú, ~10 minutos)

1. Entra a <https://render.com> y crea la cuenta con **"Sign up with GitHub"** (no pide tarjeta para el plan gratis).
2. Autoriza a Render a ver el repositorio `Manager-Stock_demo_def`.
3. En el panel: **New + → Blueprint**. Elige el repositorio y la rama **`feat/nube-render`**.
   Es un ejercicio: esta rama **no se fusiona** con `main`; Render la publica directamente.
4. Render lee `render.yaml` y te pide dos valores (no se guardan en GitHub):
   - `MANAGER_STOCK_SUPERADMIN_EMAIL`: el correo con el que entrarás como superadmin.
   - `MANAGER_STOCK_SUPERADMIN_PASSWORD`: una contraseña fuerte (mínimo 8 caracteres, letras y números).
5. **Apply / Deploy**. La primera construcción tarda unos 3–5 minutos.
6. Cuando diga **Live**, copia la dirección del servicio, por ejemplo `https://manager-stock-api.onrender.com`.
7. Comprueba en el navegador: `https://TU-DIRECCION.onrender.com/api/health` debe responder `{"status":"ok", ...}`.

## Parte 2 · Compilar la app de escritorio conectada

1. Abre el archivo **`.env.nube`** (raíz del proyecto) y cambia la dirección por la tuya, terminando en `/api`:

   ```
   VITE_API_URL=https://manager-stock-api.onrender.com/api
   VITE_DESKTOP_CONNECTED=1
   ```

   Si dejas la dirección de ejemplo, la compilación se detiene con un mensaje que lo explica.

2. Compila el instalador:

   ```powershell
   npm run desktop:build:nube
   ```

3. Resultado: `release/Manager-Stock-Nube-Setup-2.0.0.exe`.
   Usa el mismo identificador de la app local, así que al instalarlo **reemplaza** la versión local en ese PC.
   La versión local (demo sin Internet) se sigue compilando con `npm run desktop:build`.

## Parte 3 · Probar desde dos computadores

1. Instala `Manager-Stock-Nube-Setup-2.0.0.exe` en el PC 1 y en el PC 2.
2. En el PC 1 abre la app: arriba debe decir **"Base de datos conectada"**.
3. Regístrate como dueño de un negocio (o entra con el superadmin) y configura el negocio.
4. Crea un producto y haz una venta.
5. En el PC 2 entra con la misma cuenta: el producto y la venta deben aparecer.
6. Prueba algo que antes estaba apagado en escritorio: **fiado** en Clientes o **adicionales** en un negocio de comidas.

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| La app tarda ~1 minuto en entrar | El servidor gratis estaba dormido; espera y reintenta. |
| "No se pudo conectar" | La dirección de `.env.nube` está mal o no termina en `/api`; recompila. |
| Mis datos desaparecieron | Normal en el plan gratis: el servidor se reinició. |
| El superadmin no entra | Revisa en Render → Environment el correo y la contraseña; luego **Manual Deploy**. |

## Qué cambió en el código

- `Dockerfile`, `.dockerignore`, `render.yaml`: servidor FastAPI en un contenedor; la base vive en `/data/manager_stock.db`.
- `backend/main.py` → `ensure_env_superadmin()`: crea el superadmin desde `MANAGER_STOCK_SUPERADMIN_EMAIL` / `_PASSWORD` / `_NAME`; nunca lo duplica ni cambia una contraseña existente.
- `src/app/services/desktop.ts`: con `VITE_DESKTOP_CONNECTED=1` la app de escritorio usa el servidor en vez del modo local.
- `vite.config.ts`: la compilación `--mode nube` exige una dirección `https://…/api` real.
- `package.json` → script `desktop:build:nube`.
