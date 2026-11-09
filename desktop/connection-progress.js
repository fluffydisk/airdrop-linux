'use strict';
(function (global) {
  function describe(state, elapsed = 0) {
    const ready = state.status === 'ready' && !!state.url && !!state.qr;
    const pendingPhone=state.status==='phone-verification';
    const active = state.mode !== 'local' && ['starting', 'downloading', 'enrolling', 'connecting', 'reconnecting', 'checking','phone-verification'].includes(state.status);
    let title = 'Connection stopped', hint = state.message || 'Connect from Settings to share with another device.', step = 0;
    if (ready) { title = 'Connected'; step = 4; hint = state.mode === 'lan' ? 'Use the same trusted Wi-Fi. LAN uses unencrypted HTTP; keep the sharing link private.' : state.mode==='internet'?'This temporary link is verified. Keep Airdrop running; after a reconnect, scan the new QR shown here.':state.verifiedBy==='phone'?'Your phone verified this sharing connection. Keep Airdrop running to continue sharing.':'Your sharing link and QR code are ready in Settings. Open the link on your other device from any network.'; }
    else if (state.status === 'setup-required') { title = 'Choose a connection provider'; hint = 'Airdrop is the default. You can also choose Tailscale or connect over Wi-Fi, and switch anytime in Settings.'; }
    else if (state.status === 'checking') { title = 'Verifying sharing…'; hint = state.mode === 'lan' ? 'Checking your local connection before creating a sharing code.' : 'Checking your connection before creating a sharing code.'; step = 2; }
    else if (state.status === 'reconnecting') { title = 'Reconnecting…'; hint = state.message; step = 1; }
    else if(state.status==='needs-login'){title='Sign in to Tailscale';hint='Choose Sign in to Tailscale inside Airdrop below. You can also select Airdrop or Wi-Fi.';}
    else if(state.status==='needs-approval'||state.status==='needs-https'){title='Tailscale setup needs attention';hint=state.message;}
    else if(state.status==='phone-verification'){title='Waiting for phone verification';hint=state.message;}
    else if (active) { title = 'Connecting…'; hint = state.message || 'Setting up your Airdrop connection…'; step = 1; }
    else if (['error', 'disconnected'].includes(state.status)) { title = 'Connection unavailable'; hint = state.message || 'Check your connection, then try again.'; }
    if (active&&!pendingPhone) hint += elapsed >= 45 ? ' Taking longer than usual. Check your network connection, or continue using local files.' : ' You can continue using local files while this completes.';
    return { ready, active, title, hint, step, spinning: active&&!pendingPhone, elapsed: Math.max(0, Math.floor(elapsed)) };
  }
  global.AirdropConnectionProgress = { describe };
})(window);
