'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
test('CI annotations preserve the command failure and final error after long source logs',async()=>{
 await assert.rejects(run('bash',['scripts/ci-command.sh','Source-test',process.execPath,'-e','console.log("x".repeat(9000));console.log("actual source build error");process.exit(23)']),error=>{
  assert.equal(error.code,23);
  const annotation=error.stdout.split('\n').find(line=>line.startsWith('::error title=Source-test::'));
  assert.ok(annotation.includes('actual source build error'));
  assert.ok(annotation.length<3500);
  return true;
 });
});
