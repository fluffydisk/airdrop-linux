'use strict';
const { getPaths } = require('./lib/paths');
require('dotenv').config({ path: process.env.AIRDROP_ENV_FILE || getPaths().env });
const express = require('express');
const webpush = require('web-push');
const fs = require('node:fs');
const path = require('node:path');
const archiver = require('archiver');
const { validName, rootDirectory, publishStream, openSharedFile } = require('./lib/files');
const { archiveName } = require('./ui/zip');

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJSON(file, data) {
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}
function validSubscription(sub) {
  try {
    if (!sub || new URL(sub.endpoint).protocol !== 'https:' || sub.endpoint.length > 4096) return false;
    return ['p256dh', 'auth'].every(key => typeof sub.keys?.[key] === 'string' && /^[A-Za-z0-9_-]+={0,2}$/.test(sub.keys[key])) &&
      Buffer.from(sub.keys.p256dh, 'base64url').length === 65 && Buffer.from(sub.keys.auth, 'base64url').length === 16;
  } catch { return false; }
}

function createServer({ watchDir = process.env.WATCH_DIR || getPaths().files,
  stateDir = process.env.AIRDROP_STATE_DIR || getPaths().pushState, sendNotification = (sub, data) => webpush.sendNotification(sub, data),
  watch = true, stableMs = 1600, logger = console, maintenanceRoot = process.env.AIRDROP_HOME || path.dirname(watchDir) } = {}) {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const subsFile = path.join(stateDir, 'subscriptions.json');
  const seenFile = path.join(stateDir, 'seen-files.json');
  const savedSubscriptions = loadJSON(subsFile, []);
  let subscriptions = Array.isArray(savedSubscriptions) ? savedSubscriptions.filter(validSubscription) : [];
  let queue = Promise.resolve();
  function subscribe(sub) {
    const index = subscriptions.findIndex(s => s.endpoint === sub.endpoint);
    if (index < 0) subscriptions.push(sub); else subscriptions[index] = sub;
    saveJSON(subsFile, subscriptions);
  }
  function notifyAll(payload) {
    queue = queue.then(async () => {
      for (const sub of [...subscriptions]) {
        try { await sendNotification(sub, JSON.stringify(payload)); }
        catch (error) {
          if ([404, 410].includes(error.statusCode)) {
            // A subscription refreshed during the request must not be discarded.
            subscriptions = subscriptions.filter(current => current !== sub);
            saveJSON(subsFile, subscriptions);
          } else logger.warn('Temporary push failure:', error.statusCode || error.message);
        }
      }
    }).catch(error => logger.error('Push dispatch failed:', error.message));
    return queue;
  }
  let seen = Object.create(null);
  const pending = new Map();
  function snapshot() {
    const files = Object.create(null);
    if (!fs.existsSync(watchDir)) return files;
    function walk(directory, prefix = '') {
      const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      try {
        const anchored = `/proc/self/fd/${fd}`;
        for (const entry of fs.readdirSync(anchored, { withFileTypes: true })) {
          if (!validName(entry.name) || entry.isSymbolicLink()) continue;
          const relative = prefix ? prefix + '/' + entry.name : entry.name;
          try {
            const target = anchored + '/' + entry.name;
            const stat = fs.lstatSync(target);
            if (stat.isSymbolicLink()) continue;
            if (stat.isDirectory()) walk(target, relative);
            else if (stat.isFile()) files[relative] = { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
          } catch (error) { if (!['ENOENT', 'ELOOP', 'ENOTDIR'].includes(error.code)) logger.warn('File scan failed:', error.message); }
        }
      } finally { fs.closeSync(fd); }
    }
    walk(watchDir);
    return files;
  }
  // Baseline each startup: existing files do not generate a notification storm.
  seen = snapshot();
  saveJSON(seenFile, seen);
  function scan(now = Date.now()) {
    const current = snapshot();
    let changed = false;
    for (const name of Object.keys(seen)) {
      if (!Object.hasOwn(current, name)) { delete seen[name]; pending.delete(name); changed = true; }
    }
    for (const name of pending.keys()) if (!Object.hasOwn(current, name)) pending.delete(name);
    for (const [name, signature] of Object.entries(current)) {
      const value = JSON.stringify(signature);
      if (JSON.stringify(seen[name]) === value) { pending.delete(name); continue; }
      const candidate = pending.get(name);
      if (!candidate || candidate.value !== value) { pending.set(name, { value, since: now }); continue; }
      if (now - candidate.since < stableMs) continue;
      seen[name] = signature;
      pending.delete(name);
      changed = true;
      notifyAll({ title: 'New file received', body: name, fileName: name, size: signature.size });
    }
    if (changed) saveJSON(seenFile, seen);
  }
  const timer = watch ? setInterval(() => {
    try { scan(); } catch (error) { logger.error('File scan failed:', error.message); }
  }, 800) : null;
  const app = express();
  app.disable('x-powered-by');
  app.locals.maintenanceRoot = maintenanceRoot;
  // All browser callers use the same Tailscale origin. Reject cross-origin writes.
  app.use((req, res, next) => {
    if (req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: 'Origin not allowed' });
      } catch { return res.status(403).json({ error: 'Invalid origin' }); }
    }
    next();
  });
  app.use(async (req, res, next) => {
    if (['GET', 'HEAD'].includes(req.method)) return next();
    try {
      const release = await require('./lib/maintenance').acquire(maintenanceRoot);
      res.once('close', release); res.once('finish', release); next();
    } catch (error) { next(error); }
  });
  app.use('/explorer', require('./lib/explorer-api').router(watchDir));
  app.get('/version', (req, res) => res.json({ version: require('./package.json').version, instance: require('node:crypto').createHash('sha256').update(require('node:path').resolve(watchDir)).digest('hex') }));
  app.get('/vapid-public-key', (req, res) => res.send(process.env.VAPID_PUBLIC_KEY || ''));
  app.get('/health', async (req, res) => {
    try {
      await rootDirectory(watchDir);
      await fs.promises.access(watchDir, fs.constants.R_OK | fs.constants.W_OK);
      res.json({ push: true, share: true });
    } catch { res.status(503).json({ push: true, share: false }); }
  });
  app.post('/subscribe', express.json({ limit: '16kb' }), (req, res) => {
    if (!validSubscription(req.body)) return res.status(400).json({ error: 'Invalid push subscription' });
    subscribe(req.body);
    res.status(201).json({ ok: true });
  });
  app.put('/files/:name', async (req, res, next) => {
    try { res.status(201).json(await publishStream(watchDir, req.params.name, req)); }
    catch (error) { next(error); }
  });
  app.post('/archive', express.json({ limit: '64kb' }), express.urlencoded({ extended: false, limit: '64kb' }), async (req, res, next) => {
    const handles = [];
    let archive;
    const streams = [];
    try {
      const names = req.is('application/x-www-form-urlencoded') ? JSON.parse(req.body?.files || 'null') : req.body?.files;
      if (!Array.isArray(names) || !names.length || names.length > 1000 || !names.every(validName) || new Set(names).size !== names.length) {
        throw Object.assign(new Error('Select 1–1000 unique, shareable files'), { status: 400 });
      }
      for (const name of names) handles.push(await openSharedFile(watchDir, name));
      if (req.body.validateOnly === true) return res.json({ ok: true });
      archive = archiver('zip', { store: true });
      archive.on('error', error => res.destroy(error));
      archive.on('warning', error => res.destroy(error));
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${archiveName()}"`);
      const completed = new Promise((resolve, reject) => {
        res.on('finish', resolve);
        res.on('close', resolve);
        res.on('error', reject);
      });
      res.on('close', () => archive.abort());
      archive.pipe(res);
      handles.forEach((handle, i) => {
        const stream = handle.createReadStream({ autoClose: false });
        stream.on('error', error => res.destroy(error));
        streams.push(stream);
        archive.append(stream, { name: names[i] });
      });
      archive.finalize().catch(error => res.destroy(error));
      await completed;
    } catch (error) {
      if (res.headersSent) res.destroy(error); else next(error);
    } finally {
      if (archive) archive.abort();
      streams.forEach(stream => stream.destroy());
      await Promise.all(handles.map(handle => handle.close().catch(() => {})));
    }
  });
  app.use((error, req, res, next) => {
    if (res.headersSent || res.destroyed) return;
    const status = error.status || (error instanceof SyntaxError ? 400 : error.code === 'ENOSPC' ? 507 : 500);
    if (status >= 500) logger.error(error.message);
    res.status(status).json({ error: status >= 500 ? 'File operation failed' : error.message });
  });
  return { app, scan, notifyAll, subscribe, close: () => clearInterval(timer),
    getSubscriptions: () => [...subscriptions], idle: () => queue };
}
if (require.main === module) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are required. See .env.example.');
    process.exit(1);
  }
  webpush.setVapidDetails(process.env.VAPID_CONTACT_EMAIL || 'mailto:example@example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const service = createServer();
  const { createGateway } = require('./lib/gateway');
  const gateway = createGateway({ api: service.app, uiDir: process.env.AIRDROP_UI_DIR || getPaths().ui });
  const server = gateway.listen(process.env.PORT || 6001, '127.0.0.1', () => console.log('Airdrop API listening on localhost'));
  function shutdown() { service.close(); server.close(); }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
module.exports = { createServer, validSubscription };
