'use strict';
(() => {
  if (!window.airdrop.setup) { document.getElementById('connectionCard').hidden = true; return; }
  let currentAction = '', pending = false, firstLaunchShown = false;
  const get = id => document.getElementById(id);
  const labels = { install: 'Install Tailscale', start: 'Start Tailscale', connect: 'Connect to Tailscale', share: 'Prepare private sharing', approve: 'Approve this computer', bridge: 'Install system connection component' };
  function display(value) {
    if (value.firstLaunch && !firstLaunchShown) { firstLaunchShown = true; document.querySelector('[data-view=connection]').click(); }
    get('setupImport').hidden = value.channel !== 'flatpak';
    get('setupImport').disabled = Boolean(value.pending);
    get('setupNavStatus').hidden = value.state === 'connected';
    get('setupNavStatus').textContent = value.state === 'no-peers' ? '0' : '!';
    document.querySelector('[data-view=connection]').title = value.label || 'Set up private sharing';
    pending = Boolean(value.pending); currentAction = value.action || '';
    get('setupState').textContent = value.label || 'Checking private connection…';
    get('connectionCard').dataset.state = value.state;
    get('setupAction').hidden = !currentAction; get('setupAction').disabled = pending;
    get('setupAction').textContent = labels[currentAction] || 'Continue';
    get('setupLogin').hidden = !value.loginAvailable;
    get('setupMigrate').hidden = !value.migrationRequired; get('setupMigrate').disabled = pending;
    get('refreshConnection').disabled = pending;
    get('setupMessage').textContent = value.message || value.sessionError || (value.migrationRequired ? 'Move your existing installation before starting the packaged servers. Your files and settings will be kept.' : value.state === 'no-peers' ? 'No other online Tailscale device is visible yet. Connect another device to the same network.' : '');
    Array.from(get('setupSteps').children).forEach((step, index) => { step.dataset.complete = String(index < (value.step || 0)); step.setAttribute('aria-current', index === value.step ? 'step' : 'false'); });
    get('setupDevice').hidden = !value.url;
    get('setupAddress').textContent = value.url || '';
    if (value.qr) get('setupQr').src = value.qr;
    get('setupQr').hidden = !value.qr;
    if (value.url && !get('url').value) get('url').value = value.url;
  }
  async function action(name) {
    if (pending) return;
    pending = true; get('setupAction').disabled = true; get('setupMigrate').disabled = true;
    get('setupMessage').textContent = 'Waiting for permission or completing setup…';
    try { await window.airdrop.setup(name); }
    catch (error) { get('setupMessage').textContent = (error.message || String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); }
    finally { pending = false; get('setupAction').disabled = false; get('setupMigrate').disabled = false; }
  }
  get('setupAction').onclick = () => action(currentAction);
  get('setupMigrate').onclick = () => action('migrate');
  get('setupLogin').onclick = () => window.airdrop.setup('login').catch(error => { get('setupMessage').textContent = error.message; });
  get('setupImport').onclick = () => action('import');
  get('setupPhone').onclick = () => window.airdrop.setup('phone');
  get('aptGuide').onclick = () => window.airdrop.setup('apt');
  get('refreshConnection').onclick = () => window.airdrop.setup('refresh').then(display).catch(error => { get('setupMessage').textContent = error.message; });
  window.airdrop.onSetup(display); window.airdrop.setup('state').then(display).catch(() => {});
})();
