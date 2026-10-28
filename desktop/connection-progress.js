'use strict';
// Shared by the welcome dialog and Settings. No invented completion percentage.
(function (global) {
  function describe(state, elapsed = 0) {
    const ready = state.status === 'ready' && !!state.url && !!state.qr;
    const active = state.mode === 'tailscale' && !['local','error','disconnected'].includes(state.status) && !ready;
    let title = 'Ready when you are', hint = 'Connect with Tailscale to share securely with your phone or tablet.', spinning = active;
    if (ready) { title = 'Connected'; hint = state.mode === 'lan' ? 'Use the same trusted Wi-Fi. LAN uses unencrypted HTTP; keep the sharing link private.' : 'Your sharing link and QR code are ready in Settings. Your other device must join the same tailnet.'; }
    else if (state.authURL) { title = 'Sign in to Tailscale'; hint = 'Click Sign in through browser, finish signing in, then return here. We will detect the connection automatically.'; spinning = false; }
    else if (state.status === 'NeedsMachineAuth') { title = 'Waiting for device approval'; hint = 'Your tailnet administrator must approve this device. We will keep checking.'; }
    else if (state.status === 'needs-https') { title = 'Enable secure sharing'; hint = 'Open HTTPS settings and enable MagicDNS and HTTPS certificates for your tailnet. We will check again automatically.'; spinning = false; }
    else if (['checking-https','https-unavailable'].includes(state.status)) { title = 'Checking secure sharing…'; hint = 'Verifying the HTTPS certificate and connection. This can take a few minutes. Checks continue automatically; you do not need to reconnect.'; }
    else if (active) { title = 'Connecting to Tailscale…'; hint = 'Preparing your private connection. A sign-in button will appear if needed.'; }
    else if (['error','disconnected'].includes(state.status)) { title = 'Connection unavailable'; hint = state.message || 'Check your internet connection, then try Connect again.'; }
    if (active) hint += elapsed >= 45 ? ' Taking longer than usual. You can continue on this computer, check your internet/tailnet settings, or cancel the connection.' : ' You can keep using Airdrop while this completes.';
    return {ready, active, title, hint, spinning, elapsed:Math.max(0, Math.floor(elapsed))};
  }
  global.AirdropConnectionProgress = {describe};
})(window);
