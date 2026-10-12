#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { sendFiles } = require('../lib/transfer');
async function main() {
  const args = process.argv.slice(2);
  const zip = args[0] === '--zip';
  if (zip) args.shift();
  if (args[0] === '--') args.shift();
  if (!args.length || args[0] === '--help') {
    console.log('Usage: airdrop [--zip] [--] <file...>');
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
