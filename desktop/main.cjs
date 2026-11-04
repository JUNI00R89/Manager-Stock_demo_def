const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const WEB_ROOT = path.join(__dirname, 'web');
const PORT_CANDIDATES = [41731, 41732, 41733, 41734, 41735];
const MIME_TYPES = {  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

// Perfil aislado para la prueba automática: parte de cero en cada ejecución.
if (process.env.MANAGER_STOCK_SMOKE_PROFILE) {
  const profile = process.env.MANAGER_STOCK_SMOKE_PROFILE;
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  app.setPath('userData', profile);
}

let server = null;
let mainWindow = null;
let localOrigin = null;

function serveFile(response, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
    'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(filePath).pipe(response);
}

function createServer() {
  return http.createServer((request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      const decoded = decodeURIComponent(url.pathname);
      const relative = decoded.replace(/^\/+/, '');
      let filePath = path.resolve(WEB_ROOT, relative);
      const root = path.resolve(WEB_ROOT);
      if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }
      const exists = fs.existsSync(filePath);
      const isDirectory = exists && fs.statSync(filePath).isDirectory();
      if (isDirectory) filePath = path.join(filePath, 'index.html');
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        const extension = path.extname(decoded);
        if (extension && extension !== '.html') {
          response.writeHead(404);
          response.end('Not found');
          return;
        }
        filePath = path.join(WEB_ROOT, 'index.html');
      }
      serveFile(response, filePath);
    } catch (error) {
      response.writeHead(500);
      response.end('Error interno');
    }
  });
}

function listenOnAvailablePort(attempt = 0) {
  return new Promise((resolve, reject) => {
    if (attempt >= PORT_CANDIDATES.length) {
      reject(new Error('No hay un puerto libre para iniciar la aplicación.'));
      return;
    }
    const port = PORT_CANDIDATES[attempt];
    const candidate = createServer();
    candidate.once('error', (error) => {
      candidate.close();
      if (error.code === 'EADDRINUSE') listenOnAvailablePort(attempt + 1).then(resolve, reject);
      else reject(error);
    });
    candidate.listen(port, '127.0.0.1', () => resolve({ server: candidate, port }));
  });
}

function buildMenu() {
  const template = [
    {
      label: 'Archivo',
      submenu: [
        { label: 'Recargar', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.reload() },
        { type: 'separator' },
        { role: 'quit', label: 'Salir' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'resetZoom', label: 'Tamaño normal' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
      ],
    },
    {
      label: 'Ayuda',
      submenu: [
        {
          label: 'Acerca de Manager Stock',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Manager Stock',
            message: 'Manager Stock · Aplicación de escritorio',
            detail: `Versión ${app.getVersion()}\nDatos demo locales, sin servidor.`,
            buttons: ['Aceptar'],
          }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  const { server: localServer, port } = await listenOnAvailablePort();
  server = localServer;
  localOrigin = `http://127.0.0.1:${port}`;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#0D0D10',
    title: 'Manager Stock',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (localOrigin && !url.startsWith(localOrigin)) {
      event.preventDefault();
      if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url);
    }
  });

  await mainWindow.loadURL(`${localOrigin}/login`);

  if (process.env.MANAGER_STOCK_SMOKE) {
    void runSmokeTest();
  }
}

async function runSmokeTest() {
  try {
    await new Promise(resolve => setTimeout(resolve, 2000));
    if (process.env.MANAGER_STOCK_SMOKE_LOGIN) {
      const account = process.env.MANAGER_STOCK_SMOKE_ACCOUNT || 'Hotel Senderos';
      const clicked = await mainWindow.webContents.executeJavaScript(`
        (() => {
          const account = ${JSON.stringify(account)};
          const button = [...document.querySelectorAll('button')].find(item => item.textContent && item.textContent.includes(account));
          if (button) button.click();
          return Boolean(button);
        })()
      `);
      console.log('[smoke] cuenta', account, 'click:', clicked);
      await new Promise(resolve => setTimeout(resolve, 4500));
    }
    console.log('[smoke] url actual:', mainWindow.webContents.getURL());
    const localKeys = await mainWindow.webContents.executeJavaScript(`
      Object.keys(localStorage).filter(key =>
        key.startsWith('manager_stock_database_v1:') ||
        key.startsWith('manager_stock_desktop_rooms_v1:')
      )
    `);
    console.log('[smoke] claves locales:', JSON.stringify(localKeys));
    if (process.env.MANAGER_STOCK_SMOKE_TAB) {
      const tabLabel = process.env.MANAGER_STOCK_SMOKE_TAB;
      const tabClicked = await mainWindow.webContents.executeJavaScript(`
        new Promise((resolve) => {
          const label = ${JSON.stringify(tabLabel)};
          let attempts = 0;
          const timer = setInterval(() => {
            attempts += 1;
            const tab = [...document.querySelectorAll('button,[role="tab"]')].find(item => (item.textContent || '').trim() === label);
            if (tab) {
              clearInterval(timer);
              tab.click();
              tab.scrollIntoView({ block: 'center' });
              resolve(true);
            } else if (attempts >= 30) {
              clearInterval(timer);
              resolve(false);
            }
          }, 500);
        })
      `);
      console.log('[smoke] click pestaña', tabLabel + ':', tabClicked);
      await new Promise(resolve => setTimeout(resolve, 2000));
      await mainWindow.webContents.executeJavaScript(`
        (() => {
          const label = ${JSON.stringify(tabLabel)};
          const tab = [...document.querySelectorAll('button,[role="tab"]')].find(item => (item.textContent || '').trim() === label);
          if (tab) tab.scrollIntoView({ block: 'start' });
          return Boolean(tab);
        })()
      `);
      await new Promise(resolve => setTimeout(resolve, 600));
    }
    const text = await mainWindow.webContents.executeJavaScript('document.body.innerText');
    console.log('[smoke] ' + text.replace(/\s+/g, ' ').slice(0, 900));
    const image = await mainWindow.webContents.capturePage();
    fs.writeFileSync(process.env.MANAGER_STOCK_SMOKE, image.toPNG());
    console.log('[smoke] captura guardada');
  } catch (error) {
    console.error('[smoke] error', error);
  } finally {
    app.exit(0);
  }
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    if (!fs.existsSync(path.join(WEB_ROOT, 'index.html'))) {
      dialog.showErrorBox('Manager Stock', 'No se encontró la interfaz compilada (desktop/web). Ejecuta la compilación de escritorio.');
      app.quit();
      return;
    }
    buildMenu();
    try {
      await createWindow();
    } catch (error) {
      dialog.showErrorBox('Manager Stock', `No se pudo iniciar la aplicación.\n${error instanceof Error ? error.message : String(error)}`);
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    server?.close();
    server = null;
  });
}
