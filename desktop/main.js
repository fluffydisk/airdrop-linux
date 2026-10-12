'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { validName, rootDirectory } = require('./core/lib/files');
const { sendFiles } = require('./core/lib/transfer');
const { getPaths } = require('./core/lib/paths');
const paths = getPaths();
const desktopData = process.env.AIRDROP_DESKTOP_USER_DATA || paths.desktopData;
fs.mkdirSync(desktopData, { recursive: true, mode: 0o700 });
app.setPath('userData', desktopData);
const shareDir = process.env.AIRDROP_SHARE_DIR || paths.files;
let window, tray, timer, quitting = false, sending = false;
let state = { status: 'offline', label: 'Checking services…' };
const allowedPaths = new Set();

function ownWindow(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Invalid IPC sender');
}
async function health() {
  const check = async url => {
    try { return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
  };
  const [files, api] = await Promise.all([check(`http://127.0.0.1:${process.env.AIRDROP_FILE_PORT || 5000}/?json`), check(`http://127.0.0.1:${process.env.AIRDROP_API_PORT || 6001}/push/health`)]);
  state = { status: files && api ? 'ready' : files || api ? 'partial' : 'offline',
    label: files && api ? 'Ready to share' : files || api ? 'Needs attention' : 'Server unavailable' };
  if (window && !window.isDestroyed()) window.webContents.send('airdrop:status', state);
  if (tray) {
    tray.setToolTip(`Airdrop: ${state.label}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: state.label, enabled: false }, { label: 'Open Airdrop', click: () => window.show() },
      { label: 'Open shared folder', click: () => shell.openPath(shareDir) },
      { type: 'separator' }, { label: 'Quit', click: () => app.quit() }
    ]));
  }
  return state;
}
async function readSettings() {
  let pwaUrl = '';
  try {
    const saved = JSON.parse(await fs.promises.readFile(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
    const url = new URL(saved.pwaUrl);
    if (url.protocol === 'https:' && url.hostname.endsWith('.ts.net') && !url.username && !url.password && !url.port) pwaUrl = url.href;
  } catch {}
  return { pwaUrl, deviceName: os.hostname() };
}
async function openPwa() {
  let { pwaUrl: url } = await readSettings();
  if (!url) {
    const response = await dialog.showMessageBox(window, { type: 'question', buttons: ['Open local web app', 'Cancel'], defaultId: 0,
      message: 'Connect your workspace', detail: 'Add your Tailscale HTTPS address in Settings for access across devices. You can also open the local web app on this computer.' });
    if (response.response !== 0) return;
    url = `http://127.0.0.1:${process.env.AIRDROP_API_PORT || 6001}/ui/`;
  }
  await shell.openExternal(url);
}
function registerIpc() {
  ipcMain.handle('airdrop:choose', async event => {
    ownWindow(event);
    const result = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'] });
    for (const file of result.filePaths) allowedPaths.add(file);
    return result.filePaths;
  });
  ipcMain.handle('airdrop:drop', (event, files) => {
    ownWindow(event);
    if (!Array.isArray(files) || files.length > 1000 || !files.every(file => typeof file === 'string' && path.isAbsolute(file))) throw new Error('Invalid dropped files');
    for (const file of files) allowedPaths.add(file);
    return files;
  });
  ipcMain.handle('airdrop:send', async (event, sources, zip) => {
    ownWindow(event);
    if (sending) throw new Error('A transfer is already running');
    if (!Array.isArray(sources) || !sources.length || sources.length > 1000 || !sources.every(file => allowedPaths.has(file)) || typeof zip !== 'boolean') throw new Error('Choose files first');
    sending = true;
    try { return await sendFiles(shareDir, sources, zip); }
    finally { sending = false; }
  });
  ipcMain.handle('airdrop:describe', async (event, sources) => {
    ownWindow(event);
    if (!Array.isArray(sources) || sources.length > 1000 || !sources.every(source => allowedPaths.has(source))) throw new Error('Choose files first');
    return Promise.all(sources.map(async source => {
      const stat = await fs.promises.lstat(source);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Choose regular files. Folders and links cannot be sent.');
      return { path: source, name: path.basename(source), size: stat.size };
    }));
  });
  ipcMain.handle('airdrop:recent', async event => {
    ownWindow(event);
    const root = await rootDirectory(shareDir);
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    const files = await Promise.all(entries.filter(entry => entry.isFile() && validName(entry.name)).map(async entry => {
      try {
        const stat = await fs.promises.lstat(path.join(root, entry.name));
        return stat.isFile() && !stat.isSymbolicLink() ? { name: entry.name, size: stat.size, modified: stat.mtimeMs } : null;
      } catch { return null; }
    }));
    return files.filter(Boolean).sort((a, b) => b.modified - a.modified).slice(0, 50);
  });
  ipcMain.handle('airdrop:settings', event => { ownWindow(event); return readSettings(); });
  ipcMain.handle('airdrop:status', event => { ownWindow(event); return state; });
  ipcMain.handle('airdrop:folder', event => { ownWindow(event); return shell.openPath(shareDir); });
  ipcMain.handle('airdrop:pwa', event => { ownWindow(event); return openPwa(); });
  ipcMain.handle('airdrop:save-url', async (event, input) => {
    ownWindow(event);
    const url = new URL(input);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.ts.net') || url.username || url.password || url.port) throw new Error('Enter a Tailscale HTTPS URL ending in .ts.net');
    url.pathname = '/ui/'; url.search = ''; url.hash = '';
    await fs.promises.mkdir(app.getPath('userData'), { recursive: true });
    await fs.promises.writeFile(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({ pwaUrl: url.href }), { mode: 0o600 });
    return url.href;
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.on('before-quit', () => { quitting = true; clearInterval(timer); });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    window = new BrowserWindow({ width: 1080, height: 840, minWidth: 620, minHeight: 650, show: false, backgroundColor: '#f2f2f7', title: 'Airdrop',
      icon: path.join(__dirname, 'core/ui/icon-192.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.once('ready-to-show', () => window.show());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((contents, permission, callback) => callback(false));
    registerIpc();
    await window.loadFile(path.join(__dirname, 'index.html'));
    // Without a StatusNotifier host, stay a normal window application.
    if (!process.env.AIRDROP_DISABLE_TRAY) {
      try {
        const { execFile } = require('node:child_process');
        const host = await new Promise(resolve => execFile('dbus-send', ['--session', '--print-reply', '--dest=org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus.NameHasOwner', 'string:org.kde.StatusNotifierWatcher'], { timeout: 2000 }, (error, stdout) => resolve(!error && stdout.includes('boolean true'))));
        if (host) {
          const icon = nativeImage.createFromPath(path.join(__dirname, 'core/ui/icon-192.png')).resize({ width: 32, height: 32 });
          tray = new Tray(icon); tray.on('click', () => { window.show(); window.focus(); });
        }
      } catch (error) { console.warn('Tray unavailable:', error.message); }
    }
    window.on('closed', () => { window = null; });
    window.on('close', event => { if (!quitting && tray) { event.preventDefault(); window.hide(); } });
    await health(); timer = setInterval(health, 5000);
  }).catch(error => { console.error(error); app.quit(); });
  app.on('window-all-closed', () => { if (!tray) app.quit(); });
}
