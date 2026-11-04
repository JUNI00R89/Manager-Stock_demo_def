# App de escritorio · estado del trabajo

**Fecha:** 22 de octubre de 2026  
**Objetivo:** convertir Manager Stock en una app de escritorio instalable, **sin FastAPI**, con credenciales demo embebidas y datos locales.

---

## 1. Decisión de arquitectura

- **Electron** envuelve el frontend ya compilado (`dist/`). No arranca Python ni ningún servidor de API.
- Electron sirve la interfaz desde un servidor HTTP interno en `http://127.0.0.1:41731` (puerto fijo para que `localStorage` conserve los datos entre sesiones).
- El modo local se activa con `VITE_DESKTOP=1` en la compilación (`vite build --mode desktop`) o con el puente `window.managerStockDesktop` que expone el preload de Electron.
- Los datos demo se guardan **por negocio** en `localStorage`, con claves como `manager_stock_database_v1:DEMO-HOTEL-001`. Así se puede entrar como hotel, comidas, tienda, bodega o servicios sin mezclar registros.
- El backend web y el modo web siguen funcionando igual; los cambios de escritorio son ramas condicionadas por `isDesktopMode()`.

---

## 2. Qué quedó implementado

### Frontend

| Archivo | Cambio |
|---|---|
| `src/app/services/desktop.ts` | Núcleo del modo local: carga del seed, login/registro, configuración, base local por negocio, habitaciones, reservas, servicios, usuarios, roles, suscripción, plataforma y soporte. |
| `src/app/services/dataService.ts` | `api()` no llama a la red en escritorio; `apiIsAvailable()` devuelve `false`; los respaldos locales se permiten con sesión iniciada; autenticación, configuración, categorías, hotel, servicios, usuarios, plataforma y soporte tienen rama local. |
| `src/app/pages/Login.tsx` | Panel **Modo escritorio** con botones de acceso directo para las 6 cuentas demo. |
| `src/app/components/Layout.tsx` | Insignia **Modo escritorio local**; el stock bajo se calcula también sin API. |

### Electron

| Archivo | Función |
|---|---|
| `desktop/main.cjs` | Ventana, servidor estático con fallback de SPA, menú, enlaces externos, instancia única, cierre del servidor y modo smoke test. |
| `desktop/preload.cjs` | Expone `managerStockDesktop` de forma segura (`contextBridge`). |
| `desktop/prepare.mjs` | Copia `dist/` a `desktop/web/` antes de empaquetar. |
| `desktop/package.json` | Dependencias de Electron/electron-builder y configuración de instalador NSIS + portable. |
| `.env.desktop` | Activa `VITE_DESKTOP=1` al compilar con `--mode desktop`. |

### Datos

| Archivo | Función |
|---|---|
| `public/desktop-seed.json` | Snapshot de **1,41 MB** con 5 negocios, 11 usuarios y ~1.055 ventas. Generado desde la API local. |
| `scripts/generate_desktop_seed.py` | Regenera el snapshot. Requiere la API en `http://127.0.0.1:8000`. |

---

## 3. Verificado hasta ahora

- `node node_modules\typescript\bin\tsc --noEmit -p tsconfig.json` → **sin errores**.
- `npm.cmd run desktop:prepare` → compila y copia a `desktop/web/` correctamente.
- Prueba en navegador sobre la compilación de escritorio (`http://127.0.0.1:4180`):
  - El panel de cuentas demo aparece en el login.
  - Entrar como **Hotel Senderos** funciona con un clic.
  - Dashboard carga datos reales del seed: ingresos de hoy, proyección 7/30 días, ocupación proxy y plan anti-pérdidas.
  - `localStorage` contiene:
    - `manager_stock_database_v1:DEMO-HOTEL-001` (~326 KB)
    - `manager_stock_desktop_rooms_v1:DEMO-HOTEL-001`
    - sesión local y token
  - **0 errores en consola.**

> El servidor de vista previa usado para la prueba puede seguir activo en `http://127.0.0.1:4180` (proceso en segundo plano).

---

## 4. Pendiente para la próxima sesión

1. **Probar pestañas del plan anti-pérdidas** en la compilación de escritorio:
   - `Combos`: ancla, combo sugerido, combos posibles, margen.
   - `Ciencia de datos`: Pareto, afinidad, volatilidad, tabla ABC/XYZ/EOQ.
