import { join } from 'node:path';
import { app, BrowserWindow, dialog, Menu, nativeTheme, session, utilityProcess } from 'electron';
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

/**
 * The window is frameless so Studio's own unified toolbar reaches the top of the
 * window, with the OS window controls inlaid into it.
 *
 * macOS keeps its traffic lights and only drops the title bar strip
 * (`hiddenInset`), positioned to centre in Studio's 52px toolbar. Windows and
 * Linux have no equivalent, so they take `titleBarOverlay`, which paints native
 * minimise/maximise/close over the trailing edge instead. The two sides differ,
 * so the renderer is told which edge to reserve rather than guessing from the
 * user agent.
 */
function windowChrome() {
  if (process.platform === 'darwin') {
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 19 } };
  }
  return { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlay() };
}

/** Mirrors the `titlebar` surface token so the overlay is not a foreign block. */
function titleBarOverlay() {
  const dark = nativeTheme.shouldUseDarkColors;
  return {
    color: dark ? '#313137' : '#f0f0f4',
    symbolColor: dark ? '#bebec9' : '#54545c',
    height: 52,
  };
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 390, minHeight: 600,
    title: 'Harness Studio', show: false,
    ...windowChrome(),
    webPreferences: {
      partition: 'better-harness-desktop', nodeIntegration: false, contextIsolation: true,
      sandbox: true, webviewTag: false,
    },
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('will-navigate', (event, url) => {
    if (!isSameOrigin(url, origin)) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event, url) => {
    // The official DSH subframe exchanges its launch token for a cookie and
    // redirects on its own origin. Only top-level redirects can replace Studio.
    if (event.isMainFrame && !isSameOrigin(url, origin)) event.preventDefault();
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
  // The renderer runs sandboxed with no preload, so the shell state travels in
  // the URL. It carries no credentials: the access token stays in a request
  // header added by the session, never in a URL.
  await window.loadURL(studioUrl(origin));
}

/** Tells the app it is inside the desktop shell, and which edge the OS controls take. */
function studioUrl(base) {
  const url = new URL(base);
  url.searchParams.set('shell', 'desktop');
  url.searchParams.set('controls', process.platform === 'darwin' ? 'left' : 'right');
  return url.toString();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  // Windows and Linux paint the window controls themselves, so the overlay has to
  // be repainted when the host appearance changes. macOS renders its own traffic
  // lights and needs nothing here.
  if (process.platform !== 'darwin') {
    nativeTheme.on('updated', () => {
      if (window && !window.isDestroyed()) window.setTitleBarOverlay(titleBarOverlay());
    });
  }
  app.on('activate', () => { if (!window && origin && !quitting) void createWindow().catch(fail); });
  app.on('before-quit', (event) => {
    if (quitting || !service) return;
    event.preventDefault();
    quitting = true;
    void service.stop().finally(() => app.quit());
  });
  void app.whenReady().then(async () => {
    const desktopSession = session.fromPartition('better-harness-desktop');
    desktopSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    desktopSession.setPermissionCheckHandler(() => false);
    const child = utilityProcess.fork(fileURLToPath(new URL('./studio-service.mjs', import.meta.url)), [], {
      serviceName: 'Harness Studio Service', stdio: 'pipe',
    });
    child.stdout?.on('data', (data) => process.stdout.write(data));
    child.stderr?.on('data', (data) => process.stderr.write(data));
    service = connectStudioService(child, {
      token, dataDirectory: app.getPath('userData'), onFailure: fail,
      oxcTransport: process.platform === 'darwin' ? 'nsxpc' : 'stdio',
      oxcExecutable: process.platform === 'darwin'
        ? join(app.isPackaged ? join(process.resourcesPath, '..') : fileURLToPath(new URL('../dist/native/Harness OXC.app/Contents', import.meta.url)), 'MacOS', 'harness-oxc-client')
        : join(app.isPackaged ? process.resourcesPath : fileURLToPath(new URL('../dist', import.meta.url)), 'native', process.platform === 'win32' ? 'harness-oxc-service.exe' : 'harness-oxc-service'),
      // macOS runs ACP through the launchd-managed NSXPC service, spawning the
      // `harness-acp-client` bridge exactly where OXC spawns `harness-oxc-client`.
      // Windows/Linux keep the plain `harness-acp-host` stdio driver.
      acpHostTransport: process.platform === 'darwin' ? 'nsxpc' : 'stdio',
      acpHostExecutable: process.platform === 'darwin'
        ? join(app.isPackaged ? join(process.resourcesPath, '..') : fileURLToPath(new URL('../dist/native/Harness ACP.app/Contents', import.meta.url)), 'MacOS', 'harness-acp-client')
        : join(app.isPackaged ? process.resourcesPath : fileURLToPath(new URL('../dist', import.meta.url)), 'native', process.platform === 'win32' ? 'harness-acp-host.exe' : 'harness-acp-host'),
      evidenceHostTransport: process.platform === 'darwin' ? 'nsxpc' : 'stdio',
      evidenceHostExecutable: process.platform === 'darwin'
        ? join(app.isPackaged ? join(process.resourcesPath, '..') : fileURLToPath(new URL('../dist/native/Harness Evidence.app/Contents', import.meta.url)), 'MacOS', 'harness-evidence-client')
        : join(app.isPackaged ? process.resourcesPath : fileURLToPath(new URL('../dist', import.meta.url)), 'native', process.platform === 'win32' ? 'harness-evidence-host.exe' : 'harness-evidence-host'),
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
