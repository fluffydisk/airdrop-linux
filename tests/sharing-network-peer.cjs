'use strict';
// Used only inside the disposable namespace harness. Its relay is a simulated
// permitted internet route, not evidence of Cloudflare or school deployment.
const fs = require('node:fs/promises'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { Nearby } = require('../lib/nearby');
const { ShareGateway } = require('../lib/device-share');
const { hash } = require('../lib/peer-store');
const [mode, root] = process.argv.slice(2);
async function until(check) {
  const deadline = Date.now() + 15000;
  while (!await check()) { if (Date.now() > deadline) throw Error('Timed out: ' + mode); await new Promise(r => setTimeout(r, 100)); }
}
async function run() {
  await fs.mkdir(root, { recursive: true });
  if (mode === 'server') {
    const peer = await new Nearby({ directory: path.join(root, 'receiver'), inbox: path.join(root, 'inbox'), name: 'Namespace receiver', approve: async () => true }).initialize();
    const source = path.join(root, 'invited.txt'); await fs.writeFile(source, 'only explicitly invited content');
    const gateway = new ShareGateway({ guestRoot: root }); await gateway.listen('10.77.3.2');
    gateway.setOrigin('http://10.77.4.1:41000');
    const invitation = await gateway.guest.start([source], { allowUploads: false });
    await fs.writeFile(path.join(root, 'server.json'), JSON.stringify({ id: peer.id, port: peer.port, gatewayPort: gateway.server.address().port,
      url: gateway.origin + '/guest/#' + invitation.token, file: invitation.files[0] }));
    process.once('SIGTERM', async () => { await peer.stop(); await gateway.close(); process.exit(0); });
    return;
  }
  const server = JSON.parse(await fs.readFile(path.join(root, 'server.json')));
  if (mode === 'relay') {
    http.createServer((req, res) => {
      const upstream = http.request({ hostname: '10.77.3.2', port: server.gatewayPort, path: req.url, method: req.method, headers: req.headers }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      });
      upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
    }).listen(41000, '10.77.4.1', () => fs.writeFile(path.join(root, 'relay-ready'), 'ready'));
    return;
  }
  const peer = await new Nearby({ directory: path.join(root, 'sender'), inbox: path.join(root, 'sender-inbox'), name: 'Namespace sender', approve: async () => true }).initialize();
  try {
    if (mode === 'isolated') {
      await peer.refresh(); assert.equal(peer.peers.get(server.id)?.online, false);
      await assert.rejects(peer.send(server.id, []), /offline/i);
      const url = new URL(server.url), headers = { Authorization: 'Bearer ' + url.hash.slice(1), Origin: url.origin };
      const response = await fetch(url.origin + '/guest/session', { method: 'POST', headers }); assert.equal(response.status, 200);
      const session = await response.json(); assert.equal(session.allowUploads, false);
      const content = await (await fetch(url.origin + '/guest/download/' + session.files[0].id, { headers })).text();
      assert.equal(content, 'only explicitly invited content');
      assert.equal((await fetch(url.origin + '/push/health', { headers })).status, 401);
      assert.equal((await fetch(url.origin + '/guest/upload?name=no', { method: 'PUT', headers, body: 'no' })).status, 403);
    } else {
      try { await until(async () => { await peer.refresh(); return peer.peers.get(server.id)?.online; }); }
      catch (error) { console.error('Discovery diagnostics:', JSON.stringify(await peer.snapshot())); throw error; }
      if (mode === 'normal') await peer.pair(server.id);
      else assert.ok(peer.settings.trusted[server.id]?.endpoint, 'cached endpoint survives a restart without multicast');
      const source = path.join(root, mode + '.txt'), content = Buffer.from('independent namespace transfer: ' + mode);
      await fs.writeFile(source, content);
      const result = await peer.send(server.id, [source]); assert.equal(result.status, 'complete', result.error);
      assert.equal(hash(await fs.readFile(path.join(root, 'inbox', mode + '.txt'))), hash(content));
    }
    console.log('PASS ' + mode);
  } finally { await peer.stop(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
