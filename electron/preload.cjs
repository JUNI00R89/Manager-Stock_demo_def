const { contextBridge } = require('electron');

// Puente mínimo de solo lectura: el frontend no necesita acceso a Node.
contextBridge.exposeInMainWorld('managerStockDesktop', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
