'use strict';
const MAX_ZIP = 100 * 1024 * 1024;
let files = [], busy = false, activeView = 'transfer', selectionVersion = 0;
const result = document.getElementById('result');
const sendButton = document.getElementById('send');
const zipInput = document.getElementById('zip');
function message(text, kind = 'success', target = result) {
  if (target === result && activeView === 'files') { fileExplorer.say(text); return; }
  target.textContent = text; target.dataset.kind = kind; target.hidden = !text;
}
function report(error) {
  const text = (error.message || String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  message(text, 'error', activeView === 'settings' ? document.getElementById('settingsResult') : activeView === 'activity' ? document.getElementById('activityResult') : result);
}
function formatSize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 ** 2).toFixed(1)} MB`;
}
function icon(id, className) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + id); svg.append(use); svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  return svg;
}
function status(value) {
  const node = document.getElementById('health'); node.textContent = value.label; node.dataset.status = value.status;
  node.title = value.status === 'ready' ? 'Local files and clipboard are available. See Connect device for your active pairing link.' : 'Waiting for local services. See Connect device for Tailscale or trusted LAN sharing.';
}
function theme(value) {
  const preference = value;
  if (value === 'system') value = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = value;
  try { localStorage.setItem('airdrop-theme', preference); } catch {}
  document.getElementById('themeToggle').setAttribute('aria-label', `Switch to ${value === 'dark' ? 'light' : 'dark'} theme`);
  document.querySelectorAll('[data-theme-choice]').forEach(button => { button.classList.toggle('selected', button.dataset.themeChoice === preference); button.setAttribute('aria-pressed', String(button.dataset.themeChoice === preference)); });
}
try { theme(['light','dark','system'].includes(localStorage.getItem('airdrop-theme')) ? localStorage.getItem('airdrop-theme') : 'system'); } catch { theme('light'); }
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => { try { if (localStorage.getItem('airdrop-theme') === 'system') theme('system'); } catch {} });
function navigate(view) {
  if (view === 'connect') { view = 'settings'; document.getElementById('connectionSettings').open = true; }
  activeView = view;
  for (const name of ['transfer', 'files', 'clipboard', 'activity', 'settings']) document.getElementById('view-' + name).hidden = name !== view;
  document.querySelectorAll('[data-view]').forEach(button => { button.classList.toggle('selected', button.dataset.view === view); if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  document.getElementById('viewLabel').textContent = view[0].toUpperCase() + view.slice(1);
  if (view === 'activity') loadActivity();
  if (view === 'files') fileExplorer.refresh();
}
function fileRow(file, removable) {
  const row = document.createElement('li'); row.className = 'file-row';
  const symbol = document.createElement('span'); symbol.className = 'file-icon'; symbol.append(icon('file'));
  const details = document.createElement('div'); details.className = 'file-details';
  const name = document.createElement('span'); name.className = 'file-name'; name.textContent = file.name; name.title = file.name;
  const meta = document.createElement('span'); meta.className = 'file-meta';
  meta.textContent = formatSize(file.size) + (file.modified ? ' · ' + new Date(file.modified).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ' · Ready to send');
  details.append(name, meta); row.append(symbol, details);
  if (removable) {
    const remove = document.createElement('button'); remove.className = 'file-remove'; remove.title = `Remove ${file.name}`; remove.setAttribute('aria-label', remove.title); remove.disabled = busy; remove.append(icon('x'));
    remove.onclick = () => { if (!busy) { files = files.filter(item => item.path !== file.path); renderQueue(); } };
    row.append(remove);
  } else { const check = icon('check'); check.classList.add('shared-check'); row.append(check); }
  return row;
}
function renderQueue() {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  document.getElementById('files').replaceChildren(...files.map(file => fileRow(file, true)));
  document.getElementById('queueEmpty').hidden = files.length > 0;
  document.getElementById('fileCount').textContent = files.length;
  document.getElementById('navCount').textContent = files.length;
  document.getElementById('navCount').hidden = !files.length;
  document.getElementById('clearFiles').hidden = !files.length;
  document.getElementById('clearFiles').disabled = busy;
  document.getElementById('queueSummary').textContent = files.length ? `${files.length} ${files.length === 1 ? 'file' : 'files'} · ${formatSize(total)} total` : 'Your next transfer starts here.';
  zipInput.disabled = busy;
  document.getElementById('zipHint').textContent = total > MAX_ZIP ? 'Over 100 MiB. Send separately.' : 'One neat package. Up to 100 MiB.';
  sendButton.disabled = busy || !files.length; sendButton.hidden = !files.length;
  sendButton.replaceChildren(document.createTextNode(busy ? 'Sending…' : 'Retry failed files'), icon('send'));
  document.getElementById('choose').disabled = busy || files.length > 0;
  document.body.classList.toggle('busy', busy);
}
let transferTarget = '', transferZip = false;
async function select(paths) {
  if (!paths.length || busy || files.length) return;
  const version = ++selectionVersion;
  transferTarget = fileExplorer.directory; transferZip = zipInput.checked;
  try {
    const next = await window.airdrop.describe(paths);
    if (version !== selectionVersion || busy) return;
    const merged = new Map();
    for (const file of next) merged.set(file.path, file);
    if (merged.size > 1000) throw new Error('You can send up to 1000 files at a time.');
    files = [...merged.values()];
    message(''); renderQueue();
    await sendButton.onclick();
  } catch (error) { report(error); }
}
async function loadActivity() {
  const empty = document.getElementById('activityEmpty');
  const refresh = document.getElementById('refreshActivity'); refresh.disabled = true;
  try {
    const recent = await window.airdrop.recent();
    document.getElementById('recentFiles').replaceChildren(...recent.map(file => fileRow(file, false)));
    empty.textContent = 'Nothing here yet. Send your first file.'; empty.hidden = recent.length > 0;
  } catch { document.getElementById('recentFiles').replaceChildren(); empty.hidden = false; empty.textContent = 'Your shared folder is unavailable. Open it from the sidebar or check your installation.'; }
  finally { refresh.disabled = false; }
}
const fileExplorer = AirdropExplorer.mount(document.getElementById('fileExplorer'), {
  list: directory => window.airdrop.explore('list', { directory }),
  open: path => window.airdrop.explore('open', { path }),
  mkdir: (directory, name) => window.airdrop.explore('mkdir', { directory, name }),
  copy: (directory, paths, name) => window.airdrop.explore('copy', { directory, paths, name }),
  trash: paths => window.airdrop.explore('trash', { paths }),
  trashList: () => window.airdrop.explore('trashList'),
  move: (directory, paths) => window.airdrop.explore('move', {directory, paths}),
  deleteTrash: ids => window.airdrop.explore('deleteTrash', {ids}),
  restore: id => window.airdrop.explore('restore', { id }),
  paste: directory => window.airdrop.explore('paste', { directory }),
  pasteFiles: async (directory, files) => {
    let sources;
    try { sources = await window.airdrop.drop(files); }
    catch (error) {
      // Browser clipboard images are in-memory Files, without a native path.
      // The main process decodes these through Electron's clipboard API.
      if (error.message.includes('Invalid dropped files')) return window.airdrop.explore('paste', {directory});
      throw error;
    }
    const results = await window.airdrop.send(sources, false, directory);
    const failed = results.filter(file => !file.ok);
    if (failed.length) throw new Error(failed.map(file => `${file.name}: ${file.error}`).join('; '));
  },
  drag: paths => window.airdrop.drag(paths),
  reveal: directory => window.airdrop.folder(directory),
  download: paths => window.airdrop.explore('download', { paths })
}, { enabled: () => ['transfer', 'files'].includes(activeView) && !busy,
  choose: () => { if (!busy && !files.length) return window.airdrop.choose().then(select).catch(report); },
  onMessage: text => { if (activeView === 'transfer') message(text); },
  onNavigate: directory => { document.getElementById('transferDestination').textContent = 'Destination: Airdrop/' + directory; }
});
window.airdrop.onShowFiles(() => navigate('files'));
window.airdrop.onDragError?.(error => fileExplorer.say(error));
let dismissedVersion = '';
function updateState(state) {
  document.getElementById('stopSharing').textContent = ['flatpak','snap'].includes(state.distribution) ? 'Stop sharing and quit' : 'Quit desktop';
  document.getElementById('updateState').textContent = state.message || `Current version: ${state.current}`;
  document.getElementById('checkUpdate').disabled = ['checking', 'downloading', 'installing'].includes(state.status);
  document.getElementById('installUpdate').hidden = !['available','updated'].includes(state.status);
  document.getElementById('installUpdate').textContent = state.status === 'updated' ? 'Quit to finish update' : state.distribution === 'appimage' ? 'Download AppImage update' : 'Update';
  document.getElementById('portableNote').hidden = state.distribution !== 'appimage';
  const show = state.status === 'available' && dismissedVersion !== state.version;
  document.getElementById('updateBanner').hidden = !show;
  document.getElementById('updateNotice').textContent = state.distribution === 'flatpak' ? 'An Airdrop update is available.' : `Airdrop ${state.version} is available.`;
  document.getElementById('dismissUpdate').onclick = () => { dismissedVersion = state.version; document.getElementById('updateBanner').hidden = true; };
}
window.airdrop.onUpdate(updateState);
window.airdrop.update('state').then(updateState).catch(report);
document.getElementById('checkUpdate').onclick = () => window.airdrop.update('check').then(updateState).catch(report);
document.getElementById('installUpdate').onclick = () => window.airdrop.update(document.getElementById('installUpdate').textContent === 'Quit to finish update' ? 'finish' : 'install').then(updateState).catch(report);
document.getElementById('showUpdate').onclick = () => navigate('settings');
window.airdrop.onStatus(status); window.airdrop.status().then(status).catch(report);
window.airdrop.settings().then(settings => { document.getElementById('url').value = settings.pwaUrl; document.getElementById('deviceName').textContent = settings.deviceName || 'This computer'; }).catch(report);
document.querySelectorAll('[data-view]').forEach(button => { button.onclick = () => navigate(button.dataset.view); });
document.querySelector('.brand').onclick = event => { event.preventDefault(); navigate('transfer'); };
document.getElementById('themeToggle').onclick = () => theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
document.querySelectorAll('[data-theme-choice]').forEach(button => { button.onclick = () => theme(button.dataset.themeChoice); });
document.getElementById('refreshActivity').onclick = loadActivity;
document.getElementById('choose').onclick = () => { if (!busy) window.airdrop.choose().then(select).catch(report); };
document.getElementById('clearFiles').onclick = () => { if (!busy) { selectionVersion++; files = []; renderQueue(); message(''); } };
try { zipInput.checked = localStorage.getItem('airdrop-zip') === 'true'; } catch {}
zipInput.onchange = () => { try { localStorage.setItem('airdrop-zip', String(zipInput.checked)); } catch {} renderQueue(); };
const dropZone = document.getElementById('dropZone');
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => {
  event.preventDefault();
  if (!busy && ['transfer', 'files'].includes(activeView)) window.airdrop.drop(Array.from(event.dataTransfer.files)).then(select).catch(report);
});
dropZone.addEventListener('keydown', event => { if (event.target === dropZone && ['Enter', ' '].includes(event.key)) { event.preventDefault(); document.getElementById('choose').click(); } });
dropZone.addEventListener('dragover', event => { event.preventDefault(); if (!busy) dropZone.classList.add('active'); });
dropZone.addEventListener('dragleave', event => { if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('active'); });
dropZone.addEventListener('drop', event => { event.preventDefault(); event.stopPropagation(); dropZone.classList.remove('active'); if (!busy) Promise.resolve().then(() => window.airdrop.drop(Array.from(event.dataTransfer.files))).then(select).catch(report); });
sendButton.onclick = async () => {
  if (busy || !files.length) return;
  selectionVersion++; busy = true; renderQueue(); message('Preparing your transfer…', 'pending');
  try {
    const bundled = transferZip;
    if (bundled && files.reduce((sum, file) => sum + file.size, 0) > MAX_ZIP) throw new Error('ZIP source files exceed 100 MiB. Turn off ZIP and select the files again.');
    const results = await window.airdrop.send(files.map(file => file.path), bundled, transferTarget);
    const failed = results.filter(file => !file.ok);
    message(results.map(file => file.ok ? `Sent: ${file.name}` : `Failed: ${file.name} (${file.error})`).join('; '), failed.length ? 'error' : 'success');
    files = bundled ? failed.length ? files : [] : files.filter((file, index) => !results[index].ok);
  } catch (error) { report(error); }
  finally { busy = false; renderQueue(); fileExplorer.refresh(); if (activeView === 'activity') loadActivity(); }
};
document.getElementById('folder').onclick = () => window.airdrop.folder(fileExplorer.directory).catch(report);
document.getElementById('pasteTransfer').onclick = async () => {
  if (busy || files.length) return;
  try { await window.airdrop.explore('paste', {directory:fileExplorer.directory}); await fileExplorer.refresh(); message('Pasted into shared folder', 'success'); }
  catch (error) { report(error); }
};
document.getElementById('pwa').onclick = () => window.airdrop.pwa().catch(report);
document.getElementById('saveUrl').onclick = async () => {
  const button = document.getElementById('saveUrl'); button.disabled = true;
  try { const url = await window.airdrop.saveUrl(document.getElementById('url').value.trim()); document.getElementById('url').value = url; message(`Saved: ${url}. Connection has not been checked.`, 'success', document.getElementById('settingsResult')); document.getElementById('connectionResult').hidden = true; }
  catch (error) { report(error); }
  finally { button.disabled = false; }
};
document.getElementById('checkConnection').onclick = async () => {
  const button = document.getElementById('checkConnection'); button.disabled = true;
  const target = document.getElementById('connectionResult');
  message('Checking the saved address…', 'pending', target);
  try { const connection = await window.airdrop.checkConnection(); message(connection.message, connection.status === 'reachable' ? 'success' : 'error', target); }
  catch (error) { message(error.message, 'error', target); }
  finally { button.disabled = false; }
};
renderQueue();

const clipboardText = document.getElementById('clipboardText');
const clipboardResult = document.getElementById('clipboardResult');
let clipboardBusy = false;
function updateClipboardControls() {
  for (const id of ['pasteClipboard', 'loadClipboard', 'copyClipboard', 'shareClipboard']) {
    document.getElementById(id).disabled = clipboardBusy || (['copyClipboard', 'shareClipboard'].includes(id) && !clipboardText.value.length);
  }
  clipboardText.disabled = clipboardBusy;
}
clipboardText.addEventListener('input', updateClipboardControls);
for (const [id, action, success] of [
  ['pasteClipboard', async () => {
    const text = await window.airdrop.readClipboard();
    if (!text) throw new Error('Your computer clipboard has no text.');
    clipboardText.value = text;
  }, 'Pasted from this computer. Edit the text or select Share text.'],
  ['loadClipboard', async () => {
    const text = await window.airdrop.loadClipboard();
    if (text === null) throw new Error('No shared text yet. Share text from another device first.');
    clipboardText.value = text;
  }, 'Shared text loaded. Select Copy to computer to use it here.'],
  ['copyClipboard', () => window.airdrop.copyClipboard(clipboardText.value), 'Copied to this computer’s clipboard.'],
  ['shareClipboard', () => window.airdrop.shareClipboard(clipboardText.value), 'Text shared with your devices.']
]) {
  document.getElementById(id).onclick = async () => {
    if (clipboardBusy) return;
    clipboardBusy = true; updateClipboardControls();
    message('Working…', 'pending', clipboardResult);
    try { await action(); message(success, 'success', clipboardResult); }
    catch (error) { message((error.message || String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''), 'error', clipboardResult); }
    finally { clipboardBusy = false; updateClipboardControls(); }
  };
}

document.getElementById('stopSharing').onclick = () => window.airdrop.quit().catch(report);

// Presentation preferences never change sharing permissions or node identity.
const preferences = [
  ['accentPreference', 'airdrop-accent', 'blue', ['blue','purple','green','orange']],
  ['densityPreference', 'airdrop-density', 'comfortable', ['comfortable','compact']],
  ['startPreference', 'airdrop-start-view', 'transfer', ['transfer','files','clipboard']],
  ['sortPreference', 'airdrop-file-sort', 'name-asc', ['name-asc','name-desc','date-desc','date-asc','size-desc','size-asc','type-asc']],
  ['motionPreference', 'airdrop-reduce-motion', 'false', ['true','false']],
  ['zipPreference', 'airdrop-zip', 'false', ['true','false']]
];
function applyPreferences() {
  for (const [id, key, fallback, allowed] of preferences) {
    let value = fallback; try { const saved = localStorage.getItem(key); if (allowed.includes(saved)) value = saved; } catch {}
    const control = document.getElementById(id);
    if (control.type === 'checkbox') control.checked = value === 'true'; else control.value = value;
    if (key === 'airdrop-accent') document.documentElement.dataset.accent = value;
    if (key === 'airdrop-density') document.documentElement.dataset.density = value;
    if (key === 'airdrop-reduce-motion') document.documentElement.dataset.reduceMotion = value;
    if (key === 'airdrop-zip' && !busy) zipInput.checked = value === 'true';
  }
}
for (const [id, key] of preferences) document.getElementById(id).onchange = event => {
  try { localStorage.setItem(key, event.target.type === 'checkbox' ? String(event.target.checked) : event.target.value); } catch {}
  applyPreferences(); window.dispatchEvent(new CustomEvent('airdrop-preferences'));
};
document.getElementById('resetPreferences').onclick = () => {
  for (const [, key] of preferences) { try { localStorage.removeItem(key); } catch {} }
  try { localStorage.removeItem('airdrop-file-view'); } catch {}
  theme('system'); applyPreferences(); window.dispatchEvent(new CustomEvent('airdrop-preferences')); renderQueue();
};
applyPreferences();
try { const start = localStorage.getItem('airdrop-start-view'); if (['files','clipboard'].includes(start)) navigate(start); } catch {}
