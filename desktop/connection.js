'use strict';

function workspaceUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Enter a Tailscale HTTPS URL ending in .ts.net'); }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.ts.net') || url.username || url.password || url.port) {
    throw new Error('Enter a Tailscale HTTPS URL ending in .ts.net');
  }
  url.pathname = '/ui/'; url.search = ''; url.hash = '';
  return url.href;
}

// Checks application reachability, not the host VPN daemon or another device.
async function checkConnection(input, request = fetch) {
  const checkedAt = new Date().toISOString();
  if (!input) return { status: 'not-configured', checkedAt, message: 'No workspace address is saved. Local files and clipboard are still available.' };
  try {
    const url = new URL('/push/health', workspaceUrl(input));
    const response = await request(url.href, { signal: AbortSignal.timeout(5000), redirect: 'error', credentials: 'omit' });
    if (!response.ok) throw new Error('Workspace health request failed');
    const health = await response.json();
    if (health?.push !== true || health?.share !== true) throw new Error('Workspace services are not ready');
    return { status: 'reachable', checkedAt, message: 'The saved workspace address is reachable from this computer. Access from another device is not verified.' };
  } catch {
    return { status: 'unreachable', checkedAt, message: 'The saved workspace address could not be reached securely. Check host Tailscale sign-in, tailnet HTTPS and Tailscale Serve. Local files and clipboard are still available.' };
  }
}

module.exports = { workspaceUrl, checkConnection };
