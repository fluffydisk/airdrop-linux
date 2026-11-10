'use strict';
// Guest requests terminate here: never proxy them to the workspace API.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { publishStream, openSharedFile, validName } = require('./files');
const MAX_FILE = 100 * 1024 * 1024, MAX_TOTAL = 1024 * 1024 * 1024;
class GuestShare {
  constructor(root) { this.root = root; this.session = null; }
  async start(sources = [], { allowUploads = true } = {}) {
    if (!this.root) throw Error('Guest sharing is unavailable');
    if (!Array.isArray(sources) || sources.length > 100) throw Error('Choose up to 100 files');
    if (typeof allowUploads !== 'boolean') throw Error('Invalid upload permission');
    const files = [];
    try {
      for (const source of sources) {
        const name = path.basename(source);
        if (!validName(name)) throw Error('Choose regular, shareable files');
        const handle = await openSharedFile(path.dirname(source), name);
        files.push({ id: crypto.randomBytes(16).toString('hex'), name, size: (await handle.stat()).size, handle });
      }
      await this.close();
      await fs.promises.mkdir(this.root, { recursive: true });
      // A fresh inbox prevents overwrite and grants no access to previous uploads.
      const inbox = await fs.promises.mkdtemp(path.join(this.root, 'Guest uploads-'));
      const session = this.session = { token: crypto.randomBytes(32).toString('base64url'), files, inbox, allowUploads, expires: Date.now() + 600000, streams: new Set(), active: 0, bytes: 0, count: 0 };
      this.timer = setTimeout(() => this.close().catch(() => {}), 600000); this.timer.unref();
      return { token: session.token, expires: session.expires, allowUploads, files: files.map(({id,name,size}) => ({id,name,size})) };
    } catch (error) { await Promise.all(files.map(f => f.handle.close().catch(() => {}))); throw error; }
  }
  async close() {
    clearTimeout(this.timer);
    const session = this.session; this.session = null;
    if (!session) return;
    for (const stream of session.streams) stream.destroy();
    await Promise.all(session.files.map(f => f.handle.close().catch(() => {})));
  }
  async handle(req, res, origin, secure) {
    const reply = (status, value) => { res.writeHead(status, {'Content-Type':'application/json'}); res.end(JSON.stringify(value)); };
    const pathname = req.url.split('?')[0];
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (req.method === 'GET' && ['/guest/', '/guest/app.js', '/guest/style.css'].includes(req.url)) {
      const name = req.url === '/guest/' ? 'guest.html' : req.url.endsWith('.js') ? 'guest.js' : 'guest.css';
      res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.js') ? 'text/javascript' : 'text/css');
      res.end(await fs.promises.readFile(path.join(__dirname, '../ui', name))); return;
    }
    const s = this.session;
    const cookie = (req.headers.cookie || '').split(';').map(v=>v.trim()).find(v=>v.startsWith('airdrop_guest='))?.slice(14);
    const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : cookie;
    if (!s || s.expires <= Date.now() || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || token.length !== s.token.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(s.token))) return reply(403, {error:'This guest session expired. Scan a new QR code.'});
    if ((req.headers.origin && req.headers.origin !== origin) || (!['GET','HEAD'].includes(req.method) && req.headers.origin !== origin)) return reply(403, {error:'Invalid origin'});
    if (pathname === '/guest/session' && req.method === 'POST') {
      res.setHeader('Set-Cookie', 'airdrop_guest='+s.token+'; HttpOnly; SameSite=Strict; Path=/guest/; Max-Age=600'+(secure?'; Secure':''));
      return reply(200, {expires:s.expires, allowUploads:s.allowUploads, files:s.files.map(({id,name,size})=>({id,name,size}))});
    }
    if (pathname.startsWith('/guest/download/') && req.method === 'GET' && !req.url.includes('?')) {
      const file = s.files.find(f=>f.id === pathname.slice('/guest/download/'.length));
      if (!file) return reply(404,{error:'File unavailable'});
      res.writeHead(200, {'Content-Type':'application/octet-stream', 'Content-Length':file.size, 'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(file.name)});
      if (!file.size) return res.end();
      const stream = file.handle.createReadStream({start:0,end:file.size-1,autoClose:false});
      s.streams.add(res); s.streams.add(stream); stream.on('error',()=>res.destroy()); res.on('close',()=>{stream.destroy();s.streams.delete(stream);s.streams.delete(res);});stream.pipe(res); return;
    }
    if (pathname === '/guest/upload' && req.method === 'PUT') {
      if (!s.allowUploads) return reply(403,{error:'This invitation only allows downloading the selected files.'});
      const url = new URL(req.url, origin), name = url.searchParams.get('name');
      if (!validName(name) || [...url.searchParams.keys()].some(k=>k!=='name')) return reply(400,{error:'Invalid file name'});
      if (s.active >= 2 || s.count >= 100 || s.bytes >= MAX_TOTAL) return reply(429,{error:'Guest upload limit reached'});
      if (Number(req.headers['content-length']) > MAX_FILE) return reply(413,{error:'Each file must be at most 100 MiB'});
      s.active++; s.count++; let size = 0;
      const limit = new Transform({transform(chunk, encoding, cb) {
        size += chunk.length; s.bytes += chunk.length;
        cb(size > MAX_FILE || s.bytes > MAX_TOTAL || s.expires <= Date.now() ? Object.assign(Error('Upload limit reached'),{status:413}) : null, chunk);
      }});
      s.streams.add(limit); s.streams.add(req);
      req.on('error',error=>limit.destroy(error)); req.pipe(limit);
      try { const file = await publishStream(s.inbox, name, limit); if (!res.destroyed) reply(201,{name:file.name,size:file.size}); }
      catch (error) { if (!res.destroyed) reply(error.status || 400,{error:'Upload failed. Maximum file size is 100 MiB.'}); }
      finally { req.unpipe(limit);s.active--;s.streams.delete(limit);s.streams.delete(req); }
      return;
    }
    reply(404,{error:'Guest operation unavailable'});
  }
}
module.exports = { GuestShare };
