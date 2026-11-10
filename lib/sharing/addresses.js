'use strict';
const os = require('node:os');
const net = require('node:net');

function interfaces(all = os.networkInterfaces()) {
  return Object.entries(all).filter(([name]) => !/^(lo$|docker|br-|veth|virbr|tailscale|tun|tap|wg)/i.test(name))
    .flatMap(([name, entries]) => (entries || []).filter(e => !e.internal && net.isIP(e.address)).map(e => ({ name, address: e.address, netmask: e.netmask })))
    .sort((a, b) => a.name.localeCompare(b.name) || a.address.localeCompare(b.address));
}
function number(address) {
  const raw = address.split('%')[0];
  if (net.isIPv4(raw)) return raw.split('.').reduce((n, octet) => (n << 8n) | BigInt(octet), 0n);
  if (!net.isIPv6(raw) || raw.includes('.')) return null; // Never dial IPv4-mapped IPv6 hints.
  const halves = raw.split('::'), left = halves[0] ? halves[0].split(':') : [], right = halves[1] ? halves[1].split(':') : [];
  return [...left, ...Array(8 - left.length - right.length).fill('0'), ...right].reduce((n, word) => (n << 16n) | BigInt('0x' + word), 0n);
}
function eligible(address) {
  const raw = address.split('%')[0], family = net.isIP(raw);
  if (family === 4) return !/^(0\.|127\.|169\.254\.169\.254$|255\.)/.test(raw) && Number(raw.split('.')[0]) < 224;
  if (family === 6) return raw !== '::' && raw !== '::1' && !/^ff/i.test(raw) && !raw.includes('.');
  return false;
}
function candidates(address, local = interfaces()) {
  if (typeof address !== 'string' || address.length > 100 || !eligible(address)) return [];
  const [raw, scope, extra] = address.split('%');
  if (extra !== undefined || (scope && !/^[A-Za-z0-9_.-]+$/.test(scope))) return [];
  const family = net.isIP(raw), value = number(raw);
  if (value === null) return [];
  return [...new Set(local.filter(entry => {
    if (scope && scope !== entry.name) return false;
    if (net.isIP(entry.address.split('%')[0]) !== family || !entry.netmask) return false;
    const mask = number(entry.netmask), own = number(entry.address);
    return mask !== null && mask !== 0n && own !== null && (value & mask) === (own & mask);
  }).map(entry => family === 6 && /^fe[89ab]/i.test(raw) ? raw + '%' + entry.name : raw))];
}
module.exports = { interfaces, candidates };
