'use strict';
(() => {
  const title = document.getElementById('mobileConnectionTitle');
  const hint = document.getElementById('mobileConnectionHint');
  const retry = document.getElementById('mobileConnectionRetry');
  let checking = false;
  async function check() {
    if (checking) return;
    checking = true; retry.disabled = true;
    try {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
      let response, value;
      try { response = await fetch('/push/health', { cache: 'no-store', signal: controller.signal }); if (response.ok) value = await response.json(); }
      finally { clearTimeout(timer); }
      if (response.status === 401) {
        title.textContent = 'Connect to your computer again';
        hint.textContent = 'Open Connect a device in Airdrop on your computer and scan the new QR code.';
        retry.hidden = false; return;
      }
      if (!response.ok || value?.push !== true || value?.share !== true) throw Error('Workspace unavailable');
      title.textContent = 'Connected to your computer';
      hint.textContent = 'Choose Upload to send photos or files, or Files to download them. Keep this page open while a transfer is running.';
      retry.hidden = true;
    } catch {
      title.textContent = 'Waiting for your computer';
      hint.textContent = 'Keep Airdrop open on your computer, or enable background sharing in its Settings. For Wi-Fi sharing, keep both devices on the same network.';
      retry.hidden = false;
    } finally { checking = false; retry.disabled = false; }
  }
  retry.onclick = check;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('online', check);
  window.addEventListener('offline', () => { title.textContent = 'You are offline'; hint.textContent = 'Reconnect to Wi-Fi or mobile data, then try again.'; retry.hidden = false; });
  setInterval(() => { if (document.visibilityState === 'visible') check(); }, 15000);
  check();
})();
