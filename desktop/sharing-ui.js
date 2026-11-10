'use strict';
(() => {
  if (!window.airdrop.sharing) return;
  const get = id => document.getElementById(id);
  let sources = [], polling = false, generation = 0;
  const status = text => { get('invitationStatus').textContent = text; };
  function render(invitation) {
    const ready = invitation.status === 'ready';
    get('invitationReady').hidden = !ready;
    get('invitationConnections').hidden = ready || invitation.status === 'preparing';
    get('invitationStop').hidden = invitation.status === 'idle' || invitation.status === 'connection-required';
    if (!ready) { get('invitationAddress').value = ''; get('invitationQr').removeAttribute('src'); }
    if (ready) {
      get('invitationAddress').value = invitation.url; get('invitationQr').src = invitation.qr;
      get('invitationDetails').textContent = `${invitation.files.length} selected files · Download only · Expires ${new Date(invitation.expires).toLocaleTimeString()}. Keep Airdrop running.`;
      status(invitation.provider === 'lan' ? 'Link ready on this local network. The recipient must have direct access to this computer.' : 'Verified link ready. Open it in the recipient’s browser or scan the QR.');
    } else if (invitation.message) status(invitation.message);
    get('invitationCopy').disabled = !ready;
  }
  async function start(provider) {
    const current = ++generation;
    get('invitationPanel').hidden = false;
    if (!sources.length) { status('Select files, then choose Create sharing link.'); return; }
    render({ status: 'preparing', message: 'Preparing a verified sharing link…' });
    try {
      const invitation = await window.airdrop.sharing('invitation-start', { sources, direction: 'send', ...(provider ? { provider } : {}) });
      if (current === generation) render(invitation);
    } catch (error) { if (current === generation) render({ status: 'error', message: error.message }); }
  }
  window.addEventListener('airdrop-invitation', event => { sources = [...event.detail.sources]; start(); });
  window.addEventListener('airdrop-queue', event => { sources = [...event.detail.sources]; });
  get('sendDestination').addEventListener('change', () => {
    if (get('sendDestination').value === 'guest') { get('invitationPanel').hidden = false; status('Select files, then choose Create sharing link.'); }
  });
  get('invitationInternet').onclick = () => start('internet');
  get('invitationLan').onclick = () => start('lan');
  get('invitationSettings').onclick = () => get('setupDevices').click();
  get('invitationCopy').onclick = async () => {
    try { await window.airdrop.sharing('invitation-copy'); status('Link copied. Share it only with the intended recipient.'); }
    catch (error) { render({ status: 'error', message: error.message }); }
  };
  get('invitationStop').onclick = async () => {
    ++generation;
    try { await window.airdrop.sharing('invitation-stop'); render({ status: 'idle', message: 'Invitation stopped. The old link no longer works.' }); }
    catch (error) { status(error.message); }
  };
  async function refresh() {
    if (polling || get('invitationPanel').hidden) return;
    polling = true; const current = generation;
    try { const value = await window.airdrop.sharing('state'); if (current === generation) render(value.invitation); }
    catch (error) { render({ status: 'error', message: error.message }); }
    finally { polling = false; }
  }
  setInterval(refresh, 1000);
})();
