'use strict';
(async () => {
  if (!window.airdrop.sharing) return;
  const panel = document.getElementById('quickshareLab');
  const render = async () => {
    const value = await window.airdrop.sharing('lab-info');
    if (!value.enabled) return false;
    document.title = 'Airdrop S24 Lab — DEVELOPMENT ' + value.commit.slice(0, 12);
    if (document.body.dataset.quickshareLab !== 'true') {
      document.body.dataset.quickshareLab = 'true';
      for (const id of ['nearbyLink', 'nearbyPhone']) document.getElementById(id).hidden = true;
      document.getElementById('nearbyEnabled').closest('label').hidden = true;
      const card = document.getElementById('nearbyHeading').parentElement;
      card.querySelector('.field-help').textContent = 'Native Samsung Quick Share test. Keep the phone on its stock Receive screen. No QR, browser or companion app is used.';
      card.querySelector('details').hidden = true;
      card.querySelectorAll('.field-help')[1].textContent = 'Choose the Samsung recipient, then generated files and Send. Fresh receiver acceptance is required.';
      document.getElementById('transferDestination').hidden = true;
      if (document.getElementById('setupDevices')) document.getElementById('setupDevices').hidden = true;
      document.getElementById('zip').closest('label').hidden = true;
      window.dispatchEvent(new Event('airdrop-lab-mode'));
    }
    panel.hidden = false;
    document.getElementById('labBuild').textContent = `Source ${value.commit}${value.dirty ? ' (modified working tree)' : ''} · helper ${value.helperVersion} · SHA-256 ${value.helperSha256}`;
    const helper = value.evidence.helper;
    document.getElementById('labRuntime').textContent = `Helper: ${helper.status} · native recipients currently visible: ${value.evidence.recipients} · listener ${helper.listenerPort ? 'bound on port ' + helper.listenerPort : 'not confirmed'}. Local advertisement observed: ${value.localAdvertisementObserved ? 'yes' : 'not yet'} · TCP listener reachable: ${value.listenerReachable ? 'yes' : 'not confirmed'}.`;
    document.getElementById('labCapabilities').textContent = `LAN: ${helper.capabilities.lan ? 'yes' : 'not ready'} · BLE compiled: ${helper.capabilities.ble ? 'yes (experimental)' : 'no'} · receiver advertising: ${helper.bluetooth?.bleAdvertising ? helper.bluetooth.mode : 'off'} · GATT registered: ${helper.bluetooth?.gattBootstrap ? 'yes' : 'no'} · scanning: ${helper.bluetooth?.bleScanning ? 'active' : 'paused/off'} · observed/decoded/resolved: ${helper.bluetooth?.observed || 0}/${helper.bluetooth?.decoded || 0}/${helper.bluetooth?.resolved || 0} · bootstrap: ${helper.bluetooth?.stage || 'not-requested'} · FE2C sender nudge: ${helper.bleFastInitState || 'not-requested'} · direct wireless: ${helper.capabilities.direct ? 'yes' : 'no'}. ${value.bleExplanation}`;
    document.getElementById('labFolders').textContent = `Test files: ${value.fixtureDirectory} · received files: ${value.inbox} · USB readback: ${value.readbackDirectory}`;
    return true;
  };
  try { if (await render()) setInterval(() => render().catch(() => {}), 1500); } catch { /* Normal helper-free builds have no lab. */ }
})();
