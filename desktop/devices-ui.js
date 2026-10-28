'use strict';
(() => {
  const get = id => document.getElementById(id);
  const wizard = get('connectionWizard');
  function continueLocally() { try { localStorage.setItem('airdrop-welcome-seen', 'true'); } catch {} wizard.close(); }
  try { if (localStorage.getItem('airdrop-welcome-seen') !== 'true') wizard.showModal(); } catch { wizard.showModal(); }
  get('wizardContinue').onclick = continueLocally;
  wizard.addEventListener('cancel', event => { event.preventDefault(); continueLocally(); });
  let busy = false, polling = false, interfacesKey = '', startedAt = 0;
  async function render() {
    if (polling) return;
    polling = true;
    try {
      const state = await window.airdrop.devices('state');
      const ready = state.status === 'ready' && !!state.url && !!state.qr;
      const running = state.mode === 'tailscale' && !['error','disconnected','local'].includes(state.status);
      get('connectTailnet').disabled = busy || running;
      get('connectTailnet').textContent = ready && state.mode === 'tailscale' ? 'Connected' : running ? 'Connecting…' : 'Connect';
      get('disconnectDevices').hidden = state.mode === 'local';
      get('disconnectDevices').disabled = busy;
      get('deviceLogin').hidden = !state.authURL;
      get('deviceHttps').hidden = state.status !== 'needs-https';
      if (running && !ready && !startedAt) startedAt = Date.now();
      if (ready || state.mode === 'local') startedAt = 0;
      const progress = AirdropConnectionProgress.describe(state, startedAt ? (Date.now() - startedAt) / 1000 : 0);
      for (const prefix of ['device', 'wizard']) {
        get(prefix + 'Status').textContent = progress.title;
        get(prefix + 'Hint').textContent = progress.hint;
        get(prefix + 'Spinner').hidden = !progress.spinning;
        get(prefix + 'Progress').setAttribute('aria-busy', String(progress.spinning));
        get(prefix + 'Elapsed').hidden = !progress.active;
        get(prefix + 'Elapsed').textContent = `Elapsed: ${Math.floor(progress.elapsed / 60)}:${String(progress.elapsed % 60).padStart(2, '0')}`;
      }
      get('wizardTailnet').disabled = busy || running;
      get('wizardTailnet').textContent = running ? 'Connecting…' : 'Connect with Tailscale';
      get('wizardTailnet').hidden = !!state.authURL || state.status === 'needs-https' || progress.ready;
      get('wizardLogin').hidden = !state.authURL;
      get('wizardHttps').hidden = state.status !== 'needs-https';
      get('wizardCancel').hidden = !progress.active;
      get('wizardCancel').disabled = busy;
      get('wizardContinue').textContent = progress.ready ? 'Start sharing' : progress.active ? 'Continue while connecting' : 'Use on this computer';
      get('deviceStatus').dataset.status = state.status;
      get('deviceLink').hidden = !ready;
      get('deviceAddress').value = ready ? state.url : '';
      if (ready) get('deviceQr').src = state.qr; else get('deviceQr').removeAttribute('src');
      const interfaces = JSON.stringify(state.interfaces);
      if (interfaces !== interfacesKey) {
        interfacesKey = interfaces;
        get('lanInterface').replaceChildren(...state.interfaces.map(i => { const option = document.createElement('option'); option.value = i.address; option.textContent = i.name + ' — ' + i.address; return option; }));
      }
    } catch (error) { for (const prefix of ['device','wizard']) { get(prefix+'Status').textContent = 'Could not check connection'; get(prefix+'Hint').textContent = error.message; get(prefix+'Spinner').hidden = true; get(prefix+'Progress').setAttribute('aria-busy','false'); } }
    finally { polling = false; }
  }
  async function mode(value) {
    if (busy) return;
    busy = true; get('wizardTailnet').disabled = true; get('wizardCancel').disabled = true;
    for (const prefix of ['device','wizard']) { get(prefix+'Status').textContent = value === 'local' ? 'Disconnecting…' : 'Connecting…'; get(prefix+'Spinner').hidden = false; get(prefix+'Progress').setAttribute('aria-busy','true'); }
    get('connectTailnet').disabled = true; get('connectLan').disabled = true;
    get('deviceStatus').textContent = value === 'local' ? 'Disconnecting…' : 'Connecting…';
    if (value === 'tailscale') startedAt = Date.now();
    try { await window.airdrop.devices('mode', {mode:value,address:get('lanInterface').value || undefined}); }
    catch (error) { for (const prefix of ['device','wizard']) { get(prefix+'Status').textContent = 'Could not check connection'; get(prefix+'Hint').textContent = error.message; get(prefix+'Spinner').hidden = true; get(prefix+'Progress').setAttribute('aria-busy','false'); } }
    finally { busy = false; get('connectLan').disabled = false; await render(); }
  }
  get('wizardTailnet').onclick = () => mode('tailscale');
  get('wizardCancel').onclick = () => mode('local');
  get('connectTailnet').onclick = () => mode('tailscale');
  get('connectLan').onclick = () => mode('lan');
  get('disconnectDevices').onclick = () => mode('local');
  for (const [id, action] of [['deviceLogin','login'],['wizardLogin','login'],['deviceHttps','https-settings'],['wizardHttps','https-settings'],['copyDeviceAddress','copy']]) get(id).onclick = () => window.airdrop.devices(action).catch(error => { get('deviceStatus').textContent = error.message; });
  render(); setInterval(render, 1500);
})();
