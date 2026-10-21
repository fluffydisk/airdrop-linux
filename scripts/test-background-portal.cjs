'use strict';
// Run under dbus-run-session; emulate the portal's directed response, not stdout.
const assert = require('node:assert/strict');
const {spawn, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const path = require('node:path');
const run = promisify(execFile);
(async () => {
  const helper = process.argv[2];
  assert.ok(helper, 'Pass the compiled background portal helper');
  for (const grant of [true, false]) {
    const fixture = spawn('/usr/bin/python3', [path.join(__dirname, '../tests/fixtures/background-portal.py')], {env:{...process.env, GRANT:grant ? '1' : '0'}, stdio:['ignore','pipe','inherit']});
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Portal fixture startup timeout')), 5000);
        fixture.stdout.on('data', chunk => { if (chunk.toString().includes('READY')) { clearTimeout(timer); resolve(); } });
        fixture.once('error', error => { clearTimeout(timer); reject(error); });
        fixture.once('exit', () => { clearTimeout(timer); reject(new Error('Portal fixture exited')); });
      });
      const result = await run(helper, [], {timeout:5000});
      assert.equal(result.stdout.trim(), grant ? 'granted' : 'denied');
    } finally {
      fixture.kill();
      if (fixture.exitCode === null && !fixture.signalCode) await new Promise(resolve => fixture.once('exit', resolve));
    }
  }
  const absent = await run(helper, [], {timeout:5000});
  assert.equal(absent.stdout.trim(), 'denied');
  console.log('Real D-Bus portal: directed grant, denial, returned request path and missing portal passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
