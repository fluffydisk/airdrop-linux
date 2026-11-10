'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { PHASES, STATUSES, PROTOCOL_STAGES, atomicJson, atomicText, capabilities, ownedDirectory, readJson } = require('../../lib/sharing/lab-evidence');
const { fixtureNames, hashDirectory } = require('./fixtures.cjs');
const LABELS = { A: 'Helper starts', B: 'Local Quick Share mDNS endpoint observed', C: 'Samsung discovers Linux', D: 'Linux discovers Samsung', E: 'Native connection established', F: 'Verification codes match', G: 'Receiver accepts', H: 'File bytes transfer', I: 'Receiver confirms final outcome', J: 'Independent fixture hashes match' };
const OUTCOMES = new Set(['pass', 'fail', 'not-tested', 'unknown']);
const ERROR_CODES = new Set(['HELPER_VERIFICATION', 'CAPABILITY_UNAVAILABLE', 'IPC_PROTOCOL', 'RECEIVE_VALIDATION', 'IPC_TIMEOUT', 'HELPER_UNAVAILABLE', 'SEND_REQUEST_FAILED']);
function timeline(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(-2000).flatMap(v => {
    if (!v || !Number.isSafeInteger(v.elapsedMs) || v.elapsedMs < 0) return [];
    const base = { elapsedMs: v.elapsedMs };
    if (v.type === 'protocol' && /^attempt-[1-9][0-9]{0,2}$/.test(v.attempt || '') && PROTOCOL_STAGES.has(v.stage) && ['incoming', 'outgoing'].includes(v.direction)) return [{ ...base, type: 'protocol', attempt: v.attempt, stage: v.stage, direction: v.direction }];
    if (v.type === 'helper' && STATUSES.has(v.status)) return [{ ...base, type: 'helper', status: v.status, ...(ERROR_CODES.has(v.category) ? { category: v.category } : {}) }];
    if (v.type === 'transfer' && /^attempt-[1-9][0-9]{0,2}$/.test(v.attempt || '') && PHASES.has(v.phase) && ['incoming', 'outgoing'].includes(v.direction)) return [{ ...base, type: 'transfer', attempt: v.attempt, phase: v.phase, direction: v.direction, bytes: safeNumber(v.bytes), total: safeNumber(v.total) }];
    if (v.type === 'consent') return [{ ...base, type: 'consent', accepted: v.accepted === true }];
    if (['verification-available', 'shutdown-requested'].includes(v.type)) return [{ ...base, type: v.type }];
    if (v.type === 'bluetooth') return [{ ...base, type: 'bluetooth', bluetooth: require('../../lib/sharing/quickshare').sanitizeBluetooth(v.bluetooth) }];
    if (v.type === 'discovery') return [{ ...base, type: 'discovery', recipients: Math.min(safeNumber(v.recipients), 100) }];
    return [];
  });
}
function safeNumber(n) { return Number.isSafeInteger(n) && n >= 0 && n <= 64 * 1024 ** 3 ? n : 0; }
function observations(value = {}) {
  const stages = {};
  // A/B are measured locally; J requires independently read bytes, never a yes/no claim.
  for (const key of ['C', 'D', 'E', 'F', 'G', 'H', 'I']) if (OUTCOMES.has(value.stages?.[key])) stages[key] = value.stages[key];
  const version = input => /^(?:unknown|[0-9]{1,2}(?:\.[0-9]{1,6}){0,4})$/.test(input || '') && !/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.)/.test(input) ? input : 'unknown';
  return { direction: ['samsung-to-linux', 'linux-to-samsung'].includes(value.direction) ? value.direction : 'unrecorded', scenario: ['ordinary', 'decline', 'cancel', 'interrupt'].includes(value.scenario) ? value.scenario : 'ordinary', case: value.case === 'batch' || value.case === 'all' || fixtureNames.includes(value.case) ? value.case : 'unrecorded', phone: { model: 'Samsung Galaxy S24+', androidVersion: version(value.phone?.androidVersion), oneUiVersion: version(value.phone?.oneUiVersion), quickShareVersion: version(value.phone?.quickShareVersion), settings: { wifiOn: typeof value.phone?.settings?.wifiOn === 'boolean' ? value.phone.settings.wifiOn : null, bluetoothOn: typeof value.phone?.settings?.bluetoothOn === 'boolean' ? value.phone.settings.bluetoothOn : null, sameLan: typeof value.phone?.settings?.sameLan === 'boolean' ? value.phone.settings.sameLan : null, visibility: ['everyone', 'contacts', 'none'].includes(value.phone?.settings?.visibility) ? value.phone.settings.visibility : 'unknown', appleSharing: ['on', 'off', 'not-available'].includes(value.phone?.settings?.appleSharing) ? value.phone.settings.appleSharing : 'unknown' } }, stages };
}
function classify(stages, caps, scenario) {
  if (stages.A.status === 'fail') return { category: 'HELPER_STARTUP_FAILED', summary: 'The helper did not start successfully.' };
  if (stages.C.status === 'fail') return !caps.ble ? { category: 'DISCOVERY_UNAVAILABLE_BLE_NOT_IMPLEMENTED', summary: 'Native Samsung discovery unavailable — BLE bootstrap not implemented.', qualification: 'Samsung did not discover Linux in this LAN-only trial. Missing BLE is a capability gap, not proven causality; visibility, LAN association, multicast and firewall conditions still need review. Later stages remain untested.' } : { category: 'SAMSUNG_DISCOVERY_FAILED', summary: 'Samsung did not discover Linux; review advertisement and radio evidence.' };
  if (stages.D.status === 'fail') return { category: 'LINUX_DISCOVERY_FAILED', summary: 'Linux did not discover Samsung during the native Receive test.' };
  if (stages.E.status === 'fail') return { category: 'CONNECTION_FAILED', summary: 'Discovery succeeded but a native connection was not established.' };
  if (stages.F.status === 'fail') return { category: 'VERIFICATION_FAILED', summary: 'Verification failed or codes differed. Reject the request; do not bypass authentication.' };
  if (stages.G.status === 'fail') return { category: scenario === 'decline' ? 'EXPECTED_REJECTION' : 'ACCEPTANCE_FAILED', summary: scenario === 'decline' ? 'Owner intentionally declined the request.' : 'The receiver did not accept.' };
  if (stages.H.status === 'fail') return { category: ['cancel', 'interrupt'].includes(scenario) ? 'EXPECTED_INTERRUPTION' : 'PAYLOAD_TRANSFER_FAILED', summary: 'The payload did not complete; consult native transfer phases.' };
  if (stages.I.status === 'fail') return { category: 'RECEIVER_OUTCOME_UNCONFIRMED', summary: 'The receiver did not confirm successful completion.' };
  if (stages.J.status === 'fail') return { category: 'FILE_INTEGRITY_MISMATCH', summary: 'Independent readback differs from a generated fixture.' };
  const discovery = stages[stages.direction === 'samsung-to-linux' ? 'C' : 'D'];
  if (discovery?.status === 'pass' && ['E', 'F', 'G', 'H', 'I', 'J'].every(key => stages[key].status === 'pass')) return { category: 'OWNER_REPORTED_TRANSFER_WITH_HASHES', summary: 'Owner reports a native transfer and independent fixture hashes match. Engineering review and repeat acceptance remain required.' };
  return { category: 'INCOMPLETE_EVIDENCE', summary: 'Some stages have not been tested or confirmed. No Android compatibility conclusion is drawn.' };
}
async function createReport(root, preflight, input, readback) {
  ownedDirectory(root);
  const marker = readJson(path.join(root, 'lab.json'));
  let desktop = {}, runtime = {};
  try { desktop = readJson(path.join(root, 'desktop-state.json')); } catch {}
  try { runtime = readJson(path.join(root, 'runtime.json')); } catch {}
  if (desktop.run !== marker.run) desktop = {};
  if (runtime.run !== marker.run) runtime = {};
  const obs = observations(input), events = timeline(desktop.events);
  const caps = capabilities(preflight.helper.capabilities);
  const stage = status => ({ status, evidence: 'not tested' });
  const stages = Object.fromEntries(Object.keys(LABELS).map(key => [key, stage('not-tested')]));
  const wasReady = desktop.helper?.status === 'ready' || events.some(e => e.type === 'helper' && e.status === 'ready');
  stages.A = { status: wasReady ? 'pass' : runtime.status === 'failed' || desktop.helper?.status === 'error' ? 'fail' : 'not-tested', evidence: 'actual development adapter/helper lifecycle' };
  stages.B = { status: runtime.advertisements?.ownObserved === true ? 'pass' : 'unknown', evidence: 'independent local mDNS browser; observation does not establish Samsung visibility' };
  for (const [key, status] of Object.entries(obs.stages)) stages[key] = { status, evidence: 'owner-reported stock Samsung UI observation' };
  const manifest = readJson(path.join(root, 'fixtures/fixture-manifest.json'));
  const expected = {};
  for (const name of fixtureNames) if (manifest[name] && /^[a-f0-9]{64}$/.test(manifest[name].sha256 || '') && Number.isInteger(manifest[name].size) && manifest[name].size >= 0 && manifest[name].size <= 3 * 1024 * 1024) expected[name] = { size: manifest[name].size, sha256: manifest[name].sha256 };
  if (Object.keys(expected).length !== fixtureNames.length) throw Error('Invalid fixture manifest; prepare again');
  const selected = obs.case === 'all' ? fixtureNames : obs.case === 'batch' ? fixtureNames.filter(name => name.startsWith('lab-batch-')) : fixtureNames.includes(obs.case) ? [obs.case] : [];
  const hashes = await hashDirectory(obs.direction === 'samsung-to-linux' ? path.join(root, 'sessions', marker.run, 'share/Received') : obs.direction === 'linux-to-samsung' ? readback || path.join(root, 'sessions', marker.run, 'readback') : undefined, expected);
  const selectedHashes = hashes.checked.filter(value => selected.includes(value.fixture));
  stages.J = { status: selected.length && selectedHashes.some(v => v.result === 'mismatch') ? 'fail' : selected.length && selected.every(name => selectedHashes.some(v => v.fixture === name && v.result === 'match')) ? 'pass' : 'not-tested', evidence: 'independent local SHA-256 over selected disposable fixture readback; absent readback is not a pass' };
  let classification = classify({ ...stages, direction: obs.direction }, caps, obs.scenario);
  if (marker.prepared === false && stages.A.status !== 'pass') classification = { category: 'PREPARATION_INCOMPLETE', summary: 'Development setup did not finish. Review the reported tool versions/dependencies and rerun prepare.' };
  if (stages.A.status === 'fail' && ['DISPLAY_UNAVAILABLE', 'SANDBOX_DENIED', 'RUNTIME_LIBRARY_MISSING'].includes(runtime.failureCategory)) classification = { category: runtime.failureCategory, summary: 'The development desktop failed to launch. Check local display, supported Electron libraries and OS sandbox policy; the harness does not disable security controls.' };
  const report = { schema: 1, createdAt: new Date().toISOString(), reviewRequired: true, productionAcceptanceEstablished: false,
    source: { commit: /^[a-f0-9]{40}$/.test(marker.commit || '') ? marker.commit : null, dirty: marker.dirty === true, currentCommit: preflight.source.commit, currentSourceMatches: marker.commit === preflight.source.commit && marker.fingerprint === preflight.source.fingerprint },
    build: { helperVersion: /^\d+\.\d+\.\d+$/.test(marker.helperVersion || '') ? marker.helperVersion : 'unknown', helperSha256: /^[a-f0-9]{64}$/.test(marker.helperSha256 || '') ? marker.helperSha256 : null, hashMatchesNow: preflight.helper.hashMatches === true, currentHelperMatchesSession: marker.helperSha256 === preflight.helper.sha256, sourceTreeSha256: /^[a-f0-9]{64}$/.test(marker.build?.sourceTreeSha256 || '') ? marker.build.sourceTreeSha256 : null, lockSha256: /^[a-f0-9]{64}$/.test(marker.build?.lockSha256 || '') ? marker.build.lockSha256 : null, buildCompilerVersion: /^[0-9.]+$/.test(marker.build?.compilerVersion || '') ? marker.build.compilerVersion : null, profile: marker.build?.profile === 'debug' ? 'debug' : 'unknown', ipc: marker.build?.ipc === 1 ? 1 : null, features: Array.isArray(marker.build?.features) ? marker.build.features.filter(v => ['ble-fastinit','ble-native'].includes(v)) : [], compilerVersions: preflight.versions, capabilities: caps },
    environment: { ...preflight.system, dependencies: preflight.dependencies, adapters: preflight.adapters, services: preflight.services },
    session: { runtimeCapabilities: capabilities(desktop.helper?.runtimeCapabilities), status: ['starting', 'running', 'stopped', 'failed'].includes(runtime.status) ? runtime.status : 'not-started', bluetooth: require('../../lib/sharing/quickshare').sanitizeBluetooth(desktop.helper?.bluetooth || runtime.bluetooth), listenerReachable: runtime.listenerReachable === true, bleFastInitState: ['registered-for-120s', 'expired', 'bluez-unavailable', 'bluez-timeout', 'permission-denied', 'not-supported', 'bluetooth-off', 'no-adapter', 'adapter-busy', 'bluez-operation-failed', 'unavailable-or-denied'].includes(runtime.bleFastInitState) ? runtime.bleFastInitState : 'not-requested', advertisements: { ownObserved: runtime.advertisements?.ownObserved === true, maxVisible: Math.min(safeNumber(runtime.advertisements?.maxVisible), 100) }, maxNativeRecipients: Math.min(safeNumber(desktop.maxRecipients), 100), evidenceTruncated: desktop.truncated === true },
    observations: obs, stages, failure: classification, integrity: hashes, timeline: events,
    limitations: [caps.ble ? 'BLE/GATT/LE CoC are experimental and hardware-unverified; authenticated LAN upgrade and direct wireless are not implemented.' : 'LAN-only build: prepare with --ble-native for experimental BLE/GATT; direct wireless is not implemented.', 'Outgoing bytes sent may have unconfirmed remote completion; phone outcome is recorded separately.', 'No raw logs, addresses, device names, PINs, personal files or packet captures are included.', 'Owner observations, independent-client tests and stock-device acceptance are distinct evidence.'] };
  const directory = path.join(root, 'reports'); await fs.mkdir(directory, { recursive: true, mode: 0o700 }); ownedDirectory(directory);
  atomicJson(directory, 'quickshare-test-results.json', report);
  const md = ['# Samsung Galaxy S24+ Quick Share test report', '', `Source: ${report.source.commit}${report.source.dirty ? ' (modified)' : ''}`, `Helper: ${report.build.helperVersion} · SHA-256 ${report.build.helperSha256}`, `Direction: ${obs.direction} · case: ${obs.case} · scenario: ${obs.scenario}`, '', '**' + report.failure.category + '**', report.failure.summary, report.failure.qualification || '', '', '| Stage | Test | Result | Evidence |', '| --- | --- | --- | --- |', ...Object.entries(stages).map(([key, value]) => `| ${key} | ${LABELS[key]} | ${value.status} | ${value.evidence} |`), '', '## Independent fixture hashes', '', ...hashes.checked.map(v => `- ${v.fixture}: ${v.result}${v.sha256 ? ' · SHA-256 ' + v.sha256 : ' · size mismatch'}`), hashes.checked.length ? '' : 'No eligible readback files were available; integrity is unverified.', '', '## Limits', '', ...report.limitations.map(v => '- ' + v), '', 'Review the JSON timeline and environment. Attach these two files manually; nothing is uploaded. This report does not certify production Android compatibility.', ''].join('\n');
  atomicText(directory, 'quickshare-test-report.md', md);
  return { report, directory };
}
module.exports = { LABELS, OUTCOMES, timeline, observations, classify, createReport };
