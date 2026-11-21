# Quick Share deep diagnostic

Commit: e130915a418a86017167e4f11b0d2151a8e643bd · helper SHA-256: 9c4a95429924bed654504af037e7f2b16bdff031c6dcd4b77d55ff925bcd0031
Direction: samsung-to-linux · network: ordinary · outcome: completed

**Production compatibility acceptance: not established. Single-fixture evidence is separate.**

FEF3 observations: 7; decoded: 0; GATT-resolved: 0; ready: 0.
ADB: authorized; log visibility: readable-partial.
Shutdown: clean-stop. Transfer: unconfirmed.

Runner failure stage: unknown. Clock alignment: sampled offset envelope; unsampled drift and log delivery delay remain unknown.
## Findings

- [Direct runtime observation] 7 FEF3 service-data observations reached Linux; the decoded-candidate status remained zero. Parsing, validation and filtering must be distinguished by the new counters. These are observations, not distinct phones, and Samsung attribution is UNKNOWN.
- [Direct runtime observation] GATT metadata resolution or slot reads failed. Review connection, service, slot and categorized D-Bus counters; this is distinct from Weave negotiation.
- [Unknown] No packet is attributed to Samsung by this report. Network limitations, Android service visibility, unsupported formats and radio behavior require controlled comparison; timestamp proximity alone is not causality.

## Rejection and lifecycle counters

| Counter | Count |
| --- | ---: |
| scan_start_requested | 33 |
| scan_start_success | 33 |
| scan_windows | 33 |
| scan_closed | 33 |
| scan_ms | 89998 |
| scan_pause_ms | 229190 |
| scan_pause_regular | 26 |
| scan_pause_session | 7 |
| cache_replay_suppressed | 1044 |
| adapter_ready | 1 |
| dbus_timeout | 2 |
| dbus_other_error | 150 |
| fef3_observations | 7 |
| candidate_distinct | 2 |
| candidate_repeated | 5 |
| gatt_resolution_requested | 7 |
| gatt_resolution_failure | 7 |
| gatt_connection_attempted | 2 |
| gatt_connection_failed | 2 |
| l2cap_bind_success | 1 |
| l2cap_psm_accepted | 1 |
| gatt_registration_requested | 1 |
| gatt_registration_success | 1 |
| advertisement_registration_requested | 148 |
| advertisement_registration_failure | 148 |
| advertisement_released | 0 |
| full_reject_unsupported_fast_format | 7 |
| compact_reject_invalid_length | 7 |
| length_25_31 | 7 |
| version_2 | 7 |
| gatt_disconnect_failed | 2 |
| fast_accepted | 7 |
| fast_requires_gatt | 7 |
| fast_metadata_unresolved | 7 |
| fast_length_27 | 7 |
| fast_info_prefix_17 | 7 |

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
