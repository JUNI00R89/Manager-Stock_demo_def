const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('managerStockDesktop', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
});
