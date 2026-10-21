#!/usr/bin/env node
'use strict';
// Runs only in the explicitly selected environment. Never opens an upstream PR.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {execFile} = require('node:child_process');
const run = require('node:util').promisify(execFile);

async function main() {
  const fork = process.env.FLATHUB_FORK;
  if (!process.env.GH_TOKEN) throw new Error('Missing FLATHUB_TOKEN environment secret');
  if (!/^[A-Za-z0-9_.-]+\/flathub$/.test(fork || '') || fork.toLowerCase() === 'flathub/flathub') {
    throw new Error('FLATHUB_FORK must identify your own owner/flathub fork');
  }
  async function api(endpoint, options = {}) {
    const response = await fetch('https://api.github.com/' + endpoint, {
      ...options,
      headers: {Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'},
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`GitHub ${options.method || 'GET'} ${endpoint}: HTTP ${response.status}`);
    return response.json();
  }
  const repo = await api(`repos/${fork}`);
  if (!repo.fork || repo.parent?.full_name !== 'flathub/flathub') throw new Error('Configured repository is not a fork of flathub/flathub');
  const base = await api('repos/flathub/flathub/git/ref/heads/new-pr');
  const branches = await api(`repos/${fork}/branches?per_page=100`);
  if (!branches.some(branch => branch.name === 'new-pr')) {
    await api(`repos/${fork}/git/refs`, {method: 'POST', body: JSON.stringify({ref: 'refs/heads/new-pr', sha: base.object.sha})});
    console.log('Created the missing new-pr base branch in the configured fork.');
  }
  await run('gh', ['auth', 'setup-git']);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'airdrop-flathub-access-'));
  const probe = `codex-access-check-${process.env.GITHUB_RUN_ID || Date.now()}-${process.env.GITHUB_RUN_ATTEMPT || '1'}`;
  let pushed = false;
  try {
    await run('git', ['clone', '--depth=1', '--branch=new-pr', `https://github.com/${fork}.git`, directory]);
    // Push the existing base commit, containing no application or submission files.
    pushed = true;
    await run('git', ['push', 'origin', `HEAD:refs/heads/${probe}`], {cwd: directory});
    await run('git', ['push', 'origin', '--delete', probe], {cwd: directory});
    pushed = false;
    console.log('FLATHUB_TOKEN and FLATHUB_FORK resolved successfully; real Git push and deletion succeeded.');
    console.log('Upstream new-pr is readable. A fork-only fine-grained PAT does not grant upstream PR creation. No PR was attempted.');
    if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
      `### Flathub access check (no submission)\n\nFork: \`${fork}\`\n\nEnvironment bindings and real Git push/delete verified. The temporary branch was removed. No application files were pushed and no upstream PR was attempted.\n\nA fork-only fine-grained PAT cannot authorize upstream PR creation. The final submission must be created manually through GitHub after the documented policy blockers are resolved.\n`);
  } finally {
    try { if (pushed) await run('git', ['push', 'origin', '--delete', probe], {cwd: directory}); }
    finally { await fs.rm(directory, {recursive: true, force: true}); }
  }
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
