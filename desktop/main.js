'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeImage, clipboard, net } = require('electron');
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
const { readSharedClipboard, writeSharedClipboard, validateText, readClipboardFile, readClipboardFiles } = require('./clipboard');
const { workspaceUrl, checkConnection } = require('./connection');
const { openFolder, dragFiles, withPortalFiles, retrieveClipboardFiles } = require('./file-integration');
const paths = getPaths();
const distribution = require('./core/lib/installation').distribution();
const quickshareLab = require('./core/lib/sharing/lab-evidence').openLab({ directory: process.env.AIRDROP_QUICKSHARE_LAB_DIR, repository: path.resolve(__dirname, '..'), packaged: app.isPackaged, enabled: process.env.AIRDROP_EXPERIMENTAL_QUICK_SHARE === '1' });
if (process.platform === 'linux' && distribution.managed) {
  // Match the installed desktop file for portal identity and window grouping.
  app.setDesktopName('io.github.fluffydisk.airdrop-linux.desktop');
  app.commandLine.appendSwitch('class', 'io.github.fluffydisk.airdrop-linux');
}
const backgroundPolicy = new (require('./background-policy').BackgroundPolicy)({source:distribution.source,
  request:options => require('./background').requestBackground(options), snapEnabled:process.env.AIRDROP_SNAP_BACKGROUND === '1'});
const updater = require('./core/lib/updater');
const flatpakUpdates = require('./flatpak-updates');
const updatePreferences = require('./update-preferences');
let automaticUpdates = false, lastUpdateAttempt = 0, lastUpdateCheck = null;
let updateTimer, updateBusy = false;
let updateState = { distribution: distribution.source, status: 'idle', current: app.getVersion(), message: 'Check for a newer stable version.' };
function publishUpdate(value) { value = { current: app.getVersion(), ...value, distribution: distribution.source, managed: distribution.managed, instructions: distribution.message, automatic: automaticUpdates, lastChecked: lastUpdateCheck }; updateState = value; if (window && !window.isDestroyed()) window.webContents.send('airdrop:update-state', value); return value; }
const checkFlatpak = flatpakUpdates.singleFlight(async () => {
  updateBusy = true; publishUpdate({...updateState,status:'checking',message:'Checking for updates…'});
  try { const result = await flatpakUpdates.check({fetcher:net.fetch}); lastUpdateCheck = Date.now(); return publishUpdate(result); }
  catch (error) { return publishUpdate({...updateState,status:'error',message:error.message}); }
  finally { updateBusy = false; }
});
async function checkUpdate() {
  if (['recovery','updated'].includes(updateState.status)) return updateState;
  lastUpdateAttempt = Date.now();
  if (distribution.source === 'flatpak') {
    if (updateState.status === 'updated' || (updateBusy && updateState.status === 'installing')) return updateState;
    return checkFlatpak();
  }
  if (updateBusy) return updateState;
  updateBusy = true; publishUpdate({ ...updateState, status: 'checking', message: 'Checking for updates…' });
  try { const result = await updater.check(app.getVersion(), { fetcher: net.fetch, metadataOnly: distribution.managed }); lastUpdateCheck = Date.now(); return publishUpdate(result); }
  catch (error) { return publishUpdate({ status: 'error', current: app.getVersion(), message: error.message }); }
  finally { updateBusy = false; }
}
function backgroundUpdate() {
  if (process.env.AIRDROP_DISABLE_UPDATE_CHECK || quitting) return;
  if (updatePreferences.due({ automatic: automaticUpdates, busy: updateBusy, sending: sending || (nearby.busy || quickshare.busy), lastAttempt: lastUpdateAttempt })) checkUpdate();
}
const desktopData = process.env.AIRDROP_DESKTOP_USER_DATA || paths.desktopData;
fs.mkdirSync(desktopData, { recursive: true, mode: 0o700 });
app.setPath('userData', desktopData);
const internetAsset=process.platform==='linux'&&require('./core/internet-helper.json').assets[process.arch];
const tailscaleHelper=[path.resolve(__dirname,'../../../runtime/airdrop-tsnet'),path.join(__dirname,'core/bin/airdrop-tsnet')].find(file=>fs.existsSync(file));
const devices = new (require('./core/lib/devices').Devices)({guestRoot:process.env.AIRDROP_SHARE_DIR || paths.files,directory:path.join(desktopData,'connections'),service:require('./core/connection-service.json'),backend:`http://127.0.0.1:${process.env.AIRDROP_API_PORT || 6001}`,
  probe:gateway=>gateway.secure?gateway.probe({request:(...args)=>net.fetch(...args)}):gateway.probe(),
  createTailscaleClient:tailscaleHelper?options=>new (require('./core/lib/tailscale-connection').TailscaleConnection)({...options,helper:tailscaleHelper,directory:path.join(desktopData,'connections')}):undefined,
  createInternetClient:internetAsset?options=>new (require('./core/lib/internet-connection').InternetConnection)({...options,directory:path.join(desktopData,'connection-runtime'),asset:internetAsset,request:net.fetch}):undefined});
