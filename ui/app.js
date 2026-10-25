const statusEl = document.getElementById('status');
const fileInput = document.getElementById('fileInput');
const fileListCard = document.getElementById('fileListCard');
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => navbar.classList.toggle('scrolled', window.scrollY > 28));
let selectedFiles = [], pendingShareId = null, sending = false, retryTarget = null, retryZip = false, preparedZip = null;
const sendPanel = document.getElementById('sendPanel');
const sendZip = document.getElementById('sendZip');
try { sendZip.checked = localStorage.getItem('airdrop-zip') === 'true'; } catch {}
sendZip.onchange = () => { try { localStorage.setItem('airdrop-zip', String(sendZip.checked)); } catch {} };
function setStatus(msg, cls = '') { statusEl.textContent = msg; statusEl.className = 'status ' + cls; }
async function api(route, body, method = 'POST') {
  const response = await fetch('/push/explorer' + route, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || 'File operation failed'); return value;
}
async function uploadFile(file, directory) {
  setStatus(`Uploading: ${file.name}`);
  try {
    const response = await fetch('/push/explorer/file?directory=' + encodeURIComponent(directory) + '&name=' + encodeURIComponent(file.name), { method: 'PUT', body: file });
    const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Upload failed'); return { ok: true, ...value };
  } catch (error) { return { ok: false, name: file.name, error: error.message }; }
}
const explorer = AirdropExplorer.mount(fileListCard, {
  list: async directory => (await api('?directory=' + encodeURIComponent(directory), null, 'GET')).entries,
  mkdir: (directory, name) => api('/directories', { directory, name }),
  copy: (directory, paths, name) => api('/copy', { directory, paths, name }),
  trash: async paths => (await api('/trash', { paths })).results,
  trashList: async () => (await api('/trash', null, 'GET')).entries,
  restore: id => api('/trash/' + encodeURIComponent(id) + '/restore'),
  upload: async (directory, file) => { const result = await uploadFile(file, directory); if (!result.ok) throw new Error(result.error); setStatus(`Pasted: ${result.name}`, 'ok'); return result; },
  download: async paths => {
    await api('/download', { paths, validateOnly: true });
    const form = document.createElement('form'); form.method = 'POST'; form.action = '/push/explorer/download';
    const input = document.createElement('input'); input.type = 'hidden'; input.name = 'paths'; input.value = JSON.stringify(paths);
    // An iframe keeps mobile browsers on the manager while native downloads stream.
    let frame = document.getElementById('downloadFrame');
    if (!frame) { frame = document.createElement('iframe'); frame.id = 'downloadFrame'; frame.name = 'airdropDownload'; frame.hidden = true; document.body.append(frame); }
    form.target = frame.name; form.append(input); document.body.append(form); form.submit(); form.remove();
  }
}, { enabled: () => !sending, choose: () => { if (!sending && !selectedFiles.length) fileInput.click(); } });
function loadRecent() { return explorer.refresh(); }
document.getElementById('browseBtn').onclick = () => { fileListCard.scrollIntoView({ behavior: 'smooth' }); fileListCard.focus(); };
document.getElementById('refreshBtn').onclick = loadRecent;
document.getElementById('uploadBtn').onclick = () => { if (!sending && !selectedFiles.length) fileInput.click(); };
function renderFailed() {
  sendPanel.hidden = !selectedFiles.length;
  document.getElementById('sendNames').replaceChildren(...selectedFiles.map(file => { const row = document.createElement('li'); row.textContent = file.name; return row; }));
  document.getElementById('sendConfirm').disabled = sending;
  document.getElementById('sendCancel').disabled = sending;
}
async function clearSend() {
  if (pendingShareId) await AirdropShares.remove(pendingShareId);
  pendingShareId = null; selectedFiles = []; preparedZip = null; retryTarget = null;
  window.history.replaceState({}, '', '/ui/'); renderFailed();
}
async function startUpload(files, retry = false) {
  if (sending || !files.length) return;
  if (files.length > 1000) { setStatus('Select at most 1000 files.', 'err'); return; }
  if (!retry && selectedFiles.length) { setStatus('Retry or discard the failed transfer first.', 'err'); return; }
  if (!retry) { retryTarget = explorer.directory; retryZip = sendZip.checked; preparedZip = null; }
  selectedFiles = files;
  sending = true; fileInput.disabled = true; sendZip.disabled = true; document.getElementById('uploadBtn').disabled = true;
  const original = files;
  try {
    if (retryZip) {
      if (files.reduce((sum, file) => sum + file.size, 0) > AirdropZip.MAX_ZIP_BYTES) throw new Error('ZIP source files exceed 100 MiB. Turn off ZIP and select the files again.');
      if (!preparedZip) { const zip = await AirdropZip.createZip(files, 'blob', progress => setStatus(`Creating ZIP: ${Math.round(progress.percent)}%`)); preparedZip = new File([zip.data], zip.name, { type: 'application/zip' }); }
      files = [preparedZip];
    }
    const results = []; for (const file of files) results.push(await uploadFile(file, retryTarget));
    const failed = results.filter(item => !item.ok);
    selectedFiles = retryZip ? failed.length ? original : [] : original.filter((file, index) => !results[index].ok);
    setStatus(`${results.length - failed.length} uploaded${failed.length ? '; failed: ' + failed.map(item => `${item.name} (${item.error})`).join(', ') : ''}`, failed.length ? 'err' : 'ok');
    if (pendingShareId) {
      if (selectedFiles.length) {
        await AirdropShares.replace(pendingShareId, selectedFiles, { directory: retryTarget, zip: retryZip });
      } else await clearSend();
    } else if (!selectedFiles.length) await clearSend();
    await loadRecent();
  } catch (error) { setStatus(error.message, 'err'); }
  finally { sending = false; fileInput.disabled = false; sendZip.disabled = false; document.getElementById('uploadBtn').disabled = selectedFiles.length > 0; renderFailed(); }
}
fileInput.addEventListener('change', () => { const files = Array.from(fileInput.files); fileInput.value = ''; startUpload(files); });
document.getElementById('sendConfirm').onclick = () => startUpload(selectedFiles, true);
document.getElementById('sendCancel').onclick = () => clearSend().then(() => { document.getElementById('uploadBtn').disabled = false; }).catch(error => setStatus(error.message, 'err'));
document.addEventListener('dragover', event => { if (event.dataTransfer?.types?.includes('Files')) event.preventDefault(); });
document.addEventListener('drop', event => { event.preventDefault(); if (!sending) startUpload(Array.from(event.dataTransfer?.files || [])); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadRecent(); });
let serverVersion;
async function checkVersion() {
  try { const response = await fetch('/push/version', { cache: 'no-store' }); const data = await response.json(); if (!data.version) return;
    if (serverVersion && data.version !== serverVersion && !sending) { document.getElementById('reloadApp').hidden = false; }
    if (!serverVersion) serverVersion = data.version;
  } catch {}
}
document.getElementById('reloadApp').onclick = () => { if (!sending) location.reload(); };
checkVersion(); setInterval(checkVersion, 30000);

