'use strict';
(() => {
  const get = id => document.getElementById(id);
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
      let message = ready ? 'Connected. Scan the code on your other device.' : state.status === 'local' ? 'Sharing on this computer only.' : state.message;
      if (running && !ready && startedAt && Date.now() - startedAt > 45000) message += ' Still waiting for Tailscale or its HTTPS certificate. You can keep using Transfer; no need to reconnect. Disconnect to cancel.';
      get('deviceStatus').textContent = message;
      get('deviceStatus').dataset.status = state.status;
      get('deviceLink').hidden = !ready;
      get('deviceAddress').value = ready ? state.url : '';
      if (ready) get('deviceQr').src = state.qr; else get('deviceQr').removeAttribute('src');
      const interfaces = JSON.stringify(state.interfaces);
      if (interfaces !== interfacesKey) {
        interfacesKey = interfaces;
        get('lanInterface').replaceChildren(...state.interfaces.map(i => { const option = document.createElement('option'); option.value = i.address; option.textContent = i.name + ' — ' + i.address; return option; }));
      }
    } catch (error) { get('deviceStatus').textContent = error.message; }
    finally { polling = false; }
  }
  async function mode(value) {
    if (busy) return;
    busy = true; get('connectTailnet').disabled = true; get('connectLan').disabled = true;
    get('deviceStatus').textContent = value === 'local' ? 'Disconnecting…' : 'Connecting…';
    if (value === 'tailscale') startedAt = Date.now();
    try { await window.airdrop.devices('mode', {mode:value,address:get('lanInterface').value || undefined}); }
    catch (error) { get('deviceStatus').textContent = error.message; }
    finally { busy = false; get('connectLan').disabled = false; await render(); }
  }
  get('connectTailnet').onclick = () => mode('tailscale');
  get('connectLan').onclick = () => mode('lan');
  get('disconnectDevices').onclick = () => mode('local');
  for (const [id, action] of [['deviceLogin','login'],['deviceHttps','https-settings'],['copyDeviceAddress','copy']]) get(id).onclick = () => window.airdrop.devices(action).catch(error => { get('deviceStatus').textContent = error.message; });
  render(); setInterval(render, 1500);
})();