2. **Probar una venta en POS** en modo escritorio y recargar para confirmar que persiste en `localStorage`.
3. **Probar Habitaciones/Reservas del hotel** (lectura y creación local).
4. **Probar logout → login con otro negocio** (p. ej. Sabores del Parque) y verificar que usa otra clave de base local.
5. **Probar el panel SUPERADMIN** (debe mostrar los 5 negocios derivados del seed).
6. **Probar el registro local** (`/register` → configuración inicial).
7. **Lanzar Electron de verdad**:
   ```powershell
   npm.cmd --prefix desktop start
   ```
8. **Smoke test de Electron con captura** (opcional):
   ```powershell
   $env:MANAGER_STOCK_SMOKE="C:\Users\Sena\Downloads\demo_fusion\desktop\smoke.png"
   $env:MANAGER_STOCK_SMOKE_LOGIN="1"
   npm.cmd --prefix desktop start
   ```
9. **Construir el instalador**:
   ```powershell
   npm.cmd run desktop:build
   ```
   Salida esperada en `desktop/release/` (NSIS + portable). Aún **no ejecutado**; puede requerir descarga de recursos de electron-builder.
10. **Actualizar `README.md`** con las instrucciones de escritorio y la advertencia de credenciales embebidas.

---

## 5. Comandos útiles

```powershell
# 1) Regenerar datos demo (requiere backend en 8000)
.venv\Scripts\python.exe scripts\generate_desktop_seed.py

# 2) Compilar interfaz en modo escritorio y copiarla a desktop/web
npm.cmd run desktop:prepare

# 3) Abrir la app Electron
npm.cmd --prefix desktop start

# 4) Instalar dependencias de escritorio (ya hecho)
npm.cmd --prefix desktop install --no-audit --no-fund

# 5) Crear instalador
npm.cmd run desktop:build

# 6) Ver la compilación de escritorio en el navegador (sin Electron)
node node_modules\vite\bin\vite.js preview --host 127.0.0.1 --port 4180 --strictPort
```

---

## 6. Credenciales demo embebidas

| Negocio | Correo | Contraseña |
|---|---|---|
| Hotel Senderos | `owner.hotel@managerstock.test` | `HotelDemo2026!` |
| Sabores del Parque | `owner.comidas@managerstock.test` | `ComidasDemo2026!` |
| Tienda Aurora | `owner.retail@managerstock.test` | `TiendaDemo2026!` |
| Logística Norte | `owner.bodega@managerstock.test` | `BodegaDemo2026!` |
| Estudio Nube | `owner.servicios@managerstock.test` | `ServiciosDemo2026!` |
| Plataforma | `superadmin@managerstock.test` | `SuperAdminDemo2026!` |

Los empleados demo usan la contraseña `EmpleadoDemo2026!`.

> **Advertencia:** las credenciales están en texto plano dentro del paquete. Es aceptable para una demo local, **no** para producción. En producción habría que volver al backend o usar un almacén seguro.

---

## 7. Notas técnicas y riesgos conocidos

- **Puerto fijo 41731:** si está ocupado, Electron intenta 41731–41735. Si cambia de puerto, el origen de `localStorage` cambia y la app parecerá tener datos nuevos. Para la demo se asume que 41731 está libre.
- **El seed se genera desde la API:** si la base SQLite cambia, hay que regenerar `public/desktop-seed.json` y volver a compilar.
- **Datos por negocio:** entrar con otra cuenta no borra la base anterior; se conserva bajo su propia clave.
- **El warehouse (Logística Norte) no tiene ventas en el seed:** la API bloquea `/sales` porque su POS está desactivado. Es el comportamiento actual del negocio, no un fallo del modo escritorio.
- **La configuración de Sabores del Parque y Tienda Aurora viene del negocio tal como está en la base** (incluidos sus tipos actuales). No se corrigió para no alterar el comportamiento existente.
- **`package-lock.json` raíz:** no se modificó desde este trabajo; Electron se instaló en `desktop/` con su propio lock. El cambio que ya tenías en la raíz sigue ahí.
- **`desktop/web/` y `desktop/release/` están ignorados** en `.gitignore`; `desktop/package-lock.json` sí se puede versionar.

---

## 8. Estado de Git

- Modificados: `.gitignore`, `package.json`, `src/app/services/dataService.ts`, `src/app/pages/Login.tsx`, `src/app/components/Layout.tsx` (además de los cambios previos del rediseño y la analítica).
- Nuevos: `desktop/`, `src/app/services/desktop.ts`, `public/desktop-seed.json`, `scripts/generate_desktop_seed.py`, `.env.desktop`, este documento.
- Sin commitear.

**Para retomar:** leer este archivo y continuar por la lista de la sección 4.
