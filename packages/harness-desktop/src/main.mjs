import { app, BrowserWindow, dialog, Menu, session, utilityProcess } from 'electron';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { connectStudioService } from './service-host.mjs';
import { HEADER, isSameOrigin, isExternalUrl } from './protocol.mjs';

let window;
let service;
let origin;
let quitting = false;
let failureReported = false;
const token = randomBytes(32).toString('hex');

function fail(error) {
  if (failureReported || quitting) return;
  failureReported = true;
  console.error(error);
  dialog.showErrorBox('Harness Studio could not continue', error.message);
  app.quit();
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 390, minHeight: 600,
    title: 'Harness Studio', show: false,
    webPreferences: {
      partition: 'harness-desktop', nodeIntegration: false, contextIsolation: true,
      sandbox: true, webviewTag: false,
    },
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('will-navigate', (event, url) => {
    if (!isSameOrigin(url, origin)) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (!isSameOrigin(url, origin)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    // External links require an explicit native confirmation; no protocol handlers.
    if (isExternalUrl(url) && !isSameOrigin(url, origin)) {
      void dialog.showMessageBox(window, {
        type: 'question', message: 'Open this link in your browser?', detail: url,
        buttons: ['Cancel', 'Open'], defaultId: 0, cancelId: 0,
      }).then(async ({ response }) => {
        if (response === 1) {
          const { shell } = await import('electron');
          await shell.openExternal(url);
        }
      }).catch(console.error);
    }
    return { action: 'deny' };
  });
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => { window = undefined; });
  await window.loadURL(origin);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (!window && origin && !quitting) void createWindow().catch(fail); });
  app.on('before-quit', (event) => {
    if (quitting || !service) return;
    event.preventDefault();
    quitting = true;
    void service.stop().finally(() => app.quit());
  });
  void app.whenReady().then(async () => {
    const desktopSession = session.fromPartition('harness-desktop');
    desktopSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    desktopSession.setPermissionCheckHandler(() => false);
    const child = utilityProcess.fork(fileURLToPath(new URL('./studio-service.mjs', import.meta.url)), [], {
      serviceName: 'Harness Studio Service', stdio: 'pipe',
    });
    child.stdout?.on('data', (data) => process.stdout.write(data));
    child.stderr?.on('data', (data) => process.stderr.write(data));
    service = connectStudioService(child, {
      token, dataDirectory: app.getPath('userData'), onFailure: fail,
      async pickDirectory() {
        if (!window || window.isDestroyed()) throw new Error('No active Studio window');
        const result = await dialog.showOpenDialog(window, { title: 'Open a Project in Harness Studio', properties: ['openDirectory'] });
        return result.canceled ? undefined : result.filePaths[0];
      },
    });
    const ready = await service.started;
    origin = ready.url;
    desktopSession.webRequest.onBeforeSendHeaders((details, callback) => {
      // Credentials never enter page JavaScript, URLs, storage or external requests.
      for (const key of Object.keys(details.requestHeaders)) {
        if (key.toLowerCase() === HEADER) delete details.requestHeaders[key];
      }
      if (isSameOrigin(details.url, origin)) details.requestHeaders[HEADER] = token;
      callback({ requestHeaders: details.requestHeaders });
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { label: 'File', submenu: [{ role: 'close' }, { role: 'quit' }] },
      { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    ]));
    await createWindow();
  }).catch(fail);
}
