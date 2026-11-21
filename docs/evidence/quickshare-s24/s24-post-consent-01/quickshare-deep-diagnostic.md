# Quick Share deep diagnostic

Commit: 23431854ecdcd264e23774b041d18e5e812ce8ad · helper SHA-256: c22ea8be496aaeb287c45119a035c879dceeee00037d509e1218665f0902fa95
Direction: samsung-to-linux · network: ordinary · capture outcome: completed

**Production compatibility acceptance: not established. Single-fixture evidence is separate.**

FEF3 observations: 7; decoded: 0; GATT-resolved: 0; ready: 0.
ADB: not-requested; log visibility: unknown.
Shutdown: clean-stop. Transfer: unconfirmed.

Runner failure stage: unknown. Clock alignment: sampled offset envelope; unsampled drift and log delivery delay remain unknown.
## Findings

- [Direct runtime observation] 10 local BlueZ advertisement registration attempts failed with no registration success recorded. This is a local receiver-advertising boundary, separate from scanning remote Fast candidates. GATT service registration and an available LE CoC socket do not establish advertising or phone visibility. The old generic error counter cannot identify the BlueZ rejection cause.
- [Direct runtime observation] 7 FEF3 service-data observations reached Linux; the decoded-candidate status remained zero. Parsing, validation and filtering must be distinguished by the new counters. These are observations, not distinct phones, and Samsung attribution is UNKNOWN.
- [Direct runtime observation] 7 strict Fast parser acceptances did not produce a resolved endpoint. Connection attempts/failures and missing metadata concern Linux scanning remote candidates; those candidates are unattributed and do not explain local advertising rejection.
- [Direct runtime observation] GATT metadata resolution or slot reads failed. Review connection, service, slot and categorized D-Bus counters; this is distinct from Weave negotiation.
- [Unknown] No packet is attributed to Samsung by this report. Network limitations, Android service visibility, unsupported formats and radio behavior require controlled comparison; timestamp proximity alone is not causality.

## Session boundaries
No categorized session diagnostics in this captured build. Transport error cause remains unknown.

## Local receiver advertising

BlueZ registration: 0 succeeded / 10 failed / 10 requested. GATT service registered: true; LE CoC socket bound: true. Independent RF transmission: unknown.
Last attempt: phase=bluez; mode=compact-gatt; result=failed; error=org.bluez.Error.Failed; category=failed; detail=controller-registration; trigger=retry; service bytes=17; conservative legacy bytes=24; type=peripheral; secondary=none; discoverable=adapter-default; discovery=idle; own scan paused=true; retry=30s; available/active instances=5/0.

Awaited cleanup evidence: unavailable in this captured build. A local handle drop is not a recorded BlueZ Release callback.

## Rejection and lifecycle counters

| Counter | Count |
| --- | ---: |
| scan_start_requested | 19 |
| scan_start_success | 19 |
| scan_windows | 19 |
| scan_closed | 18 |
| scan_ms | 44012 |
| scan_pause_ms | 142254 |
| scan_pause_regular | 10 |
| scan_pause_session | 5 |
| cache_replay_suppressed | 3586 |
| scan_watcher_limit | 62 |
| adapter_ready | 1 |
| dbus_other_error | 5 |
| fef3_observations | 7 |
| candidate_distinct | 3 |
| candidate_repeated | 4 |
| gatt_resolution_requested | 5 |
| gatt_resolution_failure | 5 |
| l2cap_bind_success | 1 |
| l2cap_psm_accepted | 1 |
| gatt_registration_requested | 1 |
| gatt_registration_success | 1 |
| advertisement_registration_requested | 10 |
| advertisement_registration_failure | 10 |
| advertisement_released | 0 |
| full_reject_unsupported_fast_format | 7 |
| compact_reject_invalid_length | 7 |
| length_25_31 | 7 |
| version_2 | 7 |
| gatt_resolution_throttled | 2 |
| fast_accepted | 7 |
| fast_requires_gatt | 7 |
| fast_metadata_unresolved | 5 |
| fast_length_27 | 7 |
| fast_info_prefix_17 | 7 |
| advertisement_error_failed | 10 |
| advertisement_attempt_compact | 10 |
| advertisement_discovery_idle | 10 |
| advertisement_retry_scheduled | 10 |
| scan_pause_advertisement | 3 |
| advertisement_failure_detail_controller_registration | 10 |
| scan_stop_requested | 18 |
| scan_stop_acknowledged | 18 |
| scan_owner_closed | 18 |
| adapter_generation_started | 1 |

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
