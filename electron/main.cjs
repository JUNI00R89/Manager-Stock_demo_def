const { app, BrowserWindow, Menu, dialog, shell, nativeImage } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const IS_DEV = !app.isPackaged && process.env.NODE_ENV !== 'production';
const DEV_URL = process.env.ELECTRON_START_URL || '';
// Puerto fijo a propósito: los datos del modo escritorio viven en localStorage, que
// pertenece al origen http://127.0.0.1:PUERTO. Cambiar de puerto (p. ej. porque
// otro programa ocupa este) abriría la app con datos vacíos, así que no se
// prueba otro puerto: se avisa al usuario. No cambiarlo sin migrar esos datos.
// 41731 (y no 5173) para no chocar con el servidor de desarrollo de Vite;
// es el puerto definido en docs/ESCRITORIO_AVANCE.md.
const APP_PORT = 41731;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

let mainWindow = null;
let staticServer = null;
let appOrigin = '';

function appRoot() {
  return app.getAppPath();
}

function iconPath() {
  return path.join(appRoot(), 'build', 'icon.ico');
}

function serveStatic(rootDir) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(path.join(rootDir, 'index.html'))) {
      reject(Object.assign(new Error('No se encontró la compilación del frontend (dist/index.html).'), { code: 'MISSING_BUILD' }));
      return;
    }

    const server = http.createServer((req, res) => {
      try {
        const requestPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
        const root = path.resolve(rootDir);
        let filePath = path.resolve(root, requestPath.replace(/^([/\\])+/, ''));

        // Con separador: un simple startsWith(root) aceptaría carpetas hermanas como "dist-x".
        if (filePath !== root && !filePath.startsWith(root + path.sep)) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Acceso denegado');
          return;
        }

        let stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
        if (stat && stat.isDirectory()) {
          filePath = path.join(filePath, 'index.html');
          stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
        }

        // Cualquier ruta sin extensión es una ruta del router: devolver index.html (SPA).
        if (!stat || !stat.isFile()) {
          if (path.extname(requestPath)) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('No encontrado');
            return;
          }
          filePath = path.join(rootDir, 'index.html');
        }

        const ext = path.extname(filePath).toLowerCase();
        const cache = ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable';
        res.writeHead(200, {
          'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
          'Cache-Control': cache,
        });
        fs.createReadStream(filePath).pipe(res);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Error interno del servidor local');
      }
    });

    server.once('error', (error) => {
      if (error && error.code === 'EADDRINUSE') {
        reject(new Error(
          `El puerto local ${APP_PORT} está ocupado por otro programa (por ejemplo, el servidor de desarrollo). `
          + 'Ciérralo y vuelve a abrir Manager Stock: tus datos están ligados a ese puerto.',
        ));
      } else {
        reject(error);
      }
    });
    server.once('listening', () => {
      staticServer = server;
      resolve(`http://127.0.0.1:${APP_PORT}`);
    });
    server.listen(APP_PORT, '127.0.0.1');
  });
}

function readWindowState() {
  const file = path.join(app.getPath('userData'), 'window-state.json');
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof state.width === 'number' && typeof state.height === 'number') return state;
  } catch {
    /* primera ejecución */
  }
  return { width: 1440, height: 900 };
}

function saveWindowState(win) {
  try {
    if (!win || win.isDestroyed()) return;
    const bounds = win.getNormalBounds();
    const file = path.join(app.getPath('userData'), 'window-state.json');
    fs.writeFileSync(file, JSON.stringify({ ...bounds, maximized: win.isMaximized() }, null, 2));
  } catch {
    /* no crítico */
  }
}

function createWindow() {
  const state = readWindowState();
  const icon = fs.existsSync(iconPath()) ? nativeImage.createFromPath(iconPath()) : undefined;

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: 'Manager Stock',
    backgroundColor: '#f5f4f2',
    icon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  if (state.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('close', () => saveWindowState(mainWindow));
  mainWindow.on('closed', () => { mainWindow = null; });

  // Enlaces externos siempre en el navegador del sistema.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !url.startsWith(appOrigin)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(appOrigin)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = (input.key || '').toLowerCase();
    const ctrl = input.control || input.meta;
    if (key === 'f11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
      return;
    }
    if (!ctrl) return;
    if (key === '=' || key === '+') {
      mainWindow.webContents.setZoomLevel(Math.min(3, mainWindow.webContents.getZoomLevel() + 0.5));
      event.preventDefault();
    } else if (key === '-') {
      mainWindow.webContents.setZoomLevel(Math.max(-3, mainWindow.webContents.getZoomLevel() - 0.5));
      event.preventDefault();
    } else if (key === '0') {
      mainWindow.webContents.setZoomLevel(0);
      event.preventDefault();
    } else if (IS_DEV && (key === 'r' || key === 'i')) {
      if (key === 'r') mainWindow.webContents.reload();
      else mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  const targetUrl = DEV_URL || appOrigin;
  mainWindow.loadURL(targetUrl).catch((error) => {
    dialog.showErrorBox('Manager Stock', `No se pudo cargar la interfaz.\n\n${error.message}`);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.managerstock.app');
    Menu.setApplicationMenu(null);

    try {
      appOrigin = DEV_URL || (await serveStatic(path.join(appRoot(), 'dist')));
      createWindow();
    } catch (error) {
      const hint = error.code === 'MISSING_BUILD'
        ? '\n\nGenera la versión de escritorio con "npm run desktop" o "npm run desktop:build".'
        : '';
      dialog.showErrorBox('Manager Stock', `${error.message}${hint}`);
      app.quit();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('quit', () => {
    if (staticServer) staticServer.close();
  });
}