let providerLoginWindow;
function signInToProvider(){
  const link=devices.state.mode==='tailscale'&&devices.state.authURL;
  let url;try{url=new URL(link);}catch{throw Error('Reconnect Tailscale to request a new sign-in link.');}
  if(url.protocol!=='https:'||url.hostname!=='login.tailscale.com'||url.username||url.password)throw Error('Invalid provider sign-in address');
  if(providerLoginWindow&&!providerLoginWindow.isDestroyed()){providerLoginWindow.focus();return;}
  providerLoginWindow=new BrowserWindow({width:1000,height:760,parent:window,autoHideMenuBar:true,title:'Tailscale sign-in — login.tailscale.com',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'airdrop-provider-login'}});
  const login=providerLoginWindow;
  login.webContents.session.setPermissionRequestHandler((contents,permission,callback)=>callback(false));
  login.webContents.on('will-navigate',(event,target)=>{try{if(new URL(target).protocol!=='https:')event.preventDefault();}catch{event.preventDefault();}});
  login.webContents.setWindowOpenHandler(({url:target})=>{try{if(new URL(target).protocol==='https:')login.loadURL(target);}catch{}return {action:'deny'};});
  login.webContents.on('did-navigate',(_,target)=>{login.setTitle('Tailscale sign-in — '+new URL(target).hostname);});
  login.on('closed',()=>{providerLoginWindow=null;});
  login.loadURL(url.href);
}
let devicesReady, nearbyReady, quickshareReady;
const nearby = new (require('./core/lib/nearby').Nearby)({
  ...(quickshareLab ? { name: 'Airdrop S24 Lab', port: 0 } : {}),
  maintenanceRoot: paths.root, directory: path.join(desktopData, 'nearby'), inbox: path.join(process.env.AIRDROP_SHARE_DIR || paths.files, 'Received'),
  approve: async request => {
    if (!window || window.isDestroyed() || quitting) return false;
    window.show(); window.focus();
    const pairing = request.type === 'pair';
    const approval = new AbortController(), expiry = setTimeout(() => approval.abort(), 55000); expiry.unref();
    try {
    const response = await dialog.showMessageBox(window, {
      signal: approval.signal, type: 'question', buttons: [pairing ? 'Pair device' : 'Accept files', 'Decline'], defaultId: 1, cancelId: 1,
      message: pairing ? `Pair with “${request.name}”?` : `Receive files from “${request.name}”?`,
      detail: pairing ? `Compare this code on both devices: ${request.code}\nOnly pair if the codes match. Pairing permits file transfer requests, with acceptance required. It grants no workspace or clipboard access.` :
        `${request.code ? 'Compare this code on both devices: ' + request.code + '\n' : ''}${request.files.length} files · ${(request.total ?? request.files.reduce((n, f) => n + (f.size || 0), 0)).toLocaleString()} bytes\n${request.files.slice(0, 8).map(f => f.name).join('\n')}\n${quickshareLab ? 'Saved to the private lab inbox shown in the development panel.' : 'Saved to Airdrop/Received.'} Requests expire after 60 seconds.`
    });
    return response.response === 0;
    } finally { clearTimeout(expiry); }
  }
});
nearby.on('progress', value => { if (window && !window.isDestroyed()) window.webContents.send('airdrop:peer-progress', value); });
const quickshareDirectory = path.resolve(__dirname, '../.cache/quickshare', process.arch);
let quickshareMetadata = {};
try { quickshareMetadata = JSON.parse(fs.readFileSync(path.join(quickshareDirectory, 'helper.json'), 'utf8')); } catch {}
const quickshare = new (require('./core/lib/sharing/quickshare').QuickShare)({
  enabled: process.env.AIRDROP_EXPERIMENTAL_QUICK_SHARE === '1',
  helper: path.join(quickshareDirectory, 'airdrop-quickshare'), sha256: quickshareMetadata.sha256,
  bleFastInit: process.env.AIRDROP_QUICKSHARE_BLE_FASTINIT === '1',
  directory: path.join(desktopData, 'quickshare'), inbox: nearby.store.inbox,
  ...(quickshareLab ? { name: 'Airdrop S24 Lab', port: 0, protocolDiagnostics: true } : {}),
  approve: request => quickshareLab ? quickshareLab.approve(() => nearby.approve(request)) : nearby.approve(request)
});
quickshareLab?.attach(quickshare);
quickshare.on('progress', value => { if (window && !window.isDestroyed()) window.webContents.send('airdrop:peer-progress', { ...value, status: value.phase }); });
quickshare.on('verification', value => { if (window && !window.isDestroyed()) window.webContents.send('airdrop:sharing-verification', value); });
const sharing = new (require('./core/lib/sharing/broker').SharingBroker)({ nearby, devices, quickShare: quickshare });
const shareDir = process.env.AIRDROP_SHARE_DIR || paths.files;
let window, tray, timer, quitting = false, sending = false;
let state = { status: 'offline', label: 'Checking services…' };
const allowedPaths = new Set();

