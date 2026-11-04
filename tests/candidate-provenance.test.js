'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
function verify(patch){return JSON.parse(execFileSync(process.env.PYTHON||'python3',['-c',
 `import sys,json;sys.path.insert(0,'scripts');from candidate_provenance import verified_build,REQUIRED
p=json.loads(sys.argv[1]);r={'id':123,'head_branch':'main','head_repository':{'full_name':'fluffydisk/airdrop-linux'},'path':'.github/workflows/flatpak-update-repository.yml','status':'queued','conclusion':None}
s=[{'name':n,'status':'completed','conclusion':'success'} for n in sorted(REQUIRED)]+[{'name':'Run actions/upload-artifact@v4','status':'completed','conclusion':'success'},{'name':'Complete job','status':'completed','conclusion':'success'}]
j={'name':'build','run_id':123,'status':'in_progress','conclusion':None,'steps':s}
r.update(p.get('run',{}));j.update(p.get('job',{}))
if 'step' in p:s[0].update(p['step'])
if p.get('missing_gate'):s.pop(0)
if p.get('missing_completion'):s.pop()
print(json.dumps(verified_build(r,[j])))`,JSON.stringify(patch)],{encoding:'utf8'}));}
test('completed tested build is accepted while publication bookkeeping or aggregate status lags',()=>{assert.equal(verify({}),true);assert.equal(verify({run:{status:'completed',conclusion:'success'},job:{status:'completed',conclusion:'success'}}),true);});
test('failed, cancelled, unfinished or missing validation steps never authorize candidate download',()=>{
 for(const conclusion of ['failure','cancelled','timed_out','skipped'])assert.equal(verify({step:{conclusion}}),false);
 assert.equal(verify({step:{status:'in_progress'}}),false);assert.equal(verify({missing_gate:true}),false);assert.equal(verify({missing_completion:true}),false);
});
test('wrong repository, workflow, branch, run identity and failed aggregate conclusions fail closed',()=>{
 for(const run of [{head_branch:'feature'},{path:'.github/workflows/other.yml'},{head_repository:{full_name:'other/repo'}},{conclusion:'failure'},{conclusion:'cancelled'}])assert.equal(verify({run}),false);
 assert.equal(verify({job:{run_id:456}}),false);assert.equal(verify({job:{conclusion:'failure'}}),false);
});
