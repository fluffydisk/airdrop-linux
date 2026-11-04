'use strict';
const crypto = require('node:crypto');

function relayUrl(input, { allowLoopback = false } = {}) {
  let url;
  try { url = new URL(input); } catch { throw Error('Enter your Airdrop relay HTTPS address.'); }
  const local = allowLoopback && url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if ((!local && url.protocol !== 'https:') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw Error('Use an HTTPS relay origin without a path, credentials, query or fragment.');
  }
  return url;
}
function deviceId(secret) {
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) throw Error('Invalid device identity');
  return crypto.createHash('sha256').update(secret).digest('hex').slice(0, 32);
}
function equalSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
// Remove hop-by-hop headers, including fields named by Connection, at each hop.
function proxyHeaders(headers) {
  const removed = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'x-airdrop-device']);
  for (const name of String(headers.connection || '').split(',')) removed.add(name.trim().toLowerCase());
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !removed.has(name.toLowerCase()) && !name.startsWith('x-forwarded-') && name !== 'forwarded'));
}
module.exports = { relayUrl, deviceId, equalSecret, proxyHeaders };
