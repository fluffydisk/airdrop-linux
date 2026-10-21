'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const JSZip = require('jszip');

test('managed Snap CLI forwards help, exit status, file arguments and ZIP options', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airdrop-managed-cli-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  const code = path.join(root, 'code');
  const server = path.join(code, 'server');
  await fs.mkdir(path.join(server, 'scripts'), {recursive:true});
  await fs.copyFile(path.resolve('scripts/managed-runtime.js'), path.join(server, 'scripts/managed-runtime.js'));
  await fs.copyFile(path.resolve('package.json'), path.join(server, 'package.json'));
  for (const directory of ['bin', 'lib']) await fs.symlink(path.resolve(directory), path.join(server, directory));
  await fs.writeFile(path.join(code, 'distribution.json'), JSON.stringify({source:'snap'}));
  const common = path.join(root, 'snap-common');
  const share = path.join(common, 'airdrop/files');
  const run = args => spawnSync(process.execPath, [path.join(server, 'scripts/managed-runtime.js'), 'cli', ...args], {
    cwd:root, encoding:'utf8', timeout:10000,
    env:{...process.env, SNAP_USER_COMMON:common, WATCH_DIR:share}
  });
  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: airdrop/);
  const usage = run([]);
  assert.equal(usage.status, 2, usage.stderr);
  assert.match(usage.stdout, /Usage: airdrop/);
  await assert.rejects(fs.access(common), {code:'ENOENT'});

  await fs.mkdir(share, {recursive:true});
  const source = path.join(root, 'file with spaces.txt');
  await fs.writeFile(source, 'forwarded payload');
  const sent = run(['--', source]);
  assert.equal(sent.status, 0, sent.stderr);
  assert.equal(await fs.readFile(path.join(share, path.basename(source)), 'utf8'), 'forwarded payload');
  const zipped = run(['--zip', '--', source]);
  assert.equal(zipped.status, 0, zipped.stderr);
  const archive = (await fs.readdir(share)).find(name => name.endsWith('.zip'));
  assert.ok(archive);
  const zip = await JSZip.loadAsync(await fs.readFile(path.join(share, archive)));
  assert.equal(await zip.file(path.basename(source)).async('string'), 'forwarded payload');
});
