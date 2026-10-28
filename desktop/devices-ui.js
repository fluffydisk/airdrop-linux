'use strict';
(() => {
  const get = id => document.getElementById(id);
  const wizard = get('connectionWizard');
  let busy = false, interfacesKey = '', latest, initialized = false;
  async function render() {
    try {
      const state = await window.airdrop.devices('state'); latest = state;
      get('deviceStatus').textContent = state.message;
      get('deviceStatus').dataset.status = state.status;
      const interfaces = JSON.stringify(state.interfaces);
      if (interfaces !== interfacesKey) {
        interfacesKey = interfaces;
        get('lanInterface').replaceChildren(...state.interfaces.map(i => {
          const option = document.createElement('option'); option.value = i.address; option.textContent = i.name + ' — ' + i.address; return option;
        }));
      }
      const ready = state.status === 'ready' && !!state.url && !!state.qr;
      get('deviceLogin').hidden = !state.authURL;
      get('deviceHttps').hidden = state.status !== 'needs-https';
      get('deviceLink').hidden = !ready;
      get('deviceAddress').value = ready ? state.url : '';
      if (ready) get('deviceQr').src = state.qr; else get('deviceQr').removeAttribute('src');
      get('activeWorkspace').value = ready ? state.url : '';
      get('copyActiveWorkspace').disabled = !ready;
      get('activeWorkspaceStatus').textContent = ready ? `${state.mode === 'tailscale' ? 'Tailscale HTTPS' : 'Trusted LAN HTTP'} · ${state.message}` : state.message;
      if (!initialized) { initialized = true; if (!state.onboarded) wizard.showModal(); }
      get('wizardStatus').textContent = state.message;
      get('wizardLogin').hidden = !state.authURL;
      get('wizardHttps').hidden = state.status !== 'needs-https';
      get('wizardContinue').disabled = !(ready && state.mode === 'tailscale');
      get('wizardAddress').hidden = !(ready && state.mode === 'tailscale');
      get('wizardAddress').value = ready && state.mode === 'tailscale' ? state.url : '';
    } catch (error) { get('deviceStatus').textContent = error.message; get('wizardStatus').textContent = error.message; }
  }
  async function mode(value) {
    if (busy) return;
    busy = true; get('deviceLink').hidden = true;
    get('deviceStatus').textContent = get('wizardStatus').textContent = 'Starting connection…';
    for (const id of ['wizardTailnet', 'connectTailnet', 'connectLan', 'disconnectDevices']) get(id).disabled = true;
    try { await window.airdrop.devices('mode', {mode:value,address:get('lanInterface').value || undefined}); }
    catch (error) { get('deviceStatus').textContent = get('wizardStatus').textContent = error.message; }
    finally { busy = false; for (const id of ['wizardTailnet', 'connectTailnet', 'connectLan', 'disconnectDevices']) get(id).disabled = false; await render(); }
  }
  for (const id of ['wizardTailnet', 'connectTailnet']) get(id).onclick = () => mode('tailscale');
  get('connectLan').onclick = () => mode('lan');
  get('disconnectDevices').onclick = () => mode('local');
  for (const id of ['deviceLogin', 'wizardLogin']) get(id).onclick = () => window.airdrop.devices('login').catch(error => { get('wizardStatus').textContent = get('deviceStatus').textContent = error.message; });
  for (const id of ['deviceHttps', 'wizardHttps']) get(id).onclick = () => window.airdrop.devices('https-settings').catch(error => { get('wizardStatus').textContent = error.message; });
  for (const id of ['copyDeviceAddress', 'copyActiveWorkspace']) get(id).onclick = () => window.airdrop.devices('copy').catch(error => { get('activeWorkspaceStatus').textContent = error.message; });
  get('manageConnection').onclick = () => navigate('connect');
  get('wizardContinue').onclick = () => {
    if (latest?.status === 'ready' && latest.mode === 'tailscale' && latest.url && latest.qr) { wizard.close(); navigate('connect'); }
  };
  get('wizardQuit').onclick = () => window.airdrop.quit();
  wizard.addEventListener('cancel', event => event.preventDefault());
  render(); setInterval(() => { if (!busy) render(); }, 1500);
})();
