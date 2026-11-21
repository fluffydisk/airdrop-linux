'use strict';
// Private native dialog only. Never put its options/code into persisted state,
// renderer progress, logs, telemetry or laboratory evidence.
function transferConsent(request, { lab = false } = {}) {
  const pairing = request.type === 'pair', quickshare = request.transport === 'quick-share';
  if (quickshare && !/^\d{4}$/.test(request.code || '')) throw Error('Verification code unavailable');
  const comparison = request.code ? `Verification code: ${request.code}\nCompare with the other device. Decline if the codes differ.` : '';
  return {
    type: 'question', buttons: [pairing ? 'Pair device' : quickshare ? 'Codes match — accept files' : 'Accept files', 'Decline'], defaultId: 1, cancelId: 1,
    message: quickshare ? `${comparison}\n\nReceive files from “${request.name}”?` : (pairing ? `Pair with “${request.name}”?` : `Receive files from “${request.name}”?`) + (comparison ? '\n\n' + comparison : ''),
    detail: pairing ? `Compare this code on both devices: ${request.code}\nOnly pair if the codes match. Pairing permits file transfer requests, with acceptance required. It grants no workspace or clipboard access.` :
      `${request.files.length} files · ${(request.total ?? request.files.reduce((n, f) => n + (f.size || 0), 0)).toLocaleString()} bytes\n${request.files.slice(0, 8).map(f => f.name).join('\n')}\n${lab ? 'Saved to the private lab inbox shown in the development panel.' : 'Saved to Airdrop/Received.'} Requests expire after 60 seconds.`
  };
}
async function approveTransfer(window, request, { dialog, lab = false } = {}) {
  if (!window || window.isDestroyed()) return false;
  window.show(); window.focus();
  const approval = new AbortController(), expiry = setTimeout(() => approval.abort(), 55000); expiry.unref();
  try {
    const response = await dialog.showMessageBox(window, { ...transferConsent(request, { lab }), signal: approval.signal });
    return response.response === 0;
  } finally { clearTimeout(expiry); }
}
module.exports = { transferConsent, approveTransfer };
