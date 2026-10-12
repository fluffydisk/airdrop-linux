'use strict';
const MAX_ZIP = 100 * 1024 * 1024;
let files = [], busy = false, activeView = 'transfer', selectionVersion = 0;
const result = document.getElementById('result');
const sendButton = document.getElementById('send');
const zipInput = document.getElementById('zip');
function message(text, kind = 'success', target = result) {
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
  node.title = value.status === 'ready' ? 'Your workspace is ready for your other devices.' : 'Start the Airdrop services to make files available across your devices.';
}
function theme(value) {
  document.documentElement.dataset.theme = value;
  try { localStorage.setItem('airdrop-theme', value); } catch {}
  document.getElementById('themeToggle').setAttribute('aria-label', `Switch to ${value === 'dark' ? 'light' : 'dark'} theme`);
  document.querySelectorAll('[data-theme-choice]').forEach(button => { button.classList.toggle('selected', button.dataset.themeChoice === value); button.setAttribute('aria-pressed', String(button.dataset.themeChoice === value)); });
}
try { theme(localStorage.getItem('airdrop-theme') === 'dark' ? 'dark' : 'light'); } catch { theme('light'); }
function navigate(view) {
  activeView = view;
  for (const name of ['transfer', 'activity', 'settings']) document.getElementById('view-' + name).hidden = name !== view;
  document.querySelectorAll('[data-view]').forEach(button => { button.classList.toggle('selected', button.dataset.view === view); if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  document.getElementById('viewLabel').textContent = view[0].toUpperCase() + view.slice(1);
  if (view === 'activity') loadActivity();
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
  zipInput.disabled = busy || total > MAX_ZIP;
  if (total > MAX_ZIP) zipInput.checked = false;
  document.getElementById('zipHint').textContent = total > MAX_ZIP ? 'Over 100 MiB. Send separately.' : 'One neat package. Up to 100 MiB.';
  sendButton.disabled = busy || !files.length;
  sendButton.replaceChildren(document.createTextNode(busy ? 'Sending…' : zipInput.checked ? 'Send ZIP' : 'Send files'), icon('send'));
  document.getElementById('choose').disabled = busy;
  document.body.classList.toggle('busy', busy);
}
async function select(paths) {
  if (!paths.length || busy) return;
  const version = ++selectionVersion;
  try {
    const next = await window.airdrop.describe(paths);
    if (version !== selectionVersion || busy) return;
    const merged = new Map(files.map(file => [file.path, file]));
    for (const file of next) merged.set(file.path, file);
    if (merged.size > 1000) throw new Error('You can send up to 1000 files at a time.');
    files = [...merged.values()];
    message(''); renderQueue();
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
window.airdrop.onStatus(status); window.airdrop.status().then(status).catch(report);
window.airdrop.settings().then(settings => { document.getElementById('url').value = settings.pwaUrl; document.getElementById('deviceName').textContent = settings.deviceName || 'This computer'; }).catch(report);
document.querySelectorAll('[data-view]').forEach(button => { button.onclick = () => navigate(button.dataset.view); });
document.querySelector('.brand').onclick = event => { event.preventDefault(); navigate('transfer'); };
document.getElementById('themeToggle').onclick = () => theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
document.querySelectorAll('[data-theme-choice]').forEach(button => { button.onclick = () => theme(button.dataset.themeChoice); });
document.getElementById('refreshActivity').onclick = loadActivity;
document.getElementById('choose').onclick = () => { if (!busy) window.airdrop.choose().then(select).catch(report); };
document.getElementById('clearFiles').onclick = () => { if (!busy) { selectionVersion++; files = []; renderQueue(); message(''); } };
zipInput.onchange = renderQueue;
const dropZone = document.getElementById('dropZone');
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => event.preventDefault());
dropZone.addEventListener('keydown', event => { if (event.target === dropZone && ['Enter', ' '].includes(event.key)) { event.preventDefault(); document.getElementById('choose').click(); } });
dropZone.addEventListener('dragover', event => { event.preventDefault(); if (!busy) dropZone.classList.add('active'); });
dropZone.addEventListener('dragleave', event => { if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('active'); });
dropZone.addEventListener('drop', event => { event.preventDefault(); dropZone.classList.remove('active'); if (!busy) Promise.resolve().then(() => window.airdrop.drop(Array.from(event.dataTransfer.files))).then(select).catch(report); });
sendButton.onclick = async () => {
  if (busy || !files.length) return;
  selectionVersion++; busy = true; renderQueue(); message('Preparing your transfer…', 'pending');
  try {
    const bundled = zipInput.checked;
    const results = await window.airdrop.send(files.map(file => file.path), bundled);
    const failed = results.filter(file => !file.ok);
    message(results.map(file => file.ok ? `Sent: ${file.name}` : `Failed: ${file.name} (${file.error})`).join('; '), failed.length ? 'error' : 'success');
    files = bundled ? failed.length ? files : [] : files.filter((file, index) => !results[index].ok);
  } catch (error) { report(error); }
  finally { busy = false; renderQueue(); if (activeView === 'activity') loadActivity(); }
};
document.getElementById('folder').onclick = () => window.airdrop.folder().then(text => { if (text) report(text); }).catch(report);
document.getElementById('pwa').onclick = () => window.airdrop.pwa().catch(report);
document.getElementById('saveUrl').onclick = async () => {
  const button = document.getElementById('saveUrl'); button.disabled = true;
  try { const url = await window.airdrop.saveUrl(document.getElementById('url').value.trim()); document.getElementById('url').value = url; message(`Saved: ${url}`, 'success', document.getElementById('settingsResult')); }
  catch (error) { report(error); }
  finally { button.disabled = false; }
};
renderQueue();
