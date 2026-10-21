'use strict';
const { spawn } = require('node:child_process');
// The helper owns a persistent D-Bus connection: portal responses are unicast.
function requestBackground({ spawnProcess = spawn, timeout = 65000, signal } = {}) {
  return new Promise(resolve => {
    let done = false, output = '';
    const child = spawnProcess('/app/bin/airdrop-background-portal', []);
    const timer = setTimeout(() => finish(false), timeout);
    function finish(granted) {
      if (done) return;
      done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      child.kill(); resolve(granted);
    }
    function abort() { finish(false); }
    signal?.addEventListener('abort', abort, { once:true });
    child.on('error', () => finish(false));
    child.on('exit', code => finish(code === 0 && output.trim() === 'granted'));
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-128); });
    child.stderr.on('data', () => {});
    if (signal?.aborted) finish(false);
  });
}
module.exports = { requestBackground };