function ownWindow(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Invalid IPC sender');
}
async function health() {
  if (quickshareLab) {
    state = { status: 'lab', label: 'Native Quick Share lab · workspace servers off' };
    if (window && !window.isDestroyed()) window.webContents.send('airdrop:status', state);
    return state;
  }
  const check = async url => {
    try { return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
  };
  const [files, api] = await Promise.all([check(`http://127.0.0.1:${process.env.AIRDROP_FILE_PORT || 5000}/?json`), check(`http://127.0.0.1:${process.env.AIRDROP_API_PORT || 6001}/push/health`)]);
  state = { status: files && api ? 'ready' : files || api ? 'partial' : 'offline',
    label: files && api ? 'Local workspace ready' : files || api ? 'Needs attention' : 'Local server unavailable' };
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
    pwaUrl = workspaceUrl(saved.pwaUrl);
  } catch {}
  return { pwaUrl, deviceName: quickshareLab ? 'Airdrop S24 Lab' : os.hostname() };
}
async function openPwa() {
  if(devices.state.mode !== 'local')return shell.openExternal(`http://127.0.0.1:${process.env.AIRDROP_API_PORT || 6001}/ui/`);
  let { pwaUrl: url } = await readSettings();
  if (!url) {
    const response = await dialog.showMessageBox(window, { type: 'question', buttons: ['Open local web app', 'Cancel'], defaultId: 0,
      message: 'Connect your workspace', detail: 'Set up your Airdrop connection in Settings for access across devices. You can also open the local web app on this computer.' });
    if (response.response !== 0) return;
    url = `http://127.0.0.1:${process.env.AIRDROP_API_PORT || 6001}/ui/`;
  } else if ((await checkConnection(url, net.fetch)).status !== 'reachable') {
    const response = await dialog.showMessageBox(window, { type: 'warning', buttons: ['Open local web app', 'Open saved address', 'Cancel'], defaultId: 0, cancelId: 2,
      message: 'Workspace address unavailable', detail: 'Check the saved server address and its HTTPS configuration. You can keep using the local workspace or try the saved address in your browser.' });
    if (response.response === 2) return;
    if (response.response === 0) url = `http://127.0.0.1:${process.env.AIRDROP_API_PORT || 6001}/ui/`;
  }
  await shell.openExternal(url);
}
function registerIpc() {
  ipcMain.handle('airdrop:sharing', async (event, action, payload = {}) => {
    ownWindow(event); await devicesReady;
    if (action === 'diagnostics') return quickshare.diagnostics();
    if (action === 'lab-info') return quickshareLab?.info() || { enabled: false };
    if (action === 'state') { await nearbyReady.catch(() => {}); return sharing.snapshot(); }
    if (action === 'cancel') return payload.transport === 'quick-share' ? quickshare.cancel(payload.id) : nearby.cancel(payload.id);
    if (action === 'invitation-stop') return sharing.stopInvitation();
    if (action === 'invitation-copy') { clipboard.writeText(sharing.invitationLink()); return; }
    if (action === 'invitation-start' || action === 'send') {
      if (quickshareLab && (action !== 'send' || !payload.recipientId?.startsWith('quick-share:'))) throw Error('This laboratory tests native Quick Share only. Choose a Quick Share recipient.');
      if ((!payload.retryId || payload.recipientId?.startsWith('quick-share:')) && (!Array.isArray(payload.sources) || payload.sources.length > 1000 || !payload.sources.every(p => allowedPaths.has(p)))) throw Error('Choose files first');
      if (quickshareLab) quickshareLab.authorizeSources(payload.sources);
      if (action === 'invitation-start') return sharing.startInvitation(payload);
      if (payload.recipientId?.startsWith('quick-share:')) await quickshareReady; else await nearbyReady;
      return sharing.send(payload);
    }
    throw Error('Unknown sharing action');
  });
  ipcMain.handle('airdrop:nearby', async (event, action, payload = {}) => {
    ownWindow(event); await nearbyReady;
    if (action === 'state') return nearby.snapshot();
    if (action === 'refresh') { await nearby.refresh(); return nearby.snapshot(); }
    if (action === 'pair') return nearby.pair(payload.id);
    if (action === 'configure') return nearby.configure(payload);
    if (action === 'cancel') return nearby.cancel(payload.id);
    if (action === 'cancel-incoming') return nearby.store.cancel(payload.id, payload.peer);
    if (action === 'inbox') return shell.openPath(nearby.store.inbox);
    if (action === 'send') {
      if (quickshareLab) throw Error('This laboratory tests native Quick Share only. Use the Quick Share recipient selector.');
      if (!payload.retryId && (!Array.isArray(payload.sources) || !payload.sources.length || payload.sources.length > 1000 || !payload.sources.every(p => allowedPaths.has(p)))) throw Error('Choose files first');
      return nearby.send(payload.id, payload.sources, payload.retryId);
    }
    throw Error('Unknown nearby action');
  });
  ipcMain.on('airdrop:drag', (event, paths) => {
    try { ownWindow(event); }
    catch { return; }
    const start = files => event.sender.startDrag({ files,
      icon: nativeImage.createFromPath(path.join(__dirname, 'core/ui/icon-192.png')).resize({width:48,height:48}) });
    dragFiles(shareDir, paths, explorer, (files, descriptors) => distribution.source === 'flatpak' ? withPortalFiles(files, descriptors, start) : start(files))
      .catch(error => { if (!event.sender.isDestroyed()) event.sender.send('airdrop:drag-error', error.message); });
  });
  ipcMain.handle('airdrop:devices',async(event,action,payload)=>{
    ownWindow(event);await devicesReady;
    if (quickshareLab && !['state', 'preferences'].includes(action)) throw Error('Use native Quick Share in the laboratory Transfer view; connection providers are not part of this test.');
    if(action==='guest-start'){
      let sources=[];
      if(payload?.selectFiles){const chosen=await dialog.showOpenDialog(window,{title:'Choose files for this guest session',properties:['openFile','multiSelections']});if(chosen.canceled)return null;sources=chosen.filePaths;}
      return devices.startGuest(sources);
    }
    if(action==='guest-stop')return devices.stopGuest();
    if(action==='state'){if(devices.state.status==='ready')providerLoginWindow?.close();return {...await devices.snapshot(),background:backgroundPolicy.snapshot()};}
    if(action==='preferences'||action==='finish-setup'){
      if(action==='finish-setup'&&devices.state.status!=='ready')throw Error('Reconnect before finishing setup.');
      if(action==='finish-setup'&&typeof payload?.background!=='boolean')throw Error('Choose a background sharing option.');
      const result=await devices.configure(payload);
      if('background' in payload){
        const granted=await backgroundPolicy.set(payload.background);
        if(quitting)return result;
        await devices.configure({background:granted});
      }
      if(action==='finish-setup')await devices.completeSetup();
      return {...await devices.snapshot(),background:backgroundPolicy.snapshot()};
    }
    if(action==='mode'){providerLoginWindow?.close();return devices.action(payload?.mode,payload?.address);}
    if(action==='provider-login')return signInToProvider();
    if(action==='verify-with-phone')return devices.verifyWithPhone();
    if(action==='copy-verification'){if(devices.state.status!=='phone-verification'||!devices.state.verificationUrl)throw Error('Start phone verification first.');await clipboard.writeText(devices.state.verificationUrl);return;}
    if(action==='copy-diagnostics'){const report={version:app.getVersion(),platform:process.platform,architecture:process.arch,localServices:{status:state.status,label:state.label},...devices.connectionReport()};await clipboard.writeText(JSON.stringify(report,null,2));return;}
    if(action==='copy'){if(!devices.state.url)throw Error('No verified sharing link');await clipboard.writeText(devices.state.url);return;}
    throw Error('Unknown connection action');
  });
  ipcMain.handle('airdrop:quit', event => { ownWindow(event); app.quit(); });
  ipcMain.handle('airdrop:update', async (event, action, payload) => {
    ownWindow(event);
    if (action === 'state') return updateState;
    if (action === 'preferences') {
      const saved = await updatePreferences.write(desktopData, payload);
      automaticUpdates = saved.automatic;
      return publishUpdate(updateState);
    }
    if (action === 'release-notes') {
      if (!/^\d+\.\d+\.\d+$/.test(updateState.version || '')) throw Error('Check for updates first');
      await shell.openExternal(`https://github.com/fluffydisk/airdrop-linux/releases/tag/v${updateState.version}`);
      return updateState;
    }
    if (action === 'copy-instructions') {
      if (!distribution.managed || !distribution.message) throw Error('This installation has no package-manager instructions');
      clipboard.writeText(distribution.message);
      return updateState;
    }
    if (action === 'check') return checkUpdate();
    if (action === 'finish' && updateState.status === 'updated' && !distribution.managed) {
      if (sending || (nearby.busy || quickshare.busy)) throw Error('Wait for the current transfer to finish before quitting');
      await require('./core/lib/maintenance').drain(paths.root, 0);
      return app.quit();
    }
    if (action === 'recover') {
      if (distribution.managed || process.env.APPIMAGE || updateBusy || updateState.status !== 'recovery') throw Error('No interrupted standalone update to recover');
      if (sending || (nearby.busy || quickshare.busy)) throw Error('Wait for the current transfer to finish before recovery');
      updateBusy = true;
      try {
        await require('./core/lib/maintenance').drain(paths.root, 0);
        await updater.recover(paths.root);
        return publishUpdate({ status: 'updated', message: 'Previous version restored. Quit and reopen Airdrop before trying the update again.' });
      } catch (error) { return publishUpdate({ status: 'recovery', message: `Recovery failed: ${error.message}` }); }
      finally { updateBusy = false; }
    }
    if (distribution.source === 'flatpak') {
      if (action === 'finish' && updateState.status === 'updated') {
        if (sending || (nearby.busy || quickshare.busy)) throw Error('Wait for the current transfer to finish before quitting');
        await require('./core/lib/maintenance').drain(paths.root, 0);
        return app.quit();
      }
      if (action !== 'install' || updateState.status !== 'available' || updateBusy) throw Error('Check for updates first');
      if (sending || (nearby.busy || quickshare.busy)) throw Error('Wait for the current transfer to finish before updating');
      updateBusy = true; publishUpdate({...updateState,status:'installing',message:'Requesting the Flatpak update…'});
      try { await flatpakUpdates.install(value=>publishUpdate({...updateState,...value})); }
      catch(error){publishUpdate({...updateState,status:'error',message:error.message});}
      finally{updateBusy=false;}
      return updateState;
    }
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
      const prepared = await updater.prepare(paths.root, release, { progress: fraction => publishUpdate({ ...release, status: 'downloading', progress: Math.round(fraction * 100), message: `Downloading update: ${Math.round(fraction * 100)}%` }) });
      publishUpdate({ ...release, status: 'installing', message: 'Finishing transfers, then restarting Airdrop. Linux may request service-management permission.' });
      while (sending || (nearby.busy || quickshare.busy)) await new Promise(resolve => setTimeout(resolve, 100));
      await nearby.stop();
      await updater.launch(paths.root, prepared, process.pid);
      quitting = true; app.quit();
      return updateState;
    } catch (error) { if (nearby.settings?.enabled !== false) await nearby.start().catch(() => {}); return publishUpdate({ ...release, status: 'available', message: `Update failed: ${error.message}` }); }
    finally { updateBusy = false; }
  });
  ipcMain.handle('airdrop:clipboard-read', event => { ownWindow(event); return clipboard.readText(); });
  ipcMain.handle('airdrop:clipboard-copy', (event, text) => { ownWindow(event); validateText(text); return clipboard.writeText(text); });
  ipcMain.handle('airdrop:clipboard-load', event => { ownWindow(event); return readSharedClipboard(shareDir); });
  ipcMain.handle('airdrop:clipboard-share', (event, text) => { ownWindow(event); return operation(() => writeSharedClipboard(shareDir, text)); });
  ipcMain.handle('airdrop:choose', async event => {
    ownWindow(event);
    const result = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'], ...(quickshareLab ? { defaultPath: path.join(quickshareLab.root, 'fixtures') } : {}) });
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
    if (quickshareLab) throw Error('Workspace sends are disabled in this native Quick Share laboratory.');
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
      move: () => explorer.move(shareDir, payload.directory || '', payload.paths),
      deleteTrash: () => explorer.deleteTrash(shareDir, payload.ids),
      copy: () => explorer.copy(shareDir, payload.directory || '', payload.paths, payload.name),
      trash: () => explorer.trash(shareDir, payload.paths),
      restore: () => explorer.restore(shareDir, payload.id),
      paste: async () => {
        const sources = await readClipboardFiles(clipboard, {retrieveFiles: distribution.source === 'flatpak' ? retrieveClipboardFiles : undefined});
        if (sources) {
          const target = await explorer.directory(shareDir, payload.directory || '');
          try {
            const results = await sendFiles(target.path, sources, false, { anchored:true });
            const failed = results.filter(item => !item.ok);
            if (failed.length) throw new Error('Some clipboard files could not be copied. Use Choose files to grant access: ' + failed.map(item => item.name).join(', '));
            return results;
          } finally { await target.close(); }
        }
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
  ipcMain.handle('airdrop:connection', async event => { ownWindow(event); return checkConnection((await readSettings()).pwaUrl, net.fetch); });
  ipcMain.handle('airdrop:status', event => { ownWindow(event); return state; });
  ipcMain.handle('airdrop:folder', async (event, relative = '') => {
    ownWindow(event);
    const directory = await explorer.directory(shareDir, relative);
    try {
      const actual = await fs.promises.realpath(directory.path);
      await openFolder(actual, { flatpak: distribution.source === 'flatpak', shell });
    } finally { await directory.close(); }
  });
  ipcMain.handle('airdrop:pwa', event => { ownWindow(event); return openPwa(); });
  ipcMain.handle('airdrop:save-url', async (event, input) => {
    ownWindow(event);
    const url = workspaceUrl(input);
    await fs.promises.mkdir(app.getPath('userData'), { recursive: true });
    await fs.promises.writeFile(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({ pwaUrl: url }), { mode: 0o600 });
    return url;
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  if (distribution.source === 'flatpak') process.stdout.write('AIRDROP_START_BACKEND\n');
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.on('before-quit', event => {
    backgroundPolicy.stop();
    if (distribution.source === 'snap' && !quitting) {
      event.preventDefault(); quitting = true;
      require('./core/lib/backend-control').request(paths.root,'stop')
        .then(() => Promise.all([sharing.stop(), devices.stop(), nearby.stop()])).then(() => app.quit())
        .catch(error => {
          quitting = false;
          console.error('Could not stop sharing:',error.message);
          dialog.showErrorBox('Sharing could not be stopped', 'Try again or stop the Airdrop user service from the host.');
        });
      return;
    }
    if(!quitting){event.preventDefault();quitting=true;quickshareLab?.evidence.event('shutdown-requested');Promise.all([sharing.stop(), devices.stop(), nearby.stop()]).finally(()=>app.quit());return;}
    quitting = true; clearInterval(timer); clearInterval(updateTimer); });
  app.whenReady().then(async () => {
    devicesReady = devices.initialize();
    nearbyReady = nearby.initialize().catch(error => { console.error('Nearby unavailable:', error.message); throw error; });
    nearbyReady.catch(() => {});
    quickshareReady = quickshare.start().catch(error => { quickshare.failure(error.message, false); }).finally(() => quickshareLab?.ready());
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
    if (quickshareLab) {
      const title = 'Airdrop S24 Lab — DEVELOPMENT ' + quickshareLab.marker.commit.slice(0, 12);
      window.setTitle(title);
      window.on('page-title-updated', event => { event.preventDefault(); window.setTitle(title); });
    }
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
    window.on('close', event => { if (!quitting && backgroundPolicy.active) { event.preventDefault(); window.hide(); } });
    await devicesReady;
    const backgroundRequest=backgroundPolicy.set(devices.preferences.background),backgroundGeneration=backgroundPolicy.generation;
    backgroundRequest.then(async granted => {
      if (!quitting && backgroundGeneration===backgroundPolicy.generation && granted !== devices.preferences.background) await devices.configure({background:granted});
    }).catch(error => console.warn('Background setting unavailable:',error.message));
    await health(); timer = setInterval(health, 5000);
    automaticUpdates = (await updatePreferences.read(desktopData)).automatic;
    publishUpdate(updateState);
    const journal = await updater.readJournal(paths.root);
    if (journal && !['complete','rolled-back'].includes(journal.phase) && !distribution.managed && !process.env.APPIMAGE) {
      automaticUpdates = false;
      publishUpdate({status:'recovery',message:'An earlier update was interrupted. Restore the previous version before checking again.'});
    } else if (journal?.phase === 'rolled-back') publishUpdate({ ...updateState, message: `Previous update was rolled back: ${journal.error || 'interrupted installation'}` });
    // Give setup and transfers priority; timers only discover, never install.
    if (!process.env.AIRDROP_DISABLE_UPDATE_CHECK) updateTimer = setInterval(backgroundUpdate, 60000);
  }).catch(error => { console.error(error); app.quit(); });
  app.on('window-all-closed', () => { if (!backgroundPolicy.active) app.quit(); });
  app.once('will-quit', () => quickshareLab?.close());
}
