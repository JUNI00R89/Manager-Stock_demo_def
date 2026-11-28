# App de Android conectada a la nube

Objetivo: la misma app de Manager Stock instalada en un celular Android, trabajando
contra el servidor de Render del ejercicio [`NUBE_RENDER.md`](NUBE_RENDER.md). El
celular, la app de escritorio y el navegador ven los mismos datos.

Se usa [Capacitor](https://capacitorjs.com) 8.6.0: empaqueta la app web ya compilada
dentro de una app nativa de Android (carpeta `android/`).

> Requisito: el servidor de Render publicado y en estado **Live** (Parte 1 de
> `NUBE_RENDER.md`). Las mismas limitaciones del plan gratis aplican: se duerme tras
> 15 minutos sin uso y borra los datos al reiniciarse.

## Instalar el APK ya compilado

1. Copia `app-debug.apk` al celular (cable USB, Drive o WhatsApp a ti mismo).
2. Ábrelo desde el celular. Android pedirá permitir **instalar apps de origen
   desconocido** para la app con la que lo abriste (Archivos, Chrome…): actívalo.
3. Instala y abre **Manager Stock**. Arriba debe decir **"Base de datos conectada"**.
4. Entra con la misma cuenta que usas en el PC: deben aparecer los mismos productos y ventas.

Es un APK de depuración (firmado con la llave de depuración): sirve para instalar y
probar, no para publicar en Google Play.

## Compilar el APK

### Dirección del servidor

`.env.android` (raíz del proyecto) lleva la dirección de Render terminada en `/api`:

```
VITE_API_URL=https://manager-stock-api.onrender.com/api
VITE_DESKTOP_CONNECTED=1
```

Si la dirección no es `https://…/api`, la compilación se detiene con un mensaje.

### Opción A: con Android Studio (Windows)

1. Instala [Android Studio](https://developer.android.com/studio) (trae el SDK y Java).
2. En la carpeta del proyecto:

   ```powershell
   npm ci
   npm run android:sync
   ```

3. Abre la carpeta `android` en Android Studio y espera a que termine *Gradle Sync*.
4. **Build → Build App Bundle(s) / APK(s) → Build APK(s)**.
5. Resultado: `android\app\build\outputs\apk\debug\app-debug.apk`.

### Opción B: por consola (requiere el SDK de Android y `ANDROID_HOME`)

```powershell
npm ci
npm run android:apk
```

## Qué cambió en el código

- `@capacitor/core`, `@capacitor/android` y `@capacitor/cli` 8.6.0 (versiones exactas).
- `capacitor.config.ts`: id `com.managerstock.app`, nombre "Manager Stock", contenido web
  en `dist`. Usa `androidScheme: 'http'`, así la app tiene el origen `http://localhost`,
  que el servidor ya acepta en CORS (con `https://localhost` el servidor rechaza las
  peticiones) y que Chromium trata como contexto seguro (la cámara del escáner funciona).
- `android/`: proyecto nativo generado por `npx cap add android`, con permiso de cámara
  para el escáner de códigos.
- `.env.android` y modo de compilación `android` en `vite.config.ts` (misma validación
  de la dirección que el modo `nube`).
- `package.json`: scripts `android:sync` y `android:apk`.
