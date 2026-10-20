'use strict';
function connectionState(raw) {
  const state = raw?.BackendState;
  if (!raw?.installed) return { state: 'missing', label: 'Install Tailscale', action: 'install', step: 1 };
  if (!raw.service) return { state: 'stopped', label: 'Start Tailscale', action: 'start', step: 2 };
  if (state === 'NeedsMachineAuth') return { state: 'approval', label: 'Approve this computer in Tailscale', action: 'approve', step: 3 };
  if (state === 'NeedsLogin' || state === 'NoState') return { state: 'login', label: 'Connect to Tailscale', action: 'connect', step: 3 };
  if (state !== 'Running' || !raw.TailscaleIPs?.length || raw.Self?.Online === false) return { state: 'disconnected', label: 'Tailscale is disconnected', action: 'connect', step: 3 };
  if (raw.conflict || raw.otherOwner) return { state: 'conflict', label: raw.otherOwner ? 'Sharing belongs to another local user' : 'Another application uses this sharing address', step: 4 };
  const peers = Object.values(raw.Peer || {}).filter(peer => peer.Online && peer.ID !== raw.Self?.ID).map(peer => ({ name: peer.HostName || peer.DNSName || 'Device', online: true }));
  const dns = String(raw.Self?.DNSName || '').replace(/\.$/, '');
  const url = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net$/i.test(dns) ? `https://${dns}/ui/` : '';
  if (!raw.sharing) return { state: 'configure', label: 'Prepare private sharing', action: 'share', step: 4, peers, url };
  return { state: peers.length ? 'connected' : 'no-peers', label: peers.length ? `Tailscale connected · ${peers.length} other device${peers.length === 1 ? '' : 's'} online` : 'Connect a second device', step: peers.length ? 6 : 5, peers, url };
}
module.exports = { connectionState };
