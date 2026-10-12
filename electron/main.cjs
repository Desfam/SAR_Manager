const { app, BrowserWindow, Notification, ipcMain, protocol, net, shell } = require('electron');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { ensureBackend, stopBackend, BACKEND_PORT } = require('./backend.cjs');

const DEV_URL = process.env.SAR_DEV_URL; // set by scripts/dev-app.mjs
const DIST_DIR = path.join(__dirname, '..', 'dist');

// Production: the UI is served from app://sar/, and app://sar/api|health is forwarded to the backend,
// so the renderer keeps same-origin relative URLs exactly like in the browser build.
// Native Wayland on Ubuntu when available (sharper text, proper scaling), X11 otherwise
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');
app.setName('SAR Manager');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let mainWindow = null;
let backendState = { ok: false, owned: false, port: BACKEND_PORT, starting: true };

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    backgroundColor: '#0a0a0b',
    show: false,
    title: 'SAR Manager',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false));
  mainWindow.on('enter-full-screen', () => mainWindow.webContents.send('window:fullscreen', true));
  mainWindow.on('leave-full-screen', () => mainWindow.webContents.send('window:fullscreen', false));

  // External links open in the system browser, never inside the app window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL(DEV_URL || 'app://sar/');
}

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:toggle-maximize', () => (mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize()));
ipcMain.on('window:close', () => mainWindow?.close());
ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false);
ipcMain.handle('window:set-fullscreen', (_event, value) => {
  mainWindow?.setFullScreen(!!value);
  return mainWindow?.isFullScreen() ?? false;
});
ipcMain.handle('backend:status', () => backendState);

/* ---------- alert notifications ---------- */
// GNOME: notify-send gives a real shell notification (notification center, app name, icon, urgency,
// "Öffnen" button). Electron's own Notification is the fallback for other desktops.
const ICON = path.join(__dirname, 'icons', 'sar-manager.svg');
const HAS_NOTIFY_SEND = process.platform === 'linux' && spawnSync('which', ['notify-send']).status === 0;
const HAS_CANBERRA = process.platform === 'linux' && spawnSync('which', ['canberra-gtk-play']).status === 0;
const openNotifications = new Set();

function focusAlerts() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('app:navigate', '/alerts');
}

function playSound(entry) {
  if (!entry.sound || !HAS_CANBERRA) return;
  const sound = entry.kind === 'resolved' ? 'complete' : entry.severity === 'critical' ? 'dialog-error' : entry.kind === 'test' ? 'message-new-instant' : 'dialog-warning';
  spawn('canberra-gtk-play', ['-i', sound, '-d', 'SAR Manager'], { stdio: 'ignore' }).on('error', () => {});
}

function gnomeNotify(entry) {
  const critical = entry.severity === 'critical' && entry.kind !== 'resolved';
  const args = [
    '--app-name=SAR Manager',
    `--icon=${ICON}`,
    `--urgency=${critical ? 'critical' : 'normal'}`,
    '--category=device',
    '--action=open=Öffnen',
    '--wait',
    ...(critical ? [] : ['--expire-time=10000']),
    entry.title,
    entry.body,
  ];
  const child = spawn('notify-send', args, { stdio: ['ignore', 'pipe', 'ignore'] });
  openNotifications.add(child);
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.on('error', () => openNotifications.delete(child));
  child.on('close', () => {
    openNotifications.delete(child);
    if (output.trim() === 'open') focusAlerts();
  });
  playSound(entry);
}

app.on('will-quit', () => openNotifications.forEach((child) => child.kill()));

// The backend writes every alert notification to a log; this shows new entries as native notifications,
// also when the window is minimized or in the background.
let lastNotificationId = null;

async function pollNotifications() {
  try {
    const response = await net.fetch(`http://127.0.0.1:${BACKEND_PORT}/api/alerting/notifications?after=${lastNotificationId ?? 0}&limit=${lastNotificationId === null ? 1 : 20}`);
    if (!response.ok) return;
    const entries = await response.json();
    if (!Array.isArray(entries) || !entries.length) {
      if (lastNotificationId === null) lastNotificationId = 0;
      return;
    }
    // first poll after start: only remember where we are, don't replay old notifications
    if (lastNotificationId === null) {
      lastNotificationId = entries[0].id;
      return;
    }
    lastNotificationId = Math.max(lastNotificationId, ...entries.map((entry) => entry.id));
    for (const entry of [...entries].reverse()) {
      if (!entry.desktop) continue;
      if (HAS_NOTIFY_SEND) {
        gnomeNotify(entry);
        continue;
      }
      if (!Notification.isSupported()) continue;
      const notification = new Notification({
        title: entry.title,
        body: entry.body,
        silent: !entry.sound,
        urgency: entry.severity === 'critical' ? 'critical' : 'normal',
        timeoutType: entry.severity === 'critical' ? 'never' : 'default',
      });
      notification.on('click', focusAlerts);
      notification.show();
    }
  } catch {
    // backend not reachable yet
  }
}

app.whenReady().then(async () => {
  setInterval(pollNotifications, 10_000);
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
      const target = `http://127.0.0.1:${BACKEND_PORT}${url.pathname}${url.search}`;
      return net.fetch(target, {
        method: request.method,
        headers: request.headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        duplex: 'half',
      });
    }
    // Static UI; unknown paths fall back to index.html for client-side routes
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(DIST_DIR, relative || 'index.html'));
    const safe = file.startsWith(DIST_DIR) ? file : path.join(DIST_DIR, 'index.html');
    const response = await net.fetch(pathToFileURL(safe).toString()).catch(() => null);
    if (response && response.ok) return response;
    return net.fetch(pathToFileURL(path.join(DIST_DIR, 'index.html')).toString());
  });

  createWindow();
  backendState = { ...(await ensureBackend()), starting: false };
  mainWindow?.webContents.send('backend:ready', backendState);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', stopBackend);
