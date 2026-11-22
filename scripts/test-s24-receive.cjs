#!/usr/bin/env node
'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const readline = require('node:readline/promises');
const { QuickShare } = require('../lib/sharing/quickshare');

async function main() {
  const build = path.resolve(__dirname, '../.cache/quickshare', process.arch);
  const receipt = JSON.parse(await fs.readFile(path.join(build, 'helper.json'), 'utf8'));
  if (!receipt.capabilities.radioLanUpgrade) throw Error('Önce node scripts/build-quickshare.js --ble-native çalıştır.');
  const root = await fs.mkdtemp(path.join(os.homedir(), 'airdrop-s24-'));
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  const inbox = path.join(root, 'Received');
  const transfers = new Map();
  const start = performance.now();
  const elapsed = () => Math.round(performance.now() - start);
  function transfer(id) {
    if (!transfers.has(id)) transfers.set(id, { events: [], bytes: 0 });
    return transfers.get(id);
  }
  let pendingPrompt = false;
  const adapter = new QuickShare({
    enabled: true, bleNative: true, classicReceive: !process.argv.includes('--ble-only'),
    protocolDiagnostics: true, helper: path.join(build, 'airdrop-quickshare'), sha256: receipt.sha256,
    directory: path.join(root, 'session'), inbox, name: 'Linux Quick Share Test', port: 0,
    approve: async ({ id, code, files, total, signal }) => {
      if (pendingPrompt) return false;
      pendingPrompt = true;
      try {
        console.log(files.length + ' dosya, ' + total + ' bayt. Telefondaki kodu karşılaştır.');
        const answer = await input.question('Kabul etmek için telefondaki ' + code.length + ' haneli kodu gir: ', { signal });
        const accepted = answer.trim() === code;
        transfer(id).events.push({ ms: elapsed(), stage: accepted ? 'accepted' : 'declined' });
        return accepted;
      } finally { pendingPrompt = false; }
    }
  });
  adapter.on('connection', ({ id, connectionMethod }) => transfer(id).events.push({ ms: elapsed(), route: connectionMethod }));
  adapter.on('session-diagnostic', ({ id, stage }) => {
    if (stage.startsWith('bwu-') || stage === 'encrypted-file-frame-received') transfer(id).events.push({ ms: elapsed(), stage });
  });
  adapter.on('progress', ({ id, phase, bytes, total }) => {
    const record = transfer(id);
    if (bytes > 0 && !record.bytes) record.firstFileBytesMs = elapsed();
    if (record.phase !== phase) console.log(phase, bytes || 0, '/', total || 0);
    Object.assign(record, { phase, bytes: bytes || 0, total, lastUpdateMs: elapsed() });
  });
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  input.once('SIGINT', finish);
  process.once('SIGINT', finish);
  try {
    await adapter.start('receive');
    console.log('S24+ üzerinden Linux Quick Share Test alıcısına dosyaları gönder. Bitirmek ve raporu kaydetmek için Ctrl+C.');
    const timer = setTimeout(finish, 240000);
    try { await done; } finally { clearTimeout(timer); }
  } finally {
    input.close();
    process.removeListener('SIGINT', finish);
    await adapter.stop();
    const files = [];
    for (const entry of await fs.readdir(inbox, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile()) continue;
      const hash = createHash('sha256'); let bytes = 0;
      for await (const chunk of createReadStream(path.join(inbox, entry.name))) { hash.update(chunk); bytes += chunk.length; }
      files.push({ bytes, sha256: hash.digest('hex') });
    }
    const report = path.join(root, 'report.json');
    await fs.writeFile(report, JSON.stringify({ commit: receipt.applicationCommit, dirty: receipt.dirty, classicEnabled: adapter.classicReceive, transfers: [...transfers.values()], files }, null, 2), { mode: 0o600 });
    console.log('Paylaşılacak rapor:', report);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
