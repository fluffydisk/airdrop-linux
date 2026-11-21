# Quick Share deep diagnostic

Commit: 4ad207f131b2057b9eef8cfe4be3c36fcad5177e · helper SHA-256: cbad7bcfab03ddb3b20fcf1e3d75610130d8bc23e1d1d541f51bd234762383bd
Direction: samsung-to-linux · network: ordinary · outcome: completed

**Production compatibility acceptance: not established. Single-fixture evidence is separate.**

FEF3 observations: 24; decoded: 0; GATT-resolved: 0; ready: 0.
ADB: authorized; log visibility: readable-partial.
Shutdown: clean-stop. Transfer: unconfirmed.

Runner failure stage: unknown. Clock alignment: sampled offset envelope; unsampled drift and log delivery delay remain unknown.
## Findings

- [Direct runtime observation] 24 FEF3 service-data observations reached Linux; the decoded-candidate status remained zero. Parsing, validation and filtering must be distinguished by the new counters. These are observations, not distinct phones, and Samsung attribution is UNKNOWN.
- [Direct runtime observation] 15 strict Fast parser acceptances did not produce a resolved endpoint. Connection attempts/failures and missing metadata concern Linux scanning remote candidates; those candidates are unattributed and do not explain local advertising rejection.
- [Direct runtime observation] 10 observations were rejected by all applicable parsers in the captured build. Per-format reason counters describe validation gates, not a proven Samsung protocol defect.
- [Direct runtime observation] Remote GATT resolution was refused by the owned-ACL guard (retained connection or capacity). Failed disconnects retain ownership conservatively. This is separate from local advertisement registration; no unrelated ACL is disconnected.
- [Direct runtime observation] GATT metadata resolution or slot reads failed. Review connection, service, slot and categorized D-Bus counters; this is distinct from Weave negotiation.
- [Unknown] No packet is attributed to Samsung by this report. Network limitations, Android service visibility, unsupported formats and radio behavior require controlled comparison; timestamp proximity alone is not causality.

## Local receiver advertising

BlueZ registration: 1 succeeded / 8 failed / 9 requested. GATT service registered: true; LE CoC socket bound: true. Independent RF transmission: unknown.
Last attempt: phase=bluez; mode=compact-gatt; result=failed; error=org.bluez.Error.Failed; category=failed; service bytes=17; conservative legacy bytes=24; type=peripheral; secondary=none; discoverable=adapter-default; discovery=idle; own scan paused=true; retry=30s; available/active instances=5/0.

## Rejection and lifecycle counters

| Counter | Count |
| --- | ---: |
| scan_start_requested | 24 |
| scan_start_success | 24 |
| scan_windows | 24 |
| scan_closed | 24 |
| scan_ms | 43852 |
| scan_pause_ms | 183319 |
| scan_pause_regular | 10 |
| scan_pause_session | 12 |
| cache_replay_suppressed | 694 |
| adapter_ready | 1 |
| dbus_timeout | 5 |
| dbus_other_error | 5 |
| fef3_observations | 25 |
| candidate_distinct | 9 |
| candidate_repeated | 16 |
| candidate_rejected | 10 |
| gatt_resolution_requested | 12 |
| gatt_resolution_failure | 12 |
| gatt_connection_attempted | 5 |
| gatt_connection_failed | 5 |
| l2cap_bind_success | 1 |
| l2cap_psm_accepted | 1 |
| gatt_registration_requested | 1 |
| gatt_registration_success | 1 |
| advertisement_registration_requested | 9 |
| advertisement_registration_success | 1 |
| advertisement_registration_failure | 8 |
| advertisement_released | 1 |
| full_reject_invalid_length | 1 |
| full_reject_unsupported_socket_version | 9 |
| full_reject_unsupported_fast_format | 15 |
| compact_reject_invalid_length | 15 |
| compact_reject_bloom_mismatch | 9 |
| compact_reject_invalid_encoding | 1 |
| length_0_7 | 1 |
| length_18_24 | 9 |
| length_25_31 | 15 |
| version_0 | 1 |
| version_2 | 24 |
| gatt_disconnect_failed | 5 |
| gatt_resolution_throttled | 3 |
| format_unrecognized | 1 |
| fast_accepted | 15 |
| fast_requires_gatt | 15 |
| fast_metadata_unresolved | 12 |
| fast_length_27 | 15 |
| fast_info_prefix_17 | 15 |
| advertisement_error_failed | 8 |
| advertisement_attempt_compact | 9 |
| advertisement_discovery_idle | 9 |
| advertisement_retry_scheduled | 8 |
| scan_pause_advertisement | 2 |
| gatt_connection_error_timeout | 5 |
| gatt_ownership_capacity_rejected | 3 |
| gatt_ownership_busy_rejected | 4 |

## Next physical tests

- First verify local receiver advertisement registration on ordinary home LAN, unchanged radio settings and an unused private workspace. For Samsung-to-Linux, open native Share after the baseline; record whether Airdrop S24 Lab stays visible across the 90-second renewal. Registration alone does not prove RF emission.
- If registration fails, inspect receiverAdvertising.lastAttempt phase/errorName/category, compact payload budget, instance samples and discovery state before changing protocol parsing or system permissions.
- Defer hotspot and Apple-sharing setting comparisons until the local advertising failure is characterized; preserve the previously verified ordinary-LAN sender path.
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
