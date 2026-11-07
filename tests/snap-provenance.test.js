'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {verify}=require('../scripts/check-snap-producer');
test('Snap publication requires the exact stable source, trusted workflow and both tested architectures',()=>{
 const expected={repository:'fluffydisk/airdrop-linux',source:'a'.repeat(40),id:'123'};
 const run={id:123,repository:{full_name:expected.repository},head_sha:expected.source,head_branch:'main',path:'.github/workflows/store-submissions.yml',event:'workflow_dispatch',status:'completed',conclusion:'success'};
 const jobs=['snap (ubuntu-24.04, x64)','snap (ubuntu-24.04-arm, arm64)'].map(name=>({name,conclusion:'success'}));
 verify(run,jobs,expected);
 for(const changed of [{head_sha:'b'.repeat(40)},{head_branch:'unreviewed'},{repository:{full_name:'other/repo'}},{id:124},{event:'pull_request'},{path:'.github/workflows/other.yml'},{status:'in_progress'},{conclusion:'cancelled'}])assert.throws(()=>verify({...run,...changed},jobs,expected));
 assert.throws(()=>verify(run,[jobs[0]],expected));
 assert.throws(()=>verify(run,[jobs[0],{...jobs[1],conclusion:'failure'}],expected));
});
