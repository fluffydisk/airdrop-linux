'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const preferences = require('../desktop/update-preferences');
const updater = require('../lib/updater');
const { JSDOM } = require('jsdom');
test('automatic checks honor persisted opt-out, corrupt preferences, transfers and retry interval', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'update-preferences-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  assert.deepEqual(await preferences.read(directory), { automatic: true });
  await preferences.write(directory, false);
  assert.deepEqual(await preferences.read(directory), { automatic: false });
  await assert.rejects(preferences.write(directory, 'true'), /Invalid/);
  await fs.writeFile(path.join(directory, 'updates.json'), '{broken');
  assert.deepEqual(await preferences.read(directory), { automatic: false });
  for (const overrides of [{ automatic: false }, { busy: true }, { sending: true }, { lastAttempt: 100 }]) {
    assert.equal(preferences.due({ automatic: true, now: preferences.INTERVAL, ...overrides }), false);
  }
  assert.equal(preferences.due({ automatic: true, now: preferences.INTERVAL }), true);
});
test('managed discovery uses stable release metadata without claiming a package is installable', async () => {
  let calls = 0;
  const release = { tag_name: 'v1.7.0', body: 'Release notes <script>bad()</script>', assets: [] };
  const fetcher = async () => { calls++; return Response.json(release); };
  const result = await updater.check('1.6.8', { fetcher, metadataOnly: true });
  assert.equal(calls, 1); assert.equal(result.status, 'available');
  assert.equal(result.package, undefined); assert.match(result.message, /package manager/);
  assert.equal(result.releaseUrl, 'https://github.com/fluffydisk/airdrop-linux/releases/tag/v1.7.0');
  release.prerelease = true;
  assert.equal((await updater.check('1.6.8', { fetcher, metadataOnly: true })).status, 'current');
  release.prerelease = false; release.tag_name = '1.7.0';
  await assert.rejects(updater.check('1.6.8', { fetcher, metadataOnly: true }), /tag/);
});
test('update view distinguishes package-manager instructions, downloads, recovery and restart', async () => {
  const dom = new JSDOM(await fs.readFile('desktop/index.html', 'utf8'), { runScripts: 'outside-only', url: 'https://local.test' });
  const { window } = dom; let publish, action;
  window.airdrop = { onStatus() {}, status: async () => ({label:'Ready',status:'ready'}), settings:async()=>({}), explore:async()=>[], onShowFiles(){}, onUpdate(fn){publish=fn;}, update: async value => { action=value; return undefined; } };
  window.eval(await fs.readFile('ui/explorer.js','utf8'));
  window.eval(await fs.readFile('desktop/renderer.js','utf8'));
  const get = id => window.document.getElementById(id);
  try {
    publish({status:'available',current:'1.6.8',version:'1.7.0',distribution:'apt',managed:true,instructions:'sudo apt update',notes:'<img src=x onerror=bad()>',automatic:false});
    assert.equal(get('installUpdate').hidden,true);assert.equal(get('copyUpdateInstructions').hidden,false);
    assert.equal(get('updateNotes').children.length,0);assert.match(get('updateNotes').textContent,/<img/);
    assert.equal(get('automaticUpdates').checked,false);
    await get('copyUpdateInstructions').onclick();assert.equal(action,'copy-instructions');
    publish({status:'available',distribution:'appimage',version:'1.7.0'});
    assert.equal(get('installUpdate').textContent,'Download AppImage');assert.equal(get('portableNote').hidden,false);
    publish({status:'downloading',distribution:'script',progress:37});
    assert.equal(get('updateProgress').value,37);assert.equal(get('checkUpdate').disabled,true);
    publish({status:'recovery',distribution:'script'});
    await get('installUpdate').onclick();assert.equal(action,'recover');assert.equal(get('checkUpdate').disabled,true);
    publish({status:'updated',distribution:'flatpak'});
    get('installUpdate').textContent='Translated label';await get('installUpdate').onclick();assert.equal(action,'finish');
  } finally { window.close(); }
});
