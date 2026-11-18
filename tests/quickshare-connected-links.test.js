'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
test('read-only connection inventory keeps actual roles distinct and rejects malformed ABI without exporting peer identities', () => {
  const result = execFileSync('/usr/bin/python3', ['-c', `
import importlib.util,struct,json
spec=importlib.util.spec_from_file_location('links','scripts/quickshare-lab/connected-links.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
# Independent native hci.h wire structure: header + handle/address/type/out/state/mode.
addr=bytes([6,5,4,3,2,1])
data=struct.pack('@HH',0,2)+struct.pack('@H6sBBHI',999,addr,128,1,1,1)+struct.pack('@H6sBBHI',998,bytes([12,11,10,9,8,7]),1,0,1,0)
r=m.decode_links(data,[{'address':'01:02:03:04:05:06','name':'Soundcore PRIVATE-SECRET'}])
assert r['connections'][0]['role']=='central' and r['connections'][0]['linkType']=='LE'
assert r['connections'][0]['soundcoreNameMatch'] is True
assert r['connections'][1]['role']=='peripheral' and r['connections'][1]['linkType']=='BR/EDR'
for invalid in [b'',data[:4],struct.pack('@HH',0,17)+bytes(17*16)]:
 try:m.decode_links(invalid)
 except ValueError:pass
 else:raise AssertionError('invalid inventory accepted')
full=struct.pack('@HH',0,16)+data[4:20]*16
assert m.decode_links(full)['atCapacity'] is True
assert m.HCIGETCONNLIST==0x800448d4
assert m.controller_index(entries=['hci1','hci1:2','rfkill0'])==1
assert m.controller_index(entries=['hci7'])==7
assert m.controller_index(1,entries=['hci0','hci1'])==1
for entries,category in [([], 'unavailable'), (['hci0','hci1'], 'ambiguous-adapter')]:
 try:m.controller_index(entries=entries)
 except m.ControllerSelectionError as e:assert e.category==category
 else:raise AssertionError('missing or ambiguous adapter accepted')
print(json.dumps(r))
`], { encoding: 'utf8' });
  const r = JSON.parse(result); assert.equal(r.querySucceeded, true); assert.equal(r.connections.length, 2);
  for (const privateValue of ['01:02:03:04:05:06', 'PRIVATE', 'SECRET', '999', '998']) assert.equal(result.includes(privateValue), false);
});
