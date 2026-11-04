'use strict';
(function (global) {
  function describe(state, elapsed = 0) {
    const ready = state.status === 'ready' && !!state.url && !!state.qr;
    const active = state.mode !== 'local' && ['starting', 'downloading', 'enrolling', 'connecting', 'reconnecting', 'checking'].includes(state.status);
    let title = 'Connection stopped', hint = state.message || 'Connect from Settings to share with another device.', step = 0;
    if (ready) { title = 'Connected'; step = 4; hint = state.mode === 'lan' ? 'Use the same trusted Wi-Fi. LAN uses unencrypted HTTP; keep the sharing link private.' : 'Your sharing link and QR code are ready in Settings. Open the link on your other device from any network.'; }
    else if (state.status === 'setup-required') { title = 'Ready to connect'; hint = 'Choose free internet sharing or Connect over Wi-Fi. No account or server setup is needed.'; }
    else if (state.status === 'checking') { title = 'Verifying sharing…'; hint = state.mode === 'lan' ? 'Checking your local connection before creating a sharing code.' : 'Checking your connection before creating a sharing code.'; step = 2; }
    else if (state.status === 'reconnecting') { title = 'Reconnecting…'; hint = state.message; step = 1; }
    else if (active) { title = 'Connecting…'; hint = state.message || 'Setting up your Airdrop connection…'; step = 1; }
    else if (['error', 'disconnected'].includes(state.status)) { title = 'Connection unavailable'; hint = state.message || 'Check your connection, then try again.'; }
    if (active) hint += elapsed >= 45 ? ' Taking longer than usual. Check your network connection, or continue using local files.' : ' You can continue using local files while this completes.';
    return { ready, active, title, hint, step, spinning: active, elapsed: Math.max(0, Math.floor(elapsed)) };
  }
  global.AirdropConnectionProgress = { describe };
})(window);