// --- Shared clipboard ---
const clipSub = document.getElementById('clipSub');
const CLIP_FILE = '/.clipboard.txt';
const clipText = document.getElementById('clipText');
function manualClipboard(message, text) {
  document.getElementById('clipManual').hidden = false;
  if (text !== undefined) clipText.value = text;
  clipSub.textContent = message; clipSub.className = 'status';
  clipText.focus(); clipText.select();
}
document.getElementById('clipSendText').addEventListener('click', async () => {
  try {
    const response = await fetch(CLIP_FILE, { method: 'PUT', body: clipText.value });
    if (!response.ok) throw Error();
    clipSub.textContent = 'Text sent'; clipSub.className = 'status ok';
  } catch { clipSub.textContent = 'Text could not be sent'; clipSub.className = 'status err'; }
});

document.getElementById('clipPaste').addEventListener('click', async () => {
  clipSub.textContent = 'Sending...';
  try {
    const text = await navigator.clipboard.readText();
    const res = await fetch(CLIP_FILE, { method: 'PUT', body: text });
    clipSub.textContent = res.ok ? 'Clipboard sent' : 'Send failed (' + res.status + ')';
    clipSub.className = 'status ' + (res.ok ? 'ok' : 'err');
  } catch (e) {
    manualClipboard('Automatic clipboard access is unavailable. Paste below, then choose Send text.');
  }
});

