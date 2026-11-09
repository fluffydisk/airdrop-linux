'use strict';
(() => {
  if (!window.airdrop.nearby) return;
  const get = id => document.getElementById(id);
  let refreshing = false, devicesKey = '', transferKey = '', selectedByUser = false;
  const size = n => n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(1) + ' GiB' : n >= 1024 ** 2 ? (n / 1024 ** 2).toFixed(1) + ' MiB' : n.toLocaleString() + ' B';
  const action = async (name, payload) => {
    try { await window.airdrop.nearby(name, payload); await refresh(); }
    catch (e) { get('nearbyStatus').textContent = e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); }
  };
  const button = (text, run) => { const b = document.createElement('button'); b.className = 'button'; b.textContent = text; b.onclick = async () => { b.disabled = true; try { await run(); } finally { b.disabled = false; } }; return b; };
  function renderDevices(state) {
    const key = JSON.stringify([state.devices, state.enabled, state.discoveryError, state.concurrency, state.pairing]);
    if (key === devicesKey) return; devicesKey = key;
    get('nearbyEnabled').checked = state.enabled; get('nearbyConcurrency').value = String(state.concurrency);
    get('nearbyStatus').textContent = state.pairing ? `Pairing with ${state.pairing.name}. Compare code on both devices: ${state.pairing.code}. Waiting for acceptance…` : !state.enabled ? 'Nearby sharing is off.' : state.discoveryError || (state.devices.some(d => d.online) ? 'Direct local network · encrypted · no internet relay' : 'No nearby devices found. Open Airdrop on the other computer. For phones or networks that block discovery, use a guest QR session.');
    const destination = get('sendDestination'), previous = destination.value;
    const options = state.devices.filter(d => d.trusted).map(d => { const option = new Option(d.name + (d.online ? ' · Nearby' : ' · Offline'), d.id); option.disabled = !d.online; return option; });
    options.push(new Option('Shared workspace', ''));
    destination.replaceChildren(...options);
    destination.value = options.some(option => option.value === previous) ? previous : '';
    if (!selectedByUser && !previous) destination.value = options.find(option => option.value && !option.disabled)?.value || '';
    get('zip').disabled = !!destination.value; if (destination.value) get('zip').checked = false;
    document.querySelector('.drop-caption').textContent = destination.value ? 'Choose files, then select Send to device.' : 'Files are shared to your workspace as soon as you add them.';
    get('nearbyDevices').replaceChildren(...state.devices.map(d => {
      const row = document.createElement('div'); row.className = 'nearby-device';
      const label = document.createElement('p'); label.textContent = `${d.name} · ${d.online ? 'Online' : 'Offline'} · ${d.trusted ? 'Paired' : 'Not paired'} · ${d.id.slice(0, 8)}`; row.append(label);
      if (!d.trusted) { const pair = button('Pair device', () => action('pair', { id: d.id })); pair.disabled = !d.online; row.append(pair); }
      else {
        const send = button('Send to this device', () => { selectedByUser = true; destination.value = d.id; destination.dispatchEvent(new Event('change')); get('choose').scrollIntoView?.({ block: 'center', behavior: 'smooth' }); get('choose').focus(); }); send.disabled = !d.online; row.append(send);
        const permission = document.createElement('label'), checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = d.autoAccept;
        checkbox.onchange = () => action('configure', { id: d.id, autoAccept: checkbox.checked });
        permission.append(checkbox, document.createTextNode(' Automatically accept files from this device')); row.append(permission);
        row.append(button('Forget device', () => action('configure', { id: d.id, forget: true })));
      }
      return row;
    }));
  }
  function renderTransfers(state) {
    const key = JSON.stringify([state.outgoing, state.incoming]);
    if (key === transferKey) return; transferKey = key;
    const focusedId = document.activeElement?.closest('[data-transfer]')?.dataset.transfer;
    const focusedLabel = focusedId ? document.activeElement.textContent : '';
    const records = [...state.outgoing.map(s => ({ ...s, direction: 'To' })), ...state.incoming.map(s => ({ ...s, direction: 'From' }))].sort((a, b) => b.created - a.created);
    get('peerTransfers').replaceChildren(...records.map(s => {
      const row = document.createElement('div'); row.className = 'nearby-transfer'; row.dataset.transfer = s.id + s.direction;
      const text = document.createElement('p');
      const name = s.name || state.devices.find(d => d.id === s.peer)?.name || s.peer.slice(0, 8);
      const progress = s.total !== undefined ? ` · ${size(s.bytes || 0)} / ${size(s.total)}${s.speed ? ' · ' + size(s.speed) + '/s' : ''}${s.remaining != null ? ' · about ' + s.remaining + ' s left' : ''}` : '';
      text.textContent = `${s.direction} ${name} · ${s.status}${progress}${s.verifying ? ' · Verifying stored file…' : ''}${s.error ? ' · ' + s.error : ''}`;
      row.append(text);
      if (s.currentFile) { const detail = document.createElement('p'); detail.textContent = `${s.currentFile}: ${size(s.fileBytes || 0)} / ${size(s.fileSize || 0)}`; row.append(detail); }
      if (s.total) { const bar = document.createElement('progress'); bar.max = s.total; bar.value = s.bytes || 0; bar.setAttribute('aria-label', 'Verified transfer bytes'); row.append(bar); }
      if (s.direction === 'To' && ['preparing', 'waiting', 'sending'].includes(s.status)) row.append(button('Cancel transfer', () => action('cancel', { id: s.id })));
      if (s.direction === 'To' && ['interrupted', 'cancelled'].includes(s.status)) row.append(button('Retry / resume', () => action('send', { id: s.peer, retryId: s.id })));
      if (s.direction === 'From' && s.status === 'receiving') row.append(button('Decline remaining files', () => action('cancel-incoming', { id: s.id, peer: s.peer })));
      const files = document.createElement('p'); files.textContent = s.files.map(f => f.stored || f.name).join(', '); row.append(files);
      return row;
    }));
    if (records.some(s => ['preparing', 'waiting', 'sending', 'receiving'].includes(s.status))) get('peerTransfers').parentElement.open = true;
    if (focusedId) { const row = [...get('peerTransfers').children].find(row => row.dataset.transfer === focusedId); [...(row?.querySelectorAll('button') || [])].find(b => b.textContent === focusedLabel)?.focus({ preventScroll: true }); }
    if (!records.length) get('peerTransfers').textContent = 'Your device transfer history will appear here.';
  }
  async function refresh() {
    if (refreshing) return; refreshing = true;
    try {
      const state = await window.airdrop.nearby('state');
      if (document.activeElement !== get('nearbyName')) get('nearbyName').value = state.name;
      renderDevices(state); renderTransfers(state);
    } catch (e) { get('nearbyStatus').textContent = 'Nearby sharing unavailable: ' + e.message; }
    finally { refreshing = false; }
  }
  get('sendDestination').addEventListener('change', () => { selectedByUser = true; get('zip').disabled = !!get('sendDestination').value; if (get('sendDestination').value) get('zip').checked = false; });
  get('nearbyConcurrency').onchange = () => action('configure', { concurrency: Number(get('nearbyConcurrency').value) });
  get('nearbyRefresh').onclick = () => action('refresh');
  get('nearbyPhone').onclick = () => get('setupDevices').click();
  get('nearbyInbox').onclick = () => action('inbox');
  get('nearbyEnabled').onchange = () => action('configure', { enabled: get('nearbyEnabled').checked });
  get('nearbySaveName').onclick = () => action('configure', { name: get('nearbyName').value });
  get('nearbyClearHistory').onclick = () => action('configure', { clearHistory: true });
  window.airdrop.onPeerProgress?.(() => refresh());
  refresh(); setInterval(refresh, 1500);
})();
