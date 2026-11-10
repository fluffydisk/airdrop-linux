'use strict';
// Same implementation on both ends: actual wire/IPC regression evidence, not
// Android interoperability. Requires disposable-VM namespace privileges.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { createInterface } = require('node:readline');

function peer(namespace, helper) {
  const child = spawn('ip', ['netns', 'exec', namespace, helper], { stdio: ['pipe', 'pipe', 'pipe'] });
  const requests = new Map(), recipients = new Map(), transfers = new Map();
  let sequence = 0, failure;
  function fail() {
    failure = Error('Native protocol helper stopped or returned malformed IPC');
    for (const pending of requests.values()) { clearTimeout(pending.timer); pending.reject(failure); }
    requests.clear();
  }
  child.stderr.on('data', () => {}); // Codes/payloads must never enter test logs.
  child.stdin.on('error', fail); child.once('error', fail); child.once('exit', fail);
  createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', line => {
    try {
      assert.ok(Buffer.byteLength(line) <= 4 * 1024 * 1024);
      const value = JSON.parse(line); assert.equal(value.v, 1);
      if (value.id) {
        const pending = requests.get(value.id); if (!pending) return;
        clearTimeout(pending.timer); requests.delete(value.id);
        if (value.error) pending.reject(Error('Native protocol command failed'));
        else pending.resolve(value.result);
      } else if (value.event === 'recipient') {
        if (value.data.present) recipients.set(value.data.id, value.data); else recipients.delete(value.data.id);
      } else if (value.event === 'transfer') transfers.set(value.data.id, value.data);
      else fail();
    } catch { fail(); }
  });
  return {
    child, recipients, transfers,
    check() { if (failure) throw failure; },
    request(method, params = {}) {
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        const id = String(++sequence);
        const timer = setTimeout(() => { requests.delete(id); reject(Error('Native command timed out')); }, 10000);
        requests.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ v: 1, id, method, params }) + '\n');
      });
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      let timer;
      const closed = new Promise(resolve => child.once('exit', resolve));
      child.stdin.end();
      await Promise.race([closed, new Promise(resolve => { timer = setTimeout(resolve, 7000); })]);
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed;
    }
  };
}
async function until(check, peers, stage = 'native protocol state') {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    for (const p of peers) p.check();
    const result = check(); if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const states = peers.map(p => [...p.transfers.values()].map(({ direction, phase, bytes, total }) => ({ direction, phase, bytes, total })));
  throw Error(`Timed out waiting for ${stage}: ${JSON.stringify(states)}`);
}

test('native helpers discover, compare codes and exchange binary/empty/unicode files across independent network namespaces', { timeout: 120000 }, async t => {
  assert.equal(process.getuid(), 0, 'Use a disposable VM with namespace privileges');
  const helper = process.env.AIRDROP_TEST_QUICKSHARE_HELPER; assert.ok(helper);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'quickshare-wire-'));
  const prefix = 'qsw' + process.pid, namespaces = [prefix + '-a', prefix + '-b'], peers = [];
  t.after(async () => {
    await Promise.all(peers.map(p => p.stop()));
    for (const namespace of namespaces) { try { execFileSync('ip', ['netns', 'del', namespace], { stdio: 'ignore' }); } catch {} }
    await fs.rm(directory, { recursive: true, force: true });
  });
  for (const namespace of namespaces) {
    execFileSync('ip', ['netns', 'add', namespace]);
    execFileSync('ip', ['-n', namespace, 'link', 'set', 'lo', 'up']);
  }
  execFileSync('ip', ['link', 'add', prefix + 'a', 'type', 'veth', 'peer', 'name', prefix + 'b']);
  for (const [index, namespace] of namespaces.entries()) {
    const link = prefix + (index ? 'b' : 'a');
    execFileSync('ip', ['link', 'set', link, 'netns', namespace]);
    execFileSync('ip', ['-n', namespace, 'link', 'set', link, 'name', 'eth0']);
    execFileSync('ip', ['-n', namespace, 'address', 'add', `10.78.1.${index + 2}/24`, 'dev', 'eth0']);
    execFileSync('ip', ['-n', namespace, 'link', 'set', 'eth0', 'up']);
    execFileSync('ip', ['-n', namespace, 'route', 'add', '224.0.0.0/4', 'dev', 'eth0']);
    const p = peer(namespace, helper); peers.push(p);
    await p.request('hello');
    await p.request('start', { name: 'wire-peer-' + index, staging: path.join(directory, String(index)) });
  }
  const data = new Map([['binary.dat', crypto.randomBytes(2 * 1024 * 1024 + 17)], ['empty.txt', Buffer.alloc(0)], ['café.txt', Buffer.from('wire fixture\n')]]);
  const sources = [];
  for (const [name, bytes] of data) { const file = path.join(directory, name); await fs.writeFile(file, bytes); sources.push(file); }
  for (const [sender, receiver] of [[peers[0], peers[1]], [peers[1], peers[0]]]) {
    const otherName = 'wire-peer-' + (receiver === peers[0] ? 0 : 1);
    const recipient = await until(() => [...sender.recipients.values()].find(d => d.name === otherName), peers, 'recipient discovery');
    const transferId = crypto.randomUUID();
    await sender.request('send', { recipientId: recipient.id, files: sources, transferId });
    const incoming = await until(() => [...receiver.transfers.values()].find(s => s.direction === 'incoming' && s.phase === 'awaiting-acceptance'), peers);
    const outgoing = await until(() => sender.transfers.get(transferId)?.pinCode && sender.transfers.get(transferId), peers);
    // Deliberately avoid assert.equal: a failure must not print verification codes.
    assert.ok(/^\d{4}$/.test(incoming.pinCode) && incoming.pinCode === outgoing.pinCode, 'Both endpoints must derive the same fresh comparison code');
    for (const file of incoming.stagedPaths || []) await assert.rejects(fs.stat(file), { code: 'ENOENT' });
    await receiver.request('respond', { transferId: incoming.id, accept: true });
    const complete = await until(() => receiver.transfers.get(incoming.id)?.phase === 'complete' && receiver.transfers.get(incoming.id), peers, 'receiver completion');
    assert.equal(complete.stagedPaths.length, data.size);
    for (const file of complete.stagedPaths) {
      const bytes = await fs.readFile(file), expected = data.get(path.basename(file)); assert.ok(expected);
      const hash = value => crypto.createHash('sha256').update(value).digest('hex');
      assert.equal(hash(bytes), hash(expected));
    }
    await until(() => sender.transfers.get(transferId)?.phase === 'complete', peers);
  }
});
