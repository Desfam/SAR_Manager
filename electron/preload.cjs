const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sarDesktop', {
  isDesktop: true,
  backendPort: Number(process.env.SAR_BACKEND_PORT || 3001),
  platform: process.platform,
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    setFullScreen: (value) => ipcRenderer.invoke('window:set-fullscreen', value),
    onFullScreenChange: (callback) => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on('window:fullscreen', listener);
      return () => ipcRenderer.removeListener('window:fullscreen', listener);
    },
    onMaximizeChange: (callback) => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on('window:maximized', listener);
      return () => ipcRenderer.removeListener('window:maximized', listener);
    },
  },
  backendStatus: () => ipcRenderer.invoke('backend:status'),
  /** navigation request from the main process, e.g. click on an alert notification */
  onNavigate: (callback) => {
    const listener = (_event, path) => callback(path);
    ipcRenderer.on('app:navigate', listener);
    return () => ipcRenderer.removeListener('app:navigate', listener);
  },
});
