'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { summarizeRoleStateTrace: summarize } = require('../scripts/quickshare-lab/controller-state.cjs');
const fixture = require('./fixtures/quickshare-s24-role-state.json');
const line = fixture.lines[0];
test('actual S24 kernel trace identifies peripheral simultaneous-state rejection without claiming transfer success', () => {
  const r = summarize(fixture.lines.join('\n'), { legacyController: fixture.legacyController });
  assert.equal(r.attempts, fixture.expectedAttempts); assert.equal(r.roleConflicts, 4);
  assert.equal(r.classification, fixture.expectedClassification);
  assert.equal(r.peripheralConflict, true); assert.equal(r.centralConflict, false);
  assert.equal(r.malformedAttempts, 0);
});
test('role limit diagnosis requires legacy controller evidence and the precise pre-disable EINVAL boundary', () => {
  for (const input of [line.replace('result=-22', 'result=0'), line.replace('disable_reached=0', 'disable_reached=1'), line.replace('peripheral_connectable=0', 'peripheral_connectable=1'), line.replace('le_total=1 le_peripheral=1', 'le_total=0 le_peripheral=0'), line.replace('connectable=1', 'connectable=0')]) {
    assert.equal(summarize(input, { legacyController: true }).roleConflicts, 0);
  }
  assert.equal(summarize(line).roleConflicts, 0);
  assert.equal(summarize('org.bluez.Error.Failed: private device info', { legacyController: true }).classification, 'unresolved');
});
test('central and mixed roles require their own simultaneous connectable/scannable capabilities', () => {
  const central = line.replace('le_peripheral=1', 'le_peripheral=0');
  const r = summarize(central, { legacyController: true });
  assert.equal(r.centralConflict, true); assert.equal(r.peripheralConflict, false);
  const both = summarize(line.replace('le_total=1', 'le_total=2'), { legacyController: true });
  assert.equal(both.centralConflict, true); assert.equal(both.peripheralConflict, true);
});
test('malformed or injected trace metadata cannot create a diagnosis or leak text', () => {
  for (const input of [line+' secret=private', line+' result=-22', line.replace('le_total=1','le_total=-1'), line.replace('le_peripheral=1','le_peripheral=2'), line.replace('connectable=1','connectable=2'), line.replace('result=-22','result=private')]) {
    const r = summarize(input, { legacyController: true });
    assert.equal(r.roleConflicts, 0); assert.equal(r.malformedAttempts, 1);
    assert.equal(JSON.stringify(r).includes('private'), false);
  }
  const r = summarize(Array(40).fill(line).join('\n'), { legacyController: true });
  assert.equal(r.attempts, 32); assert.equal(r.truncated, true);
});
