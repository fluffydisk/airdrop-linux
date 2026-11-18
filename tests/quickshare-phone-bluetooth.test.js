'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {record}=require('../scripts/quickshare-lab/phone-bluetooth.cjs');
test('phone Bluetooth metadata preserves typed status/reason without exporting private messages',()=>{
 const x=record('1794910000.123  101 202 W BluetoothGatt: connect failed status=133 reason=0x08 peer=AA:BB:CC:DD:EE:FF filename=PRIVATE code=9876 key=SECRET');
 assert.equal(x.status,133);assert.equal(x.reason,8);assert.equal(x.clock,'android-epoch');
 assert.ok(x.labels.includes('connect'));assert.ok(x.labels.includes('fail'));
 assert.doesNotMatch(JSON.stringify(x),/AA:BB|PRIVATE|9876|SECRET|101|202/);
 assert.deepEqual(Object.keys(x).sort(),['androidMs','clock','labels','reason','status','tag']);
});
test('phone metadata rejects unknown tags, oversized/multiline input and non-byte code fields',()=>{
 assert.equal(record('1794910000.123 101 202 I PRIVATE: status=8'),null);
 assert.equal(record('x'.repeat(4097)),null);
 assert.equal(record('1794910000.123 101 202 I bt_stack: status=8\nkey=SECRET'),null);
 const x=record('1794910000.123 101 202 I bt_stack: connect reason=1234 status=999 code=1234');
 assert.equal(x.reason,undefined);assert.equal(x.status,undefined);assert.deepEqual(x.labels,['connect']);
});
