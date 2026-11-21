'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
test('audio timing counts only selected graph, deltas and resets without exporting names', () => {
  const result = JSON.parse(execFileSync('python', ['-c', `
import importlib.util,json
s=importlib.util.spec_from_file_location('audio','scripts/quickshare-lab/audio-timing.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def clock(i):return {'type':'clock','id':i,'duration':480,'rate':'1/48000','name':'PRIVATE-NAME'}
def sample(x,delay=1):return {'type':'driver','id':81,'name':'PRIVATE-ADDRESS','xrun_count':x,'prev':1000000,'signal':101000000,'awake':101000000+delay,'finish':112000000}
r=m.summarize([clock(9),sample(500),clock(81),sample(4),sample(6)],81)
reset=m.summarize([clock(81),sample(6),sample(1)],81)
try:m.summarize([clock(9),sample(1)],81);missing=False
except ValueError:missing=True
print(json.dumps({'normal':r,'reset':reset,'missingRejected':missing}))
`], {encoding:'utf8'}));
  assert.equal(result.normal.length, 1);
  assert.equal(result.normal[0].samples, 2);
  assert.equal(result.normal[0].xrunDelta, 2);
  assert.equal(result.normal[0].deadlineMissSamples, 2);
  assert.equal(result.normal[0].interval.atLeast100ms, 2);
  assert.equal(result.reset[0].xrunDelta, null);
  assert.equal(result.reset[0].counterResets, 1);
  assert.equal(result.missingRejected, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|ADDRESS|NAME/);
});
