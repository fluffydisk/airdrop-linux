'use strict';
// IPC fixture only; does not implement or claim Android protocol compatibility.
const readline = require('node:readline');
let decision, sent;
function output(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line); let result = {};
  if (request.method === 'hello') result = { protocol: 1, capabilities: { lan: true, ble: process.env.QUICKSHARE_IPC_FIXTURE_BLE === '1', gattBootstrap: process.env.QUICKSHARE_IPC_FIXTURE_BLE === '1', direct: false, resume: false } };
  if (request.method === 'send') { sent = request.params; result = { transferId: sent.transferId }; }
  if (request.method === 'sent') result = sent || {};
  if (request.method === 'respond') { decision = request.params; result = { accepted: true }; }
  if (request.method === 'decision') result = decision || {};
  output({ v: 1, id: request.id, result });
  if (request.method === 'fixture') output({ v: 1, event: 'transfer', data: request.params });
  if (request.method === 'fixture-recipient') output({ v: 1, event: 'recipient', data: request.params });
  if (request.method === 'crash') process.exit(1);
});
