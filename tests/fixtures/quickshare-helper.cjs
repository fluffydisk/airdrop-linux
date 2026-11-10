'use strict';
// IPC fixture only; does not implement or claim Android protocol compatibility.
const readline = require('node:readline');
let decision;
function output(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line); let result = {};
  if (request.method === 'hello') result = { protocol: 1, capabilities: { lan: true, ble: false, direct: false, resume: false } };
  if (request.method === 'respond') { decision = request.params; result = { accepted: true }; }
  if (request.method === 'decision') result = decision || {};
  output({ v: 1, id: request.id, result });
  if (request.method === 'fixture') output({ v: 1, event: 'transfer', data: request.params });
  if (request.method === 'crash') process.exit(1);
});
