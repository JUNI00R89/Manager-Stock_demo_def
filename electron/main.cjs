const { app, BrowserWindow, Menu, dialog, shell, nativeImage } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const IS_DEV = !app.isPackaged && process.env.NODE_ENV !== 'production';
const DEV_URL = process.env.ELECTRON_START_URL || '';
const CANDIDATE_PORTS = [5173, 4173];
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
      reject(new Error('No se encontró la compilación del frontend (dist/index.html).'));
      return;
    }

    const server = http.createServer((req, res) => {
      try {
        const requestPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
        const safeRelative = path.normalize(requestPath).replace(/^([/\\])+/, '');
        let filePath = path.join(rootDir, safeRelative);

        if (!filePath.startsWith(path.resolve(rootDir))) {
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

    server.on('error', reject);

    const tryPort = (index) => {
      if (index >= CANDIDATE_PORTS.length) {
        reject(new Error('Los puertos locales 5173 y 4173 están ocupados. Cierra el servidor de desarrollo e inténtalo de nuevo.'));
        return;
      }
      const port = CANDIDATE_PORTS[index];
      const onError = () => {
        server.removeListener('listening', onListening);
        tryPort(index + 1);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        staticServer = server;
        resolve(`http://127.0.0.1:${port}`);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    };

    tryPort(0);
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
      dialog.showErrorBox(
        'Manager Stock',
        `${error.message}\n\nGenera la versión de escritorio con "npm run desktop" o "npm run desktop:build".`,
      );
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
