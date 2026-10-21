'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeImage, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const explorer = require('./core/lib/explorer');
const { operation } = require('./core/lib/maintenance');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { validName, rootDirectory } = require('./core/lib/files');
const { sendFiles } = require('./core/lib/transfer');
const { getPaths } = require('./core/lib/paths');
const { readSharedClipboard, writeSharedClipboard, validateText, readClipboardFile } = require('./clipboard');
const paths = getPaths();
const distribution = require('./core/lib/installation').distribution();
const backgroundRequest = new AbortController();
const updater = require('./core/lib/updater');
let updateTimer, updateBusy = false;
let updateState = { distribution: distribution.source, status: 'current', current: app.getVersion(), message: `Airdrop ${app.getVersion()}` };
function publishUpdate(value) { value = { ...value, distribution: distribution.source }; updateState = value; if (window && !window.isDestroyed()) window.webContents.send('airdrop:update-state', value); return value; }
async function checkUpdate() {
  if (distribution.managed) return publishUpdate({ status: 'managed', current: app.getVersion(), message: distribution.message });
  if (updateBusy) return updateState;
  updateBusy = true; publishUpdate({ ...updateState, status: 'checking', message: 'Checking for updates…' });
  try { return publishUpdate(await updater.check(app.getVersion())); }
  catch (error) { return publishUpdate({ status: 'error', current: app.getVersion(), message: error.message }); }
  finally { updateBusy = false; }
}
const desktopData = process.env.AIRDROP_DESKTOP_USER_DATA || paths.desktopData;
fs.mkdirSync(desktopData, { recursive: true, mode: 0o700 });
app.setPath('userData', desktopData);
const shareDir = process.env.AIRDROP_SHARE_DIR || paths.files;
let window, tray, timer, quitting = false, sending = false, backgroundGranted = false;
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
      { label: 'Shared files', click: () => { window.show(); window.webContents.send('airdrop:show-files'); } },
      { type: 'separator' }, { label: distribution.source === 'flatpak' || distribution.source === 'snap' ? 'Stop sharing and quit' : 'Quit', click: () => app.quit() }
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
  ipcMain.handle('airdrop:quit', event => { ownWindow(event); app.quit(); });
  ipcMain.handle('airdrop:update', async (event, action) => {
    ownWindow(event);
    if (action === 'state') return updateState;
    if (action === 'check') return checkUpdate();
    if (distribution.managed) throw new Error(distribution.message);
    if (action !== 'install') throw new Error('Unknown update action');
    if (updateBusy || updateState.status !== 'available') throw new Error('Check for updates first');
    if (process.env.APPIMAGE) {
      if (!updateState.appImage) throw new Error('This release has no AppImage for your architecture yet.');
      await shell.openExternal(updateState.appImage.url);
      return publishUpdate({ ...updateState, message: 'AppImage download opened. Quit Airdrop and replace your AppImage with the downloaded file. The local server is updated separately.' });
    }
    if (!app.isPackaged || path.resolve(process.execPath) !== path.join(paths.desktop, 'Airdrop')) throw new Error('Install this version with the installers once to enable in-app updates.');
    updateBusy = true;
    const release = updateState;
    publishUpdate({ ...release, status: 'downloading', message: 'Downloading and verifying update…' });
    try {
      const prepared = await updater.prepare(paths.root, release, { progress: fraction => publishUpdate({ ...release, status: 'downloading', message: `Downloading update: ${Math.round(fraction * 100)}%` }) });
      publishUpdate({ ...release, status: 'installing', message: 'Finishing transfers, then restarting Airdrop. Linux may request service-management permission.' });
      while (sending) await new Promise(resolve => setTimeout(resolve, 100));
      await updater.launch(paths.root, prepared, process.pid);
      quitting = true; app.quit();
      return updateState;
    } catch (error) { return publishUpdate({ ...release, status: 'available', message: `Update failed: ${error.message}` }); }
    finally { updateBusy = false; }
  });
  ipcMain.handle('airdrop:clipboard-read', event => { ownWindow(event); return clipboard.readText(); });
  ipcMain.handle('airdrop:clipboard-copy', (event, text) => { ownWindow(event); validateText(text); return clipboard.writeText(text); });
  ipcMain.handle('airdrop:clipboard-load', event => { ownWindow(event); return readSharedClipboard(shareDir); });
  ipcMain.handle('airdrop:clipboard-share', (event, text) => { ownWindow(event); return operation(() => writeSharedClipboard(shareDir, text)); });
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
  ipcMain.handle('airdrop:send', async (event, sources, zip, destination = '') => {
    ownWindow(event);
    if (sending) throw new Error('A transfer is already running');
    if (!Array.isArray(sources) || !sources.length || sources.length > 1000 || !sources.every(file => allowedPaths.has(file)) || typeof zip !== 'boolean') throw new Error('Choose files first');
    sending = true;
    try {
      const target = await explorer.directory(shareDir, destination);
      try { return await sendFiles(target.path, sources, zip, { anchored: true }); }
      finally { await target.close(); }
    }
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
  ipcMain.handle('airdrop:explorer', async (event, action, payload = {}) => {
    ownWindow(event);
    const read = {
      list: () => explorer.list(shareDir, payload.directory || ''),
      open: () => explorer.openFile(shareDir, payload.path, async file => {
        const error = await shell.openPath(file);
        if (error) throw new Error(`Could not open file: ${error}`);
      }),
      trashList: () => explorer.trashList(shareDir)
    };
    if (Object.hasOwn(read, action)) return read[action]();
    const write = {
      mkdir: () => explorer.mkdir(shareDir, payload.directory || '', payload.name),
      copy: () => explorer.copy(shareDir, payload.directory || '', payload.paths, payload.name),
      trash: () => explorer.trash(shareDir, payload.paths),
      restore: () => explorer.restore(shareDir, payload.id),
      paste: async () => {
        const file = await readClipboardFile(clipboard, nativeImage);
        return explorer.upload(shareDir, payload.directory || '', file.name, Readable.from([file.data]));
      },
      download: async () => {
        const result = await explorer.download(shareDir, payload.paths);
        let streamError; result.stream.on('error', error => { streamError = error; });
        try {
          const save = await dialog.showSaveDialog(window, { defaultPath: result.name });
          if (save.canceled) return;
          if (streamError) throw streamError;
          if (['flatpak','snap'].includes(distribution.source)) {
            await pipeline(result.stream, fs.createWriteStream(save.filePath, {mode:0o600})); return;
          }
          const temp = await fs.promises.mkdtemp(path.join(path.dirname(save.filePath), '.airdrop-download-'));
          try { const output = path.join(temp, 'download'); await pipeline(result.stream, fs.createWriteStream(output, { flags: 'wx', mode: 0o600 })); await fs.promises.rename(output, save.filePath); }
          finally { await fs.promises.rm(temp, { recursive: true, force: true }); }
        } finally { result.stream.destroy(); }
      }
    };
    if (!Object.hasOwn(write, action)) throw new Error('Unknown file operation');
    return operation(write[action]);
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
  ipcMain.handle('airdrop:folder', event => { ownWindow(event); window.webContents.send('airdrop:show-files'); });
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
  if (distribution.source === 'flatpak') process.stdout.write('AIRDROP_START_BACKEND\n');
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.on('before-quit', () => {
    backgroundRequest.abort();
    if (distribution.source === 'snap') {
      try { require('node:child_process').execFileSync('snapctl',['stop','--user','airdrop-linux.backend']); }
      catch (error) { console.error('Could not stop sharing:',error.message); }
    }
    quitting = true; clearInterval(timer); clearInterval(updateTimer); });
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
    window.on('close', event => { if (!quitting && (distribution.source === 'flatpak' ? backgroundGranted : (tray || backgroundGranted))) { event.preventDefault(); window.hide(); } });
    if (distribution.source === 'flatpak') {
      require('./background').requestBackground({signal:backgroundRequest.signal}).then(granted => {
        backgroundGranted = granted;
        if (!granted && window && !quitting) dialog.showMessageBox(window, {type:'info', message:'Background sharing is not enabled', detail:'Sharing stops when you close Airdrop. You can reopen it to resume.'});
      });
    }
    if (distribution.source === 'snap') backgroundGranted = true;
    await health(); timer = setInterval(health, 5000);
    const journal = await updater.readJournal(paths.root);
    if (journal?.phase === 'rolled-back') publishUpdate({ ...updateState, message: `Previous update was rolled back: ${journal.error || 'interrupted installation'}` });
    else if (!process.env.AIRDROP_DISABLE_UPDATE_CHECK) checkUpdate();
    if (!process.env.AIRDROP_DISABLE_UPDATE_CHECK) updateTimer = setInterval(checkUpdate, 6 * 60 * 60 * 1000);
  }).catch(error => { console.error(error); app.quit(); });
  app.on('window-all-closed', () => { if (distribution.source === 'flatpak' ? !backgroundGranted : (!tray && !backgroundGranted)) app.quit(); });
}
