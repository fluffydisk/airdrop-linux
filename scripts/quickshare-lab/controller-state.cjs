'use strict';
// Offline interpretation of the bounded, metadata-only kernel probe. A generic
// BlueZ Failed reply alone must never be classified as a controller role limit.
const fields = ['result', 'le_total', 'le_peripheral', 'connectable', 'central_nonconn', 'central_scannable', 'central_connectable', 'peripheral_nonconn', 'peripheral_scannable', 'peripheral_connectable', 'disable_reached'];
function summarizeRoleStateTrace(text, { legacyController = false } = {}) {
  const result = { schema: 1, source: 'kernel-role-state-trace', attempts: 0, roleConflicts: 0, malformedAttempts: 0, truncated: false, classification: 'unresolved', peripheralConflict: false, centralConflict: false };
  for (const line of String(text).split('\n')) {
    if (!line.startsWith('event=enable_result ')) continue;
    if (result.attempts + result.malformedAttempts >= 32) { result.truncated = true; break; }
    const tokens = line.slice('event=enable_result '.length).trim().split(/\s+/);
    const values = {};
    let valid = tokens.length === fields.length;
    for (const token of tokens) {
      const m = /^([a-z_]+)=(-?\d{1,5})$/.exec(token);
      if (!m || !fields.includes(m[1]) || Object.hasOwn(values, m[1])) { valid = false; continue; }
      values[m[1]] = Number(m[2]);
    }
    valid &&= fields.every(k => Number.isSafeInteger(values[k]));
    valid &&= values.result >= -4095 && values.result <= 255;
    valid &&= values.le_total >= 0 && values.le_total <= 64 && values.le_peripheral >= 0 && values.le_peripheral <= values.le_total;
    valid &&= fields.slice(3).every(k => values[k] === 0 || values[k] === 1);
    if (!valid) { result.malformedAttempts++; continue; }
    result.attempts++;
    const peripheral = values.le_peripheral > 0 && !(values.peripheral_scannable && values.peripheral_connectable);
    const central = values.le_total > values.le_peripheral && !(values.central_scannable && values.central_connectable);
    if (legacyController && values.result === -22 && values.connectable === 1 && values.disable_reached === 0 && (peripheral || central)) {
      result.roleConflicts++;
      result.peripheralConflict ||= peripheral;
      result.centralConflict ||= central;
    }
  }
  if (result.roleConflicts > 0) result.classification = 'legacy-connectable-le-role-conflict';
  return result;
}
module.exports = { summarizeRoleStateTrace };
if (require.main === module) {
  const fs = require('node:fs');
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[1] !== '--legacy-controller') throw Error('Usage: controller-state.cjs TRACE --legacy-controller (only after independently verifying legacy controller)');
  if (fs.statSync(args[0]).size > 128 * 1024) throw Error('Trace exceeds metadata limit');
  console.log(JSON.stringify(summarizeRoleStateTrace(fs.readFileSync(args[0], 'utf8'), { legacyController: true }), null, 2));
}
