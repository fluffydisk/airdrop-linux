#!/usr/bin/env node
'use strict';
const { createInterface } = require('node:readline/promises');
const { sendFiles } = require('../lib/transfer');
async function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'setup') {
    if (args.slice(1).some(arg => arg !== '--migrate')) throw new Error('Usage: airdrop setup [--migrate]');
    console.log(await require('../lib/manage').setup({migrate:args.includes('--migrate')})); return;
  }
  if (args[0] === 'uninstall') {
    if (args.slice(1).some(arg => !['--yes','--delete-data'].includes(arg))) throw new Error('Usage: airdrop uninstall [--yes] [--delete-data]');
    let deleteData = args.includes('--delete-data');
    if (!args.includes('--yes')) {
      if (!process.stdin.isTTY) throw new Error('Use --yes for noninteractive uninstall; data is preserved unless --delete-data is supplied.');
      const prompt = createInterface({input:process.stdin,output:process.stdout});
      try {
        if (!/^(y|yes)$/i.test(await prompt.question('Uninstall Airdrop? [y/N] '))) return;
        if (!deleteData) deleteData = /^(y|yes)$/i.test(await prompt.question('Delete shared files, settings, keys and backups too? [y/N] '));
      } finally { prompt.close(); }
    }
    console.log(await require('../lib/manage').uninstall({deleteData})); return;
  }
  const zip = args[0] === '--zip';
  if (zip) args.shift();
  if (args[0] === '--') args.shift();
  if (!args.length || args[0] === '--help') {
    console.log('Usage: airdrop [--zip] [--] <file...> | setup [--migrate] | uninstall [--yes] [--delete-data]');
    process.exitCode = args.length ? 0 : 2;
    return;
  }
  const results = await sendFiles(process.env.WATCH_DIR || require('../lib/paths').getPaths().files, args, zip);
  for (const result of results) {
    if (result.ok) console.log(`Shared: ${result.name}`);
    else { console.error(`${result.name}: ${result.error}`); process.exitCode = 1; }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
