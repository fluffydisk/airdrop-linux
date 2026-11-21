'use strict';
(() => {
  if (!window.airdrop.sharing) return;
  const get = id => document.getElementById(id);
  const terminal = new Set(['complete', 'interrupted', 'declined', 'cancelled', 'outcome-unknown']);
  let files = [], working = false, stopping = false, activeId = null, snapshot = null, refreshing = false, pendingChoice = false, mode = null, generation = 0;
  const updates = new Map(), codes = new Map();
  const visible = () => !document.hidden && !get('view-native-sharing').hidden;
  const say = (text, kind = 'pending') => {
    const node = get('nativeResult'); node.textContent = text; node.dataset.kind = kind; node.hidden = !text;
  };
  const report = error => say((error.message || String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''), 'error');
  function render() {
    const quick = snapshot || {};
    const enabled = quick.enabled === true, ready = enabled && quick.status === 'ready';
    const bluetooth = quick.bluetooth || {};
    const bluetoothUnavailable = bluetooth.stage === 'adapter-unavailable' ||
      bluetooth.stage === 'advertisement-registration-failed';
    get('nativeAvailability').textContent = !snapshot ? 'Checking Quick Share support…' :
      !enabled ? 'Quick Share requires an experimental helper-enabled build.' :
      quick.status === 'error' ? 'Quick Share is unavailable. Try starting it again.' :
      ready && bluetoothUnavailable ? 'Quick Share LAN is active. Check Bluetooth power and BlueZ permissions.' :
      ready ? 'Experimental Quick Share is active.' : working ? 'Starting or stopping Quick Share…' : 'Experimental Quick Share is off.';
    get('nativeDeviceName').textContent = quick.name ? 'Device name: ' + quick.name : '';
    const receiveReady = ready && ['receive', 'both'].includes(quick.mode);
    const sendReady = ready && ['send', 'both'].includes(quick.mode);
    const receiveNote = bluetooth.bleAdvertising ? 'Bluetooth advertising is registered. Check discovery on the other device.' :
      bluetooth.stage === 'adapter-unavailable' ? 'Bluetooth is unavailable. Check your adapter, power and BlueZ permissions.' :
      'Bluetooth advertising is unconfirmed. Compatible devices may still find this computer on the local network.';
    get('nativeReceiveStatus').textContent = receiveReady ? receiveNote : 'Quick Share receive is off.';
    const transferring = (quick.transfers || []).some(record => !terminal.has(record.phase));
    const locked = working || stopping || !!activeId || pendingChoice || transferring;
    get('nativeReceive').disabled = !enabled || locked;
    get('nativeSend').disabled = !enabled || locked;
    get('nativeStop').disabled = !receiveReady || working || stopping;
    get('nativeChoose').disabled = !enabled || locked;
    get('nativeClear').disabled = locked || !files.length;
    get('nativeRefresh').disabled = !sendReady || locked;
    get('nativeFiles').replaceChildren(...files.map(file => {
      const row = document.createElement('li'); row.className = 'file-row';
      const label = document.createElement('span'); label.textContent = file.name; row.append(label);
      return row;
    }));
    const recipients = sendReady && mode === 'send' && files.length ? (quick.recipients || []) : [];
    const list = get('nativeRecipients');
    const focused = list.contains(document.activeElement) ? document.activeElement.dataset.recipient : null;
    list.replaceChildren(...recipients.map(device => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button';
      button.dataset.recipient = device.id;
      button.textContent = device.name + ' · Quick Share' + (device.availability === 'available' ? '' : ' · Not reachable yet');
      button.disabled = locked || device.availability !== 'available';
      button.onclick = () => send(device.id); return button;
    }));
    if (focused) [...list.children].find(button => button.dataset.recipient === focused)?.focus({ preventScroll: true });
    if (!recipients.length) list.textContent = !files.length ? 'Choose files to start discovery.' : sendReady ? 'No compatible devices found yet. Open Quick Share Receive on the other device.' : 'Native discovery is not ready.';
    const history = get('nativeTransfers'), records = [...(quick.transfers || [])].sort((a,b) => (b.created || 0) - (a.created || 0));
    history.replaceChildren(...records.map(record => {
      const row = document.createElement('div'); row.className = 'nearby-transfer';
      const label = document.createElement('p');
      label.textContent = (record.direction === 'incoming' ? 'From ' : 'To ') + (record.name || 'Nearby device') + ' · ' + record.phase;
      row.append(label);
      if (record.error) {
        const error = document.createElement('p');
        error.textContent = record.error; row.append(error);
      }
      const names = document.createElement('p'); names.textContent = (record.files || []).map(file => typeof file === 'string' ? file : file.name).join(', '); row.append(names);
      if (record.total) { const progress = document.createElement('progress'); progress.max = record.total; progress.value = record.bytes || 0; progress.setAttribute('aria-label', 'Transferred bytes'); row.append(progress); }
      if (!terminal.has(record.phase)) {
        const cancel = document.createElement('button'); cancel.className = 'button'; cancel.textContent = 'Cancel transfer';
        cancel.onclick = async () => { cancel.disabled = true; try { await window.airdrop.sharing('cancel', { transport: 'quick-share', id: record.id }); await refresh(); } catch (error) { report(error); cancel.disabled = false; } };
        row.append(cancel);
      }
      return row;
    }));
    if (!records.length) history.textContent = 'No native transfers yet.';
  }
  function progress(record) {
    if (record.transport !== 'quick-share' || !visible()) return;
    updates.set(record.id, record); if (updates.size > 100) updates.delete(updates.keys().next().value);
    if (terminal.has(record.phase || record.status)) codes.delete(record.id);
    if (record.id !== activeId) return;
    const phase = record.phase || record.status;
    if (phase === 'complete') { activeId = null; files = []; say('Transfer complete.', 'success'); }
    else if (terminal.has(phase)) {
      activeId = null;
      say(phase === 'outcome-unknown' ? 'Recipient completion is unconfirmed. Check the other device before sending again.' : record.error || 'Transfer ' + phase + '.', 'error');
    } else if (phase === 'awaiting-acceptance' && codes.has(record.id)) {
      const code = codes.get(record.id);
      say('Compare code ' + code.code + ' with ' + (code.name || 'the receiving device') + ' and accept on that device.');
    } else say('Quick Share: ' + phase + '…');
    render();
  }
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const current = generation;
      const state = await window.airdrop.sharing('state');
      if (current !== generation || working) return;
      snapshot = state.quickShare;
      const record = snapshot?.transfers?.find(item => item.id === activeId);
      if (record) progress(record);
      render();
    } catch (error) { report(error); }
    finally { refreshing = false; }
  }
  function showMode(next) {
    mode = next;
    for (const name of ['Receive', 'Send']) {
      const selected = mode === name.toLowerCase();
      get('native' + name).setAttribute('aria-pressed', String(selected));
      get('native' + name + 'Panel').hidden = !selected;
    }
  }
  async function selectMode(next) {
    if (!visible() || working || stopping || pendingChoice || activeId) return;
    const current = ++generation;
    if (next === 'send') {
      pendingChoice = true; render();
      try {
        const paths = await window.airdrop.choose();
        if (!paths?.length || current !== generation) return;
        const selected = await window.airdrop.describe(paths);
        if (!selected.length || current !== generation) return;
        files = selected;
      } catch (error) { report(error); return; }
      finally { pendingChoice = false; render(); }
    } else {
      files = [];
    }
    if (current !== generation || !visible()) return;
    showMode(next);
    working = true; say(''); render();
    try {
      const state = await window.airdrop.sharing('native-start', {
        mode: next,
        ...(next === 'send' ? { sources: files.map(file => file.path) } : {})
      });
      if (current === generation) snapshot = state;
    } catch (error) { if (current === generation) report(error); }
    finally { working = false; render(); await refresh(); }
  }
  async function send(recipientId) {
    if (working || stopping || pendingChoice || activeId || mode !== 'send' || !files.length || !visible()) return;
    const current = generation;
    working = true; render();
    try {
      const response = await window.airdrop.sharing('send', { recipientId, sources: files.map(file => file.path) });
      if (current !== generation) return;
      if (!response?.transferId) throw Error('Native transfer did not start.');
      activeId = response.transferId;
      say('Quick Share started. Compare the confirmation code and accept on the receiving device.');
      if (updates.has(activeId)) progress(updates.get(activeId));
      else if (codes.has(activeId)) { const code = codes.get(activeId); say('Compare code ' + code.code + ' with ' + (code.name || 'the receiving device') + ' and accept on that device.'); }
    } catch (error) { if (current === generation) report(error); }
    finally { working = false; render(); await refresh(); }
  }
  async function stop({ leaving = false } = {}) {
    ++generation;
    const wasActive = mode !== null;
    if (leaving) { showMode(null); say(''); }
    activeId = null; files = []; codes.clear(); updates.clear();
    if (!wasActive || stopping) { render(); return; }
    stopping = true; render();
    try {
      snapshot = await window.airdrop.sharing('native-stop');
      say(leaving ? '' : 'Quick Share stopped.');
    } catch (error) { if (!leaving) report(error); }
    finally { stopping = false; render(); await refresh(); }
  }
  get('nativeReceive').onclick = () => selectMode('receive');
  get('nativeSend').onclick = () => selectMode('send');
  get('nativeRefresh').onclick = refresh;
  get('nativeClear').onclick = () => stop();
  get('nativeChoose').onclick = () => selectMode('send');
  get('nativeInbox').onclick = () => window.airdrop.nearby('inbox').catch(report);
  get('nativeStop').onclick = () => stop();
  window.addEventListener('nearby-share-leave', () => stop({ leaving: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void stop({ leaving: true });
  });
  window.airdrop.onPeerProgress?.(record => { progress(record); if (record.transport === 'quick-share') void refresh(); });
  window.airdrop.onSharingVerification?.(record => {
    if (mode !== 'send' || !visible() || terminal.has(updates.get(record.id)?.phase)) return;
    codes.set(record.id, record); if (codes.size > 100) codes.delete(codes.keys().next().value);
    if (record.id === activeId) say('Compare code ' + record.code + ' with ' + (record.name || 'the receiving device') + ' and accept on that device.');
  });
  refresh(); setInterval(() => { if (visible()) void refresh(); }, 1500);
})();
