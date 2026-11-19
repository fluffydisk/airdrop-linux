'use strict';
(() => {
  if (!window.airdrop.sharing) return;
  const get = id => document.getElementById(id);
  const terminal = new Set(['complete', 'interrupted', 'declined', 'cancelled', 'outcome-unknown']);
  let files = [], working = false, activeId = null, snapshot = null, refreshing = false, pendingChoice = false;
  const updates = new Map(), codes = new Map();
  const say = (text, kind = 'pending') => {
    const node = get('nativeResult'); node.textContent = text; node.dataset.kind = kind; node.hidden = !text;
  };
  const report = error => say((error.message || String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''), 'error');
  function render() {
    const quick = snapshot || {};
    const enabled = quick.enabled === true, ready = enabled && quick.status === 'ready';
    get('nativeAvailability').textContent = !enabled ? 'Quick Share requires the experimental native helper in this build. Apple AirDrop is not available.' :
      quick.status === 'error' ? 'Quick Share unavailable: ' + (quick.error || 'Native helper stopped.') :
      ready ? 'Quick Share helper is ready. Apple AirDrop is not supported yet.' : 'Quick Share: ' + (quick.status || 'starting');
    const bluetooth = quick.bluetooth || {};
    get('nativeReceiveStatus').textContent = ready ?
      (bluetooth.bleAdvertising ? 'Bluetooth advertising is registered; nearby compatible devices may discover this computer.' :
        'Local sharing is active. Bluetooth advertising is not confirmed; discovery may be limited to the local network.') :
      'This computer is not currently ready to receive native transfers.';
    const locked = working || !!activeId || pendingChoice;
    const transferring = (quick.transfers || []).some(record => !terminal.has(record.phase));
    get('nativeReceive').disabled = working;
    get('nativeSend').disabled = working;
    get('nativeStop').disabled = !enabled || working || !!activeId || transferring || !ready;
    get('nativeChoose').disabled = locked;
    get('nativeClear').disabled = locked || !files.length;
    get('nativeFiles').replaceChildren(...files.map(file => {
      const row = document.createElement('li'); row.className = 'file-row';
      const label = document.createElement('span'); label.textContent = file.name; row.append(label);
      return row;
    }));
    const recipients = ready ? (quick.recipients || []) : [];
    const list = get('nativeRecipients');
    list.replaceChildren(...recipients.map(device => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button';
      button.textContent = device.name + ' · Quick Share' + (device.availability === 'available' ? '' : ' · Not reachable yet');
      button.disabled = locked || device.availability !== 'available';
      button.onclick = () => send(device.id); return button;
    }));
    if (!recipients.length) list.textContent = ready ? 'No compatible devices found yet. Open Quick Share Receive on the other device.' : 'Native discovery is not ready.';
    const history = get('nativeTransfers'), records = [...(quick.transfers || [])].sort((a,b) => (b.created || 0) - (a.created || 0));
    history.replaceChildren(...records.map(record => {
      const row = document.createElement('div'); row.className = 'nearby-transfer';
      const label = document.createElement('p');
      label.textContent = (record.direction === 'incoming' ? 'From ' : 'To ') + (record.name || 'Nearby device') + ' · ' + record.phase;
      row.append(label);
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
    if (record.transport !== 'quick-share') return;
    updates.set(record.id, record); if (updates.size > 100) updates.delete(updates.keys().next().value);
    if (record.id !== activeId) return;
    const phase = record.phase || record.status;
    if (phase === 'complete') { activeId = null; files = []; say('Transfer complete.', 'success'); }
    else if (terminal.has(phase)) {
      activeId = null;
      say(phase === 'outcome-unknown' ? 'Recipient completion is unconfirmed. Check the other device before sending again.' : record.error || 'Transfer ' + phase + '.', 'error');
    } else if (codes.has(record.id)) {
      const code = codes.get(record.id);
      say('Compare code ' + code.code + ' with ' + (code.name || 'the receiving device') + ' and accept on that device.');
    } else say('Quick Share: ' + phase + '…');
    render();
  }
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const state = await window.airdrop.sharing('state');
      snapshot = state.quickShare;
      const record = snapshot?.transfers?.find(item => item.id === activeId);
      if (record) progress(record);
      render();
    } catch (error) { report(error); }
    finally { refreshing = false; }
  }
  async function setMode(next) {
    if (working) return;
    for (const name of ['Receive','Send']) {
      const selected = next === name.toLowerCase();
      get('native' + name).setAttribute('aria-pressed', String(selected));
      get('native' + name + 'Panel').hidden = !selected;
    }
    working = true; render();
    try { snapshot = await window.airdrop.sharing('native-start'); render(); }
    catch (error) { report(error); }
    finally { working = false; render(); await refresh(); }
  }
  async function choose() {
    const paths = await window.airdrop.choose();
    if (!paths?.length) return false;
    const selected = await window.airdrop.describe(paths);
    if (!selected.length) return false;
    files = selected; render(); return true;
  }
  async function send(recipientId) {
    if (working || pendingChoice || activeId) return;
    working = true; render();
    try {
      if (!files.length && !await choose()) return;
      const response = await window.airdrop.sharing('send', { recipientId, sources: files.map(file => file.path) });
      if (!response?.transferId) throw Error('Native transfer did not start.');
      activeId = response.transferId;
      say('Quick Share started. Compare the confirmation code and accept on the receiving device.');
      if (updates.has(activeId)) progress(updates.get(activeId));
      else if (codes.has(activeId)) { const code = codes.get(activeId); say('Compare code ' + code.code + ' with ' + (code.name || 'the receiving device') + ' and accept on that device.'); }
    } catch (error) { report(error); }
    finally { working = false; render(); await refresh(); }
  }
  get('nativeReceive').onclick = () => setMode('receive');
  get('nativeSend').onclick = () => setMode('send');
  get('nativeRefresh').onclick = refresh;
  get('nativeClear').onclick = () => { if (!working && !activeId && !pendingChoice) { files = []; render(); say(''); } };
  get('nativeChoose').onclick = async () => {
    if (working || activeId || pendingChoice) return;
    pendingChoice = true; render();
    try { await choose(); } catch (error) { report(error); }
    finally { pendingChoice = false; render(); }
  };
  get('nativeInbox').onclick = () => window.airdrop.nearby('inbox').catch(report);
  get('nativeStop').onclick = async () => {
    if (working || activeId) return;
    working = true; render();
    try { snapshot = await window.airdrop.sharing('native-stop'); say('Quick Share stopped.'); }
    catch (error) { report(error); }
    finally { working = false; render(); await refresh(); }
  };
  window.airdrop.onPeerProgress?.(record => { progress(record); if (record.transport === 'quick-share') void refresh(); });
  window.airdrop.onSharingVerification?.(record => {
    codes.set(record.id, record); if (codes.size > 100) codes.delete(codes.keys().next().value);
    if (record.id === activeId) say('Compare code ' + record.code + ' with ' + (record.name || 'the receiving device') + ' and accept on that device.');
  });
  refresh(); setInterval(refresh, 1500);
})();
