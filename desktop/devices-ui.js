'use strict';
(() => {
  const get = id => document.getElementById(id), wizard = get('connectionWizard');
  let busy = false, polling = false, preferencesBusy = false, initialized = false, interfacesKey = '', startedAt = 0, stage = 'connection', lastState;
  const preferenceControls = ['saveRelay', 'autoConnectPreference', 'backgroundPreference', 'wizardBackgroundYes', 'wizardBackgroundNo'];
  function dismiss() { try { localStorage.setItem('airdrop-welcome-seen', 'true'); } catch {} wizard.close(); }
  function showStage(next) {
    const changed = stage !== next; stage = next;
    const index = ['connection', 'background', 'pairing'].indexOf(stage);
    get('wizardStepLabel').textContent = `Step ${index + 1} of 3`;
    get('wizardTitle').textContent = ['Connect your devices', 'Make it work your way', 'Your devices, connected'][index];
    for (const name of ['connection', 'background', 'pairing']) get('wizard' + name[0].toUpperCase() + name.slice(1)).hidden = name !== stage;
    Array.from(get('wizardSteps').children).forEach((node, i) => {
      node.dataset.state = i < index ? 'complete' : i === index ? 'current' : 'pending';
      if (i === index) node.setAttribute('aria-current', 'step'); else node.removeAttribute('aria-current');
    });
    get('wizardContinue').textContent = stage === 'pairing' ? 'Done' : stage === 'background' ? 'Decide later' : 'Set up later';
    if (changed && wizard.open) get('wizardTitle').focus();
  }
  function openWizard() {
    if (!wizard.open) wizard.showModal();
    showStage(lastState?.status === 'ready' ? lastState.setupComplete ? 'pairing' : 'background' : 'connection');
  }
  get('wizardContinue').onclick = dismiss;
  wizard.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  get('setupDevices').onclick = openWizard;
  get('sharingStatus').onclick = () => navigate('connect');
  async function render() {
    if (polling) return;
    polling = true;
    try {
      const state = await window.airdrop.devices('state'); lastState = state;
      const ready = state.status === 'ready' && !!state.url && !!state.qr;
      const progress = AirdropConnectionProgress.describe(state, startedAt ? (Date.now() - startedAt) / 1000 : 0);
      const active = progress.active;
      if (!initialized) {
        initialized = true;
        get('relayUrl').value = state.preferences?.relayUrl || '';
        if (!state.setupComplete || active) openWizard();
      }
      if (!preferencesBusy) {
        get('autoConnectPreference').checked = state.preferences?.autoConnect !== false;
        get('backgroundPreference').checked = !!state.preferences?.background;
      }
      get('relayKeyHint').textContent = state.preferences?.hasAccessKey ? 'A connection credential is saved. Leave empty to keep it.' : 'Automatic setup registers this computer without a shared access key.';
      if (state.background?.message) get('backgroundHint').textContent = state.background.message;
      get('connectPrivate').hidden = !state.serviceAvailable && !state.internetAvailable;
      get('connectPrivate').disabled = busy || (['private','internet'].includes(state.mode) && (active || ready));
      get('connectPrivate').textContent = ready && ['private','internet'].includes(state.mode) ? 'Connected' : active && ['private','internet'].includes(state.mode) ? 'Connecting…' : 'Reconnect';
      get('disconnectDevices').hidden = state.mode === 'local' || state.status === 'setup-required';
      get('disconnectDevices').disabled = busy;
      if (active && !startedAt) startedAt = Date.now();
      if (ready || state.mode === 'local') startedAt = 0;
      get('sharingStatus').textContent = progress.title;
      get('sharingStatus').dataset.status = ready ? 'ready' : active ? 'connecting' : 'offline';
      get('sharingStatus').title = progress.hint;
      for (const prefix of ['device', 'wizard']) {
        get(prefix + 'Status').textContent = progress.title;
        get(prefix + 'Hint').textContent = progress.hint;
        get(prefix + 'Spinner').hidden = !progress.spinning;
        get(prefix + 'Progress').setAttribute('aria-busy', String(progress.spinning));
        get(prefix + 'Elapsed').hidden = !active;
        get(prefix + 'Elapsed').textContent = `Elapsed: ${Math.floor(progress.elapsed / 60)}:${String(progress.elapsed % 60).padStart(2, '0')}`;
      }
      if (!ready) showStage('connection');
      else if (stage === 'connection') showStage(state.setupComplete ? 'pairing' : 'background');
      get('wizardInternet').hidden = !state.internetAvailable || ready;
      get('wizardInternet').disabled = busy || (state.mode === 'internet' && active);
      get('wizardInternet').textContent = active && state.mode === 'internet' ? 'Connecting automatically…' : 'Connect over the internet — free';
      get('wizardInternetNote').hidden = !state.internetAvailable;
      get('wizardConnect').hidden = !state.serviceAvailable || ready;
      get('wizardConnect').disabled = busy || (state.mode === 'private' && active);
      get('wizardConnect').textContent = active && state.mode === 'private' ? 'Connecting automatically…' : 'Connect across networks';
      get('wizardLan').hidden = ready || (state.mode === 'lan' && active);
      get('wizardLan').disabled = busy || !(state.interfaces || []).length;
      get('wizardLan').textContent = (state.interfaces || []).length ? 'Connect over Wi-Fi' : 'Connect to Wi-Fi to continue';
      get('wizardCancel').hidden = !active;
      get('wizardCancel').disabled = busy;
      get('deviceStatus').dataset.status = state.status;
      get('deviceLink').hidden = !ready;
      get('deviceAddress').value = ready ? state.url : '';
      for (const id of ['deviceQr', 'wizardQr']) { if (ready) get(id).src = state.qr; else get(id).removeAttribute('src'); }
      get('wizardCopy').disabled = !ready;
      get('wizardNetworkHint').textContent = state.mode === 'lan' ? 'Keep both devices on the same trusted Wi-Fi. The phone can use Safari or Chrome; no extra app is required.' : 'Your phone can use Wi-Fi or mobile data. Open the link in Safari on iPhone or Chrome on Android.';
      get('wizardPairingStatus').textContent = state.pairedAt ? 'Device connected. You can now share files and text.' : 'Waiting for your phone. You can also add it later from Settings.';
      get('wizardBackgroundSummary').textContent = (state.background?.message || (state.preferences?.background ? 'Background sharing is on.' : 'Sharing stops when this window closes.')) + ' Change this anytime in Settings → Device connection.';
      const interfaces = JSON.stringify(state.interfaces);
      if (interfaces !== interfacesKey) {
        interfacesKey = interfaces;
        get('lanInterface').replaceChildren(...(state.interfaces || []).map(i => { const option = document.createElement('option'); option.value = i.address; option.textContent = i.name + ' — ' + i.address; return option; }));
      }
    } catch (error) { get('sharingStatus').textContent = 'Connection unavailable'; get('wizardError').hidden = false; get('wizardError').textContent = 'We could not check the connection. Please try again.'; }
    finally { polling = false; }
  }
  async function mode(value) {
    if (busy) return;
    busy = true; get('wizardError').hidden = true;
    for (const id of ['wizardInternet', 'wizardConnect', 'wizardLan', 'connectPrivate', 'connectLan']) get(id).disabled = true;
    startedAt = Date.now();
    try { await window.airdrop.devices('mode', { mode: value, address: value === 'lan' ? get('lanInterface').value || undefined : undefined }); }
    catch (error) { get('wizardError').hidden = false; get('wizardError').textContent = 'The connection could not start. Check your Wi-Fi and try again.'; }
    finally { busy = false; get('connectLan').disabled = false; await render(); }
  }
  async function preferences(patch, finish = false) {
    if (preferencesBusy) return;
    preferencesBusy = true; for (const id of preferenceControls) get(id).disabled = true;
    get('wizardError').hidden = true;
    get('connectionPreferencesResult').textContent = 'Saving connection preferences…';
    if (finish) get('wizardBackgroundResult').textContent = patch.background ? 'Checking background permission…' : 'Saving your choice…';
    try {
      const state = await window.airdrop.devices(finish ? 'finish-setup' : 'preferences', patch);
      get('relayAccessKey').value = '';
      get('connectionPreferencesResult').textContent = 'Connection preferences saved.';
      if (finish) { lastState = state; get('wizardBackgroundResult').textContent = ''; showStage('pairing'); }
    } catch (error) {
      get('connectionPreferencesResult').textContent = error.message;
      get('wizardError').hidden = false; get('wizardError').textContent = finish ? 'Your choice could not be saved. Reconnect and try again.' : error.message;
      get('wizardBackgroundResult').textContent = '';
    } finally { preferencesBusy = false; for (const id of preferenceControls) get(id).disabled = false; await render(); }
  }
  get('saveRelay').onclick = () => preferences({ relayUrl: get('relayUrl').value.trim(), accessKey: get('relayAccessKey').value });
  get('autoConnectPreference').onchange = () => preferences({ autoConnect: get('autoConnectPreference').checked });
  get('backgroundPreference').onchange = () => preferences({ background: get('backgroundPreference').checked });
  get('wizardBackgroundYes').onclick = () => preferences({ background: true }, true);
  get('wizardBackgroundNo').onclick = () => preferences({ background: false }, true);
  get('wizardInternet').onclick = () => mode('internet');
  get('wizardConnect').onclick = () => mode('private');
  get('wizardLan').onclick = () => mode('lan');
  get('wizardCancel').onclick = () => mode('local');
  get('connectPrivate').onclick = () => mode(lastState?.mode === 'internet' || (!lastState?.serviceAvailable && lastState?.internetAvailable) ? 'internet' : 'private');
  get('connectLan').onclick = () => mode('lan');
  get('disconnectDevices').onclick = () => mode('local');
  for (const id of ['copyDeviceAddress', 'wizardCopy']) get(id).onclick = () => window.airdrop.devices('copy').then(() => { if (id === 'wizardCopy') get('wizardPairingStatus').textContent = 'Connection link copied. Open it on your phone.'; }).catch(() => { get('wizardError').hidden = false; get('wizardError').textContent = 'Reconnect to get a new link.'; });
  showStage('connection'); render(); setInterval(render, 1500);
})();
