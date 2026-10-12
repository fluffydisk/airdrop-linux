
const statusEl = document.getElementById('status');
const fileInput = document.getElementById('fileInput');
const fileListCard = document.getElementById('fileListCard');
const navbar = document.getElementById('navbar');
const scrollArea = document.getElementById('scrollArea');

window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 28);
});

document.getElementById('uploadBtn').addEventListener('click', () => fileInput.click());
document.getElementById('browseBtn').addEventListener('click', () => {
  window.location.href = '/?browse';
});

let selectedFiles = [];
let pendingShareId = null;
let sending = false;
const sendPanel = document.getElementById('sendPanel');
const sendZip = document.getElementById('sendZip');
function showSend(files) {
  selectedFiles = files;
  document.getElementById('sendNames').replaceChildren(...files.map(file => {
    const li = document.createElement('li');
    li.textContent = `${file.name} (${formatSize(file.size)})`;
    return li;
  }));
  const tooLarge = files.reduce((sum, file) => sum + file.size, 0) > AirdropZip.MAX_ZIP_BYTES;
  sendZip.checked = false;
  sendZip.disabled = tooLarge;
  document.getElementById('sendHint').textContent = tooLarge ? 'ZIP source files exceed 100 MiB. Send files separately.' : '';
  sendPanel.hidden = false;
}
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) showSend(Array.from(fileInput.files));
  fileInput.value = '';
});
async function uploadFile(file) {
  setStatus(`Uploading: ${file.name}`, '');
  try {
    const res = await fetch('/push/files/' + encodeURIComponent(file.name), { method: 'PUT', body: file });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`);
    return { ok: true, ...result };
  } catch (error) { return { ok: false, name: file.name, error: error.message }; }
}
async function clearSend() {
  if (pendingShareId) await AirdropShares.remove(pendingShareId);
  pendingShareId = null;
  selectedFiles = [];
  sendPanel.hidden = true;
  document.getElementById('uploadBtn').disabled = false;
  window.history.replaceState({}, '', '/ui/');
}
document.getElementById('sendCancel').addEventListener('click', () => {
  if (!sending) clearSend().catch(error => setStatus(error.message, 'err'));
});
document.getElementById('sendConfirm').addEventListener('click', async () => {
  if (sending || !selectedFiles.length) return;
  sending = true;
  fileInput.disabled = true;
  document.getElementById('uploadBtn').disabled = true;
  document.getElementById('sendConfirm').disabled = true;
  document.getElementById('sendCancel').disabled = true;
  sendZip.disabled = true;
  try {
    let files = selectedFiles;
    if (sendZip.checked) {
      const archive = await AirdropZip.createZip(files, 'blob', progress => setStatus(`Creating ZIP: ${Math.round(progress.percent)}%`, ''));
      files = [new File([archive.data], archive.name, { type: 'application/zip' })];
    }
    const results = [];
    for (const file of files) results.push(await uploadFile(file));
    const failed = results.filter(result => !result.ok);
    const success = results.length - failed.length;
    setStatus(`${success} uploaded${failed.length ? '; failed: ' + failed.map(file => `${file.name} (${file.error})`).join(', ') : ''}`, failed.length ? 'err' : 'ok');
    // Release staged Android files after this attempt, including partial failure.
    await clearSend();
    await loadRecent();
  } catch (error) { setStatus(error.message, 'err'); }
  finally {
    sending = false;
    fileInput.disabled = false;
    document.getElementById('uploadBtn').disabled = false;
    document.getElementById('sendConfirm').disabled = false;
    document.getElementById('sendCancel').disabled = false;
    sendZip.disabled = selectedFiles.reduce((sum, file) => sum + file.size, 0) > AirdropZip.MAX_ZIP_BYTES;
  }
});

function setStatus(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (cls ? ' ' + cls : '');
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

const downloadZip = document.getElementById('downloadZip');
function selectedNames() {
  return Array.from(fileListCard.querySelectorAll('input:checked')).map(input => input.value);
}
async function loadRecent() {
  try {
    const previous = new Set(selectedNames());
    const res = await fetch('/?json', { cache: 'no-store' });
    if (!res.ok) throw new Error('File listing unavailable');
    const data = await res.json();
    const files = (data.paths || []).filter(p => p.path_type === 'File' && !p.name.startsWith('.'))
      .sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    fileListCard.replaceChildren();
    for (const file of files) {
      const row = document.createElement('div'); row.className = 'row';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = file.name;
      checkbox.className = 'file-selection'; checkbox.checked = previous.has(file.name);
      checkbox.setAttribute('aria-label', `Select ${file.name}`);
      checkbox.addEventListener('change', () => { downloadZip.disabled = !selectedNames().length; });
      const link = document.createElement('a'); link.className = 'row-label';
      link.href = '/' + encodeURIComponent(file.name); link.download = file.name; link.textContent = file.name;
      const size = document.createElement('span'); size.className = 'row-value'; size.textContent = formatSize(file.size || 0);
      row.append(checkbox, link, size); fileListCard.append(row);
    }
    if (!files.length) { const empty = document.createElement('div'); empty.className = 'empty-row'; empty.textContent = 'No files yet.'; fileListCard.append(empty); }
    downloadZip.disabled = !selectedNames().length;
  } catch (error) {
    fileListCard.textContent = 'Could not load the file list.';
    downloadZip.disabled = true;
  }
}
downloadZip.addEventListener('click', async () => {
  const files = selectedNames();
  if (!files.length) return;
  downloadZip.disabled = true;
  try {
    // Validate before submitting a native download; avoid buffering the ZIP in page memory.
    const res = await fetch('/push/archive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files, validateOnly: true }) });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Could not download ZIP');
    const form = document.createElement('form'); form.method = 'POST'; form.action = '/push/archive'; form.target = '_blank';
    const input = document.createElement('input'); input.type = 'hidden'; input.name = 'files'; input.value = JSON.stringify(files);
    form.append(input); document.body.append(form); form.submit(); form.remove();
    setStatus('ZIP download requested', 'ok');
  } catch (error) { setStatus(error.message, 'err'); }
  finally { downloadZip.disabled = !selectedNames().length; }
});

loadRecent();

const refreshBtn = document.getElementById('refreshBtn');
refreshBtn.addEventListener('click', async () => {
  refreshBtn.classList.add('spinning');
  await loadRecent();
  setTimeout(() => refreshBtn.classList.remove('spinning'), 400);
});

// Refresh the list automatically whenever the page becomes visible again
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadRecent();
  }
});

// --- Shared clipboard ---
const clipSub = document.getElementById('clipSub');
const CLIP_FILE = '/.clipboard.txt';

document.getElementById('clipPaste').addEventListener('click', async () => {
  clipSub.textContent = 'Sending...';
  try {
    const text = await navigator.clipboard.readText();
    const res = await fetch(CLIP_FILE, { method: 'PUT', body: text });
    clipSub.textContent = res.ok ? 'Clipboard sent' : 'Send failed (' + res.status + ')';
    clipSub.className = 'status ' + (res.ok ? 'ok' : 'err');
  } catch (e) {
    clipSub.textContent = 'Could not read the clipboard. Try again.';
    clipSub.className = 'status err';
  }
});

document.getElementById('clipCopy').addEventListener('click', async () => {
  clipSub.textContent = 'Fetching...';
  try {
    const res = await fetch(CLIP_FILE + '?t=' + Date.now());
    if (!res.ok) { clipSub.textContent = 'Clipboard is still empty'; clipSub.className = 'status'; return; }
    const text = await res.text();
    await navigator.clipboard.writeText(text);
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

// Android staged files are opened for confirmation, never auto-uploaded.
async function restoreShare() {
  await AirdropShares.cleanup();
  const id = params.get('pending');
  if (id) {
    const files = await AirdropShares.get(id);
    if (!files?.length) { setStatus('Shared files expired or are unavailable. Share them again.', 'err'); return; }
    pendingShareId = id;
    showSend(files);
    document.getElementById('uploadBtn').disabled = true;
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
  incomingBackdrop.classList.add('show');
}

function hideIncomingSheet() {
  incomingBackdrop.classList.remove('show');
  window.history.replaceState({}, '', '/ui/');
}

document.getElementById('incomingAccept').addEventListener('click', () => {
  const fileName = incomingName.textContent;
  window.location.href = '/' + encodeURIComponent(fileName);
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
