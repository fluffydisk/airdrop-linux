# Quick Share deep diagnostic

Commit: 3cec650445595873497634d909e4c378b3648d37 · helper SHA-256: 2e1e20c1d40e574454777dc25bcf633d8ccb572780e74839436c49a7464fc623
Direction: linux-to-samsung · network: ordinary · outcome: completed

**Samsung compatibility: not established.**

FEF3 observations: 102; decoded: 0; GATT-resolved: 0; ready: 0.
ADB: authorized; log visibility: readable-partial.
Shutdown: clean-stop. Transfer: unconfirmed.

Runner failure stage: unknown. Clock alignment: sampled offset envelope; unsampled drift and log delivery delay remain unknown.
## Findings

- [Direct runtime observation] 102 FEF3 service-data observations reached Linux; the decoded-candidate status remained zero. Parsing, validation and filtering must be distinguished by the new counters. These are observations, not distinct phones, and Samsung attribution is UNKNOWN.
- [Direct runtime observation] 102 observations were rejected by both current parsers. Per-format reason counters describe validation gates, not a proven Samsung protocol defect.
- [Source-code inference] A bounded fast-format shape passed diagnostic-only inspection. The receiver parser deliberately rejects this format; phone attribution and complete protocol validity are unknown.
- [Unknown] No packet is attributed to Samsung by this report. Network limitations, Android service visibility, unsupported formats and radio behavior require controlled comparison; timestamp proximity alone is not causality.

## Rejection and lifecycle counters

| Counter | Count |
| --- | ---: |
| scan_start_requested | 42 |
| scan_start_success | 42 |
| scan_windows | 42 |
| scan_closed | 41 |
| scan_ms | 128559 |
| scan_pause_ms | 292405 |
| scan_pause_regular | 41 |
| cache_replay_suppressed | 1323 |
| adapter_ready | 1 |
| fef3_observations | 102 |
| candidate_distinct | 14 |
| candidate_repeated | 88 |
| candidate_rejected | 102 |
| unsupported_fast_well_formed | 94 |
| l2cap_bind_success | 1 |
| l2cap_psm_accepted | 1 |
| gatt_registration_requested | 1 |
| gatt_registration_success | 1 |
| advertisement_registration_requested | 14 |
| advertisement_registration_success | 14 |
| advertisement_released | 13 |
| ukey2_progress | 2 |
| protocol_sending | 2 |
| protocol_completion_unconfirmed | 1 |
| helper_recipient_received | 7 |
| helper_recipient_published | 4 |
| full_reject_invalid_length | 8 |
| full_reject_unsupported_fast_format | 94 |
| compact_reject_invalid_length | 94 |
| compact_reject_invalid_encoding | 8 |
| length_0_7 | 8 |
| length_25_31 | 94 |
| version_0 | 8 |
| version_2 | 94 |
| format_unrecognized | 8 |

## Next physical tests

- Repeat ordinary home LAN with Samsung Receive visible, unchanged radio settings, USB diagnostics authorized, and the same disposable fixture.
- Compare a separate phone-hotspot session; record --network hotspot. Do not conflate it with an ordinary LAN test.
- If Samsung offers Apple sharing, compare separate --apple-sharing on/off sessions, without interpreting an absent setting as failure.
- Compare baseline with Receive closed against an explicit ANDROID_RECEIVE_OPEN marker. A changed rejection count is a hypothesis, not phone attribution.
- If supported-format counters stay zero, review exact reason, length and version buckets before proposing a parser change.
- If GATT is reached, identify connection, service, slot, characteristic and Weave boundaries independently.
- Only after native completion, independently read back the generated fixture bytes and rerun/collect with --readback; never use an answer of pass as integrity evidence.

## Privacy and limitations

- Unprivileged Android may hide Nearby/Quick Share internals. Missing events mean UNKNOWN.
- Validated package candidates are not proof of the active Quick Share service. Process categories may be unattributed.
- Host timestamps and clock samples have latency/precision uncertainty; logs can be delayed.
- No addresses, serials, SSIDs, accounts, packet payloads, personal filenames, codes or keys are exported. Unparseable log records are discarded.
- Default reports contain build versions, fixed counters, time samples and owner-selected test settings. Review before sharing.

Only sanitized reports and isolated disposable lab files persist. Delete the private workspace after review; stop the lab first.

The JSON report contains capability, GATT/LE CoC, IPC, renderer, Android, clock and owner evidence. The separate timeline preserves protocol/consent/transfer transitions. No data is uploaded.
