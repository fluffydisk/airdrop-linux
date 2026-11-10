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
    const laboratory = document.body.dataset.quickshareLab === 'true';
    const key = JSON.stringify([laboratory, state.devices, state.enabled, state.discoveryError, state.quickShareError, state.concurrency, state.pairing, state.port]);
    if (key === devicesKey) return; devicesKey = key;
    get('nearbyEnabled').checked = state.enabled; get('nearbyConcurrency').value = String(state.concurrency);
    if (document.activeElement !== get('nearbyPort')) get('nearbyPort').value = state.preferredPort ?? 53318;
    get('nearbyStatus').textContent = state.quickShareError ? 'Quick Share unavailable: ' + state.quickShareError : state.pairing ? `Pairing with ${state.pairing.name}. Compare code on both devices: ${state.pairing.code}. Waiting for acceptance…` : !state.enabled ? 'Nearby sharing is off. Share link / QR is still available.' : state.discoveryError || (state.devices.some(d => d.online) ? 'Direct local network · encrypted · no internet relay' : 'No reachable nearby devices yet. This network may limit discovery or direct connections. Choose Share link / QR to use another permitted route.');
    if (laboratory && !state.quickShareError) get('nearbyStatus').textContent = state.devices.some(d => d.online) ? 'Native Quick Share recipients are available. Compare codes for every transfer.' : 'No native Quick Share recipients yet. Keep Samsung Receive visible. BLE/GATT receiver bootstrap is not implemented.';
    const destination = get('sendDestination'), previous = destination.value;
    const options = state.devices.filter(d => d.trusted || d.transport === 'quick-share').map(d => { const option = new Option(d.name + (d.online ? d.transport === 'quick-share' ? ' · Quick Share (experimental)' : ' · Nearby' : ' · Offline'), d.id); option.disabled = !d.online; return option; });
    if (laboratory) options.unshift(new Option('Choose a native Quick Share recipient', ''));
    else options.push(new Option('Share link / QR', 'guest'), new Option('Shared workspace', ''));
    if (previous && !options.some(option => option.value === previous)) {
      const missing = new Option('Unavailable recipient · choose another device or Share link / QR', previous);
      missing.disabled = true; options.unshift(missing);
    }
    destination.replaceChildren(...options);
    destination.value = options.some(option => option.value === previous) ? previous : '';
    if (!selectedByUser && !previous) destination.value = state.devices.find(device => device.trusted && device.online)?.id || '';
    get('zip').disabled = !!destination.value; if (destination.value) get('zip').checked = false;
    destination.dispatchEvent(new CustomEvent('airdrop-destinations-updated'));
    document.querySelector('.drop-caption').textContent = 'Choose files, choose a recipient, then Send.';
    get('nearbyDevices').replaceChildren(...state.devices.map(d => {
      const row = document.createElement('div'); row.className = 'nearby-device';
      const label = document.createElement('p'); label.textContent = `${d.name} · ${d.online ? 'Online' : d.availability === 'checking' ? 'Checking connection' : d.availability === 'unreachable' ? 'Discovered · unreachable' : 'Offline'} · ${d.transport === 'quick-share' ? 'Confirm each transfer' : d.trusted ? 'Paired' : 'Not paired'} · ${d.id.slice(0, 8)}`; row.append(label);
      if (d.error) { const detail = document.createElement('p'); detail.textContent = d.error; row.append(detail); }
      if (d.transport === 'quick-share') {
        row.append(button('Send to this device', () => { selectedByUser = true; destination.value = d.id; destination.dispatchEvent(new Event('change')); get('choose').focus(); }));
        const detail = document.createElement('p'); detail.textContent = 'Experimental Quick Share · compare the code for each transfer · Android validation pending'; row.append(detail);
      }
      else if (!d.trusted) { const pair = button('Pair device', () => action('pair', { id: d.id })); pair.disabled = !d.online; row.append(pair); }
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
      text.textContent = `${s.direction} ${name} · ${s.status === 'outcome-unknown' ? 'Files sent · recipient completion unconfirmed' : s.status}${progress}${s.verifying ? ' · Verifying stored file…' : ''}${s.error ? ' · ' + s.error : ''}`;
      row.append(text);
      if (s.currentFile) { const detail = document.createElement('p'); detail.textContent = `${s.currentFile}: ${size(s.fileBytes || 0)} / ${size(s.fileSize || 0)}`; row.append(detail); }
      if (s.total) { const bar = document.createElement('progress'); bar.max = s.total; bar.value = s.bytes || 0; bar.setAttribute('aria-label', s.transport === 'quick-share' ? 'Transferred bytes' : 'Verified transfer bytes'); row.append(bar); }
      if (s.transport === 'quick-share' && ['waiting', 'sending', 'receiving', 'connecting'].includes(s.status)) row.append(button('Cancel transfer', () => window.airdrop.sharing('cancel', { transport: 'quick-share', id: s.id })));
      if (s.transport !== 'quick-share' && s.direction === 'To' && ['preparing', 'waiting', 'sending'].includes(s.status)) row.append(button('Cancel transfer', () => action('cancel', { id: s.id })));
      if (s.transport !== 'quick-share' && s.direction === 'To' && ['interrupted', 'cancelled'].includes(s.status)) row.append(button('Retry / resume', () => action('send', { id: s.peer, retryId: s.id })));
      if (s.transport !== 'quick-share' && s.direction === 'From' && s.status === 'receiving') row.append(button('Decline remaining files', () => action('cancel-incoming', { id: s.id, peer: s.peer })));
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
      const snapshot = window.airdrop.sharing ? await window.airdrop.sharing('state') : null;
      const state = snapshot ? { ...snapshot.nearby, devices: [...snapshot.nearby.devices] } : await window.airdrop.nearby('state');
      if (snapshot?.quickShare?.enabled) {
        state.quickShareError = snapshot.quickShare.status === 'error' ? snapshot.quickShare.error || 'The native helper stopped.' : '';
        state.devices.push(...snapshot.quickShare.recipients.map(d => ({ ...d, transport: 'quick-share', online: d.availability === 'available', trusted: false })));
        const records = snapshot.quickShare.transfers.map(s => ({ ...s, peer: s.id, created: s.created || 0, status: ({ 'awaiting-acceptance': 'waiting', transferring: s.direction === 'incoming' ? 'receiving' : 'sending' })[s.phase] || s.phase,
          files: (s.files || []).map(file => typeof file === 'string' ? { name: file } : file) }));
        state.outgoing = [...state.outgoing, ...records.filter(s => s.direction === 'outgoing')];
        state.incoming = [...state.incoming, ...records.filter(s => s.direction === 'incoming')];
      }
      if (document.body.dataset.quickshareLab === 'true') state.devices = state.devices.filter(d => d.transport === 'quick-share');
      if (document.activeElement !== get('nearbyName')) get('nearbyName').value = state.name;
      renderDevices(state); renderTransfers(state);
    } catch (e) { get('nearbyStatus').textContent = 'Nearby sharing unavailable: ' + e.message; }
    finally { refreshing = false; }
  }
  get('sendDestination').addEventListener('change', () => { selectedByUser = true; get('zip').disabled = !!get('sendDestination').value; if (get('sendDestination').value) get('zip').checked = false; });
  get('nearbyConcurrency').onchange = () => action('configure', { concurrency: Number(get('nearbyConcurrency').value) });
  get('nearbyRefresh').onclick = () => action('refresh');
  get('nearbyPhone').onclick = () => get('setupDevices').click();
  get('nearbyLink').onclick = () => { get('sendDestination').value = 'guest'; get('sendDestination').dispatchEvent(new Event('change')); };
  get('nearbyInbox').onclick = () => action('inbox');
  get('nearbyEnabled').onchange = () => action('configure', { enabled: get('nearbyEnabled').checked });
  get('nearbySaveName').onclick = () => action('configure', { name: get('nearbyName').value });
  get('nearbySavePort').onclick = () => action('configure', { port: Number(get('nearbyPort').value) });
  get('nearbyClearHistory').onclick = () => action('configure', { clearHistory: true });
  window.addEventListener('airdrop-lab-mode', () => refresh());
  window.airdrop.onPeerProgress?.(() => refresh());
  refresh(); setInterval(refresh, 1500);
})();
