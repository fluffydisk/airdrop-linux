# Quick Share deep diagnostic

Commit: b3bb1869d5be0e9e95b5dff910110df48d314344 · helper SHA-256: 839b6fe5bf9b62339e8389271cc84e49f8e86c5f9840012fef4e3a13e760aade
Direction: samsung-to-linux · network: ordinary · capture outcome: completed

**Production compatibility acceptance: not established. Single-fixture evidence is separate.**

FEF3 observations: 22; decoded: 0; GATT-resolved: 0; ready: 0.
ADB: not-requested; log visibility: unknown.
Shutdown: clean-stop. Transfer: unconfirmed.

Runner failure stage: unknown. Clock alignment: sampled offset envelope; unsampled drift and log delivery delay remain unknown.
## Findings

- [Direct runtime observation] 1 local registrations succeeded and 10 failed. Earlier registration is not evidence of continued advertising or initial RF visibility. Inspect replacement trigger and cleanup completion separately from the phone's recipient UI.
- [Direct runtime observation] 22 FEF3 service-data observations reached Linux; the decoded-candidate status remained zero. Parsing, validation and filtering must be distinguished by the new counters. These are observations, not distinct phones, and Samsung attribution is UNKNOWN.
- [Direct runtime observation] 22 strict Fast parser acceptances did not produce a resolved endpoint. Connection attempts/failures and missing metadata concern Linux scanning remote candidates; those candidates are unattributed and do not explain local advertising rejection.
- [Direct runtime observation] GATT metadata resolution or slot reads failed. Review connection, service, slot and categorized D-Bus counters; this is distinct from Weave negotiation.
- [Unknown] No packet is attributed to Samsung by this report. Network limitations, Android service visibility, unsupported formats and radio behavior require controlled comparison; timestamp proximity alone is not causality.

## Local receiver advertising

BlueZ registration: 1 succeeded / 10 failed / 11 requested. GATT service registered: true; LE CoC socket bound: true. Independent RF transmission: unknown.
Last attempt: phase=bluez; mode=compact-gatt; result=failed; error=org.bluez.Error.Failed; category=failed; detail=controller-registration; trigger=retry; service bytes=17; conservative legacy bytes=24; type=peripheral; secondary=none; discoverable=adapter-default; discovery=idle; own scan paused=true; retry=30s; available/active instances=5/0.

Last cleanup: reason=renewal; result=completed; unregister=acknowledged; error=none; age=90240ms of lease 120000ms; daemon Release before/during cleanup=false/false; I/O stopped=true; owner scope closed=true; guard interval=250ms. This is not controller completion or RF evidence.

## Rejection and lifecycle counters

| Counter | Count |
| --- | ---: |
| scan_start_requested | 27 |
| scan_start_success | 27 |
| scan_windows | 27 |
| scan_closed | 27 |
| scan_ms | 54023 |
| scan_pause_ms | 211464 |
| scan_pause_regular | 8 |
| scan_pause_session | 16 |
| cache_replay_suppressed | 4225 |
| scan_watcher_limit | 76 |
| adapter_ready | 1 |
| dbus_timeout | 1 |
| dbus_other_error | 22 |
| fef3_observations | 22 |
| candidate_distinct | 7 |
| candidate_repeated | 15 |
| gatt_resolution_requested | 16 |
| gatt_resolution_failure | 16 |
| gatt_connection_attempted | 1 |
| gatt_connection_failed | 1 |
| l2cap_bind_success | 1 |
| l2cap_psm_accepted | 1 |
| l2cap_incoming | 3 |
| l2cap_bootstrap_rejected | 2 |
| gatt_registration_requested | 1 |
| gatt_registration_success | 1 |
| advertisement_registration_requested | 11 |
| advertisement_registration_success | 1 |
| advertisement_registration_failure | 10 |
| advertisement_released | 1 |
| nearby_connection_message | 1 |
| ukey2_progress | 2 |
| protocol_disconnected | 3 |
| protocol_receiving | 1 |
| full_reject_unsupported_fast_format | 22 |
| compact_reject_invalid_length | 22 |
| length_25_31 | 22 |
| version_2 | 22 |
| gatt_disconnect_failed | 1 |
| gatt_resolution_throttled | 6 |
| fast_accepted | 22 |
| fast_requires_gatt | 22 |
| fast_metadata_unresolved | 16 |
| fast_length_27 | 22 |
| fast_info_prefix_17 | 22 |
| advertisement_error_failed | 10 |
| advertisement_attempt_compact | 11 |
| advertisement_discovery_idle | 11 |
| advertisement_retry_scheduled | 10 |
| scan_pause_advertisement | 3 |
| gatt_connection_error_timeout | 1 |
| advertisement_renewal_requested | 1 |
| advertisement_cleanup_requested | 1 |
| advertisement_cleanup_acknowledged | 1 |
| advertisement_cleanup_owner_closed | 1 |
| advertisement_failure_detail_controller_registration | 10 |
| scan_stop_requested | 27 |
| scan_stop_acknowledged | 27 |
| scan_owner_closed | 27 |
| adapter_generation_started | 1 |
| l2cap_transport_io_error | 1 |

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
