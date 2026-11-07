'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
function verify(run, jobs, { repository, source, id }) {
  assert.match(source, /^[a-f0-9]{40}$/);
  assert.equal(String(run.id), String(id));
  assert.equal(run.repository?.full_name, repository);
  assert.equal(run.head_sha, source);
  assert.equal(run.head_branch, 'main');
  assert.equal(run.path, '.github/workflows/store-submissions.yml');
  assert.equal(run.event, 'workflow_dispatch');
  assert.equal(run.status, 'completed');
  assert.ok(['success', 'failure'].includes(run.conclusion));
  for (const name of ['snap (ubuntu-24.04, x64)', 'snap (ubuntu-24.04-arm, arm64)']) {
    const matches = jobs.filter(job => job.name === name);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].conclusion, 'success');
  }
}
if (require.main === module) {
  const { GH_REPO: repository, PRODUCER_RUN: id, RELEASE_TAG: tag } = process.env;
  assert.equal(repository, 'fluffydisk/airdrop-linux');
  assert.match(id || '', /^\d+$/); assert.match(tag || '', /^v\d+\.\d+\.\d+$/);
  const api = suffix => JSON.parse(execFileSync('gh', ['api', `repos/${repository}/${suffix}`], { encoding: 'utf8' }));
  const release = api(`releases/tags/${tag}`);
  assert.equal(release.draft, false); assert.equal(release.prerelease, false); assert.equal(release.tag_name, tag);
  const source = api(`commits/${tag}`).sha;
  verify(api(`actions/runs/${id}`), api(`actions/runs/${id}/jobs?per_page=100`).jobs, { repository, source, id });
  console.log('Verified exact stable release source and both local Snap acceptance gates:', source);
}
module.exports = { verify };
