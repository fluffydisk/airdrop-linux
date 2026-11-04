'use strict';
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { deviceId, equalSecret, proxyHeaders } = require('./relay-protocol');

// A reverse HTTP tunnel. File bodies stream through sockets; they are never
// collected in memory or written to disk by the relay.
function createRelay({ domain, accessKey, tls, allowInsecure = false, enrollment = false, enrollmentLimit = 30, maxDevices = 100, maxRequests = 64, connectTimeout = 15000 } = {}) {
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+$/.test(domain || '')) throw Error('A relay domain is required');
  if (typeof accessKey !== 'string' || accessKey.length < 32) throw Error('Use a relay access key of at least 32 characters');
  if (!tls && !allowInsecure) throw Error('TLS certificate and private key are required');
  const sessions = new Map(), sockets = new Set(), enrollmentRates = new Map();
  let enrollmentWindow = 0, enrollmentCount = 0;
  const server = tls ? https.createServer(tls, handle) : http.createServer(handle);
  server.headersTimeout = 15000;
  server.requestTimeout = 300000;
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  function identify(req) {
    const id = deviceId(req.headers['x-airdrop-device']);
    if (!equalSecret(req.headers.authorization, 'Bearer ' + accessKey) &&
        !(enrollment && equalSecret(req.headers.authorization, 'Bearer ' + deviceToken(req.headers['x-airdrop-device'])))) throw Error('Unauthorized');
    return id;
  }
  function deviceToken(secret) { return 'device.' + crypto.createHmac('sha256', accessKey).update('airdrop-device-v1:' + secret).digest('hex'); }
  function end(res, code, message) { res.writeHead(code, { 'cache-control': 'no-store', 'content-type': 'text/plain' }); res.end(message); }
  function closeSession(session) {
    if (sessions.get(session.id) === session) sessions.delete(session.id);
    clearInterval(session.heartbeat);
    for (const job of [...session.jobs.values()]) job.cancel();
    session.res.end();
  }
  function event(session, value) {
    if (session.res.destroyed || session.res.writableLength > 65536) { closeSession(session); return false; }
    session.res.write(JSON.stringify(value) + '\n'); return true;
  }
  function handle(req, res) {
    const host = (req.headers.host || '').toLowerCase();
    if (host.split(':')[0] === domain && req.url === '/v1/enroll' && req.method === 'POST') {
      if (!enrollment) { end(res, 404, 'Enrollment is unavailable'); return; }
      try { deviceId(req.headers['x-airdrop-device']); } catch { end(res, 400, 'Invalid device identity'); return; }
      if (req.headers.origin || Number(req.headers['content-length'] || 0) !== 0 || req.headers['transfer-encoding']) { end(res, 400, 'Invalid enrollment request'); return; }
      const window = Math.floor(Date.now() / 60000), ip = req.socket.remoteAddress;
      if (window !== enrollmentWindow) { enrollmentWindow = window; enrollmentCount = 0; enrollmentRates.clear(); }
      const count = enrollmentRates.get(ip) || 0;
      if (count >= enrollmentLimit || enrollmentCount >= 1000) { res.setHeader('Retry-After', '60'); end(res, 429, 'Please try again later'); return; }
      enrollmentRates.set(ip, count + 1); enrollmentCount++;
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ accessKey: deviceToken(req.headers['x-airdrop-device']) }));
      return;
    }
    if (host.split(':')[0] === domain && req.url === '/v1/control' && req.method === 'POST') {
      let id;
      try { id = identify(req); } catch { end(res, 401, 'Unauthorized'); return; }
      if (!sessions.has(id) && sessions.size >= maxDevices) { end(res, 503, 'Relay capacity reached'); return; }
      if (sessions.has(id)) { end(res, 409, 'This device is already connected'); return; }
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
      res.flushHeaders();
      req.socket.setKeepAlive(true, 15000);
      const port = server.address().port;
      const session = { id, res, jobs: new Map() };
      sessions.set(id, session);
      event(session, { type: 'ready', origin: `${tls ? 'https' : 'http'}://${id}.${domain}${port === (tls ? 443 : 80) ? '' : ':' + port}` });
      session.heartbeat = setInterval(() => event(session, { type: 'ping' }), 15000);
      res.on('close', () => closeSession(session));
      return;
    }
    if (host.split(':')[0] === domain) { end(res, req.url === '/health' ? 200 : 404, req.url === '/health' ? 'Airdrop relay ready' : 'Not found'); return; }
    const match = host.split(':')[0].match(/^([a-f0-9]{32})\.(.+)$/);
    const session = match && match[2] === domain && sessions.get(match[1]);
    if (!session) { end(res, 503, 'This Airdrop workspace is offline. Open Airdrop on your computer.'); return; }
    if (session.jobs.size >= maxRequests) { end(res, 429, 'Too many active requests'); return; }
    const id = crypto.randomBytes(24).toString('hex');
    const job = { req, res, cancel() {
      clearTimeout(job.timer); session.jobs.delete(id);
      job.upstream?.destroy(); job.socket?.destroy();
      if (!res.writableEnded) { if (!res.headersSent) end(res, 503, 'The workspace disconnected'); else res.destroy(); }
    } };
    session.jobs.set(id, job);
    job.timer = setTimeout(() => job.cancel(), connectTimeout);
    res.on('close', () => { clearTimeout(job.timer); session.jobs.delete(id); job.upstream?.destroy(); job.socket?.destroy(); });
    event(session, { type: 'request', id });
  }
  server.on('connect', (req, socket, head) => {
    let session, job, id;
    try {
      session = sessions.get(identify(req));
      const match = req.url.match(/^\/v1\/tunnel\/([a-f0-9]{48})$/);
      id = match?.[1]; job = session?.jobs.get(id);
      if (!job || job.socket || head.length) throw Error('Unknown tunnel');
    } catch { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    clearTimeout(job.timer); job.socket = socket;
    socket.on('error', () => job.cancel());
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    const agent = new http.Agent({ keepAlive: false });
    agent.createConnection = () => socket;
    job.upstream = http.request({ host: 'tunnel', method: job.req.method, path: job.req.url, headers: proxyHeaders(job.req.headers), agent }, incoming => {
      job.res.writeHead(incoming.statusCode, proxyHeaders(incoming.headers));
      incoming.on('error', () => job.res.destroy());
      incoming.pipe(job.res);
    });
    job.upstream.on('error', () => job.cancel());
    job.req.on('aborted', () => job.cancel());
    job.req.pipe(job.upstream);
  });
  server.on('upgrade', (req, socket) => socket.end('HTTP/1.1 501 Not Implemented\r\nConnection: close\r\n\r\n'));
  server.on('clientError', (error, socket) => socket.destroy());
  return {
    server,
    async close() {
      for (const session of [...sessions.values()]) closeSession(session);
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  };
}
module.exports = { createRelay };