document.getElementById('clipCopy').addEventListener('click', async () => {
  clipSub.textContent = 'Fetching...';
  try {
    const res = await fetch(CLIP_FILE + '?t=' + Date.now());
    if (!res.ok) { clipSub.textContent = 'Clipboard is still empty'; clipSub.className = 'status'; return; }
    const text = await res.text();
    try { await navigator.clipboard.writeText(text); }
    catch { manualClipboard('Shared text loaded. Select and copy the text below.', text); return; }
    clipSub.textContent = 'Copied to clipboard';
    clipSub.className = 'status ok';
  } catch (e) {
    clipSub.textContent = 'Copy failed';
    clipSub.className = 'status err';
  }
});

// --- Push notifications ---
const PUSH_BASE = '/push';
const notifySection = document.getElementById('notifySection');
const notifySwitch = document.getElementById('notifySwitch');

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

const serviceWorkerReady = 'serviceWorker' in navigator
  ? navigator.serviceWorker.register('/ui/sw.js').then(() => navigator.serviceWorker.ready)
  : Promise.resolve(null);
serviceWorkerReady.catch(() => setStatus('Could not enable system sharing. Reload to retry.', 'err'));

async function initPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return;
  }
  notifySection.style.display = 'block';
  const reg = await serviceWorkerReady;

  if (Notification.permission === 'granted') {
    notifySwitch.classList.add('on');
    await ensureSubscribed(reg);
  } else {
    notifySwitch.classList.remove('on');
  }
}

async function ensureSubscribed(reg) {
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const keyRes = await fetch(PUSH_BASE + '/vapid-public-key');
    if (!keyRes.ok) throw new Error('Push server unavailable');
    const publicKey = await keyRes.text();
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
  }
  const response = await fetch(PUSH_BASE + '/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub)
  });
  if (!response.ok) throw new Error('Could not register notifications');
}

notifySwitch.addEventListener('click', () => toggleNotifications().catch(error => { notifySwitch.classList.remove('on'); setStatus(error.message, 'err'); }));
async function toggleNotifications() {
  if (Notification.permission === 'granted') {
    // On iOS, notification permission cannot be revoked here; direct the user to Settings
    setStatus('To disable notifications, use Settings > Notifications', '');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    notifySwitch.classList.add('on');
    const reg = await serviceWorkerReady;
    await ensureSubscribed(reg);
  }
}

initPush().catch(error => { notifySwitch.classList.remove('on'); setStatus(error.message, 'err'); });

const params = new URLSearchParams(window.location.search);

// The user already shared these files with Airdrop: upload without another confirmation.
async function restoreShare() {
  await AirdropShares.cleanup();
  const id = params.get('pending');
  if (id) {
    const files = await AirdropShares.get(id);
    if (!files?.length) { setStatus('Shared files expired or are unavailable. Share them again.', 'err'); return; }
    pendingShareId = id;
    const options = await AirdropShares.options(id);
    if (options) { retryTarget = options.directory; retryZip = options.zip; await startUpload(files, true); }
    else await startUpload(files);
  } else if (params.has('shared_error')) {
    setStatus('Could not prepare the shared files. Check available device storage and share again.', 'err');
    window.history.replaceState({}, '', '/ui/');
  }
}
restoreShare().catch(error => setStatus(error.message, 'err'));

// --- Incoming file sheet (triggered by ?accept=filename from notification click) ---
const acceptFile = params.get('accept');
const incomingBackdrop = document.getElementById('incomingBackdrop');
const incomingName = document.getElementById('incomingName');

function showIncomingSheet(fileName) {
  incomingName.textContent = fileName;
  explorer.navigate(fileName.split('/').slice(0, -1).join('/'));
  incomingBackdrop.classList.add('show');
}

function hideIncomingSheet() {
  incomingBackdrop.classList.remove('show');
  window.history.replaceState({}, '', '/ui/');
}

document.getElementById('incomingAccept').addEventListener('click', () => {
  const fileName = incomingName.textContent;
  window.location.href = '/push/explorer/download?path=' + encodeURIComponent(fileName);
  hideIncomingSheet();
});

document.getElementById('incomingReject').addEventListener('click', () => {
  hideIncomingSheet();
});

if (acceptFile) {
  showIncomingSheet(acceptFile);
}

// Reused-window case: page was already open, service worker sends the file name directly
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'incoming-file' && event.data.fileName) {
      showIncomingSheet(event.data.fileName);
      loadRecent();
    }
  });
}
