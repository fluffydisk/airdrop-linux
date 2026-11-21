# S24+ — Classic inquiry laboratory candidate

Status: **APPROVED; guarded setup verified and restored; Samsung validation pending.**
The owner approved the bounded four-property scope. One setup-only run applied
and verified it, then stopped before READY because startup telemetry was absent.
Independent rollback reported fullyRestored=true. No phone send occurred.
This is an opt-in experiment, not a confirmed root-cause fix or reliable support.

## Why this candidate

**MEASURED:** T34, with no headset attached to the Linux controller, received
49/49 exact fixture bytes and SHA-256
`b753383d7fabdf101bb7ce2c3cb6261ed9960e5212ece3bfc3b103ccfe7efbd7`.
Owner confirmed equal verification codes and phone-side “sent”. An LE supervision
timeout occurred after RFCOMM arrival but before consent; the file still completed.
This disproves treating every LE timeout as necessarily fatal to the file session.
USB attachment and elapsed time also differed from T33, so this is not a pure A/B.

**MEASURED:** after the owner reconnected Soundcore for T35, Linux inventory had
BR/EDR central + LE central links to that headset. BlueZ reported active AAC even
though the owner initially paused music; the owner later resumed video/audio.
T35 was NOT launched: the known simultaneous-role advertising restriction remains
relevant, and paused playback is not proof of zero AVDTP traffic. No link was cut.
Existing advertisement backoff is already2/4/8/16/30s and owner-bound Timeout0;
this candidate does not claim a new fix to that already present behavior.

**MEASURED:** Adapter1 Connectable=false while HCI page scan=true; inquiry scan=false.
Kernel `hci_update_scan_sync()` permits page scan for disconnected accept-list
entries, so Connectable=false alone is not proof of the observed connection failure.

**EXTERNALLY VERIFIED:** Google Nearby defines a Classic inquiry discovery name
and discoverability lifecycle, and its point-to-point handler supports Bluetooth:

- [BluetoothDeviceName codec, pinned6ce28aa](https://github.com/google/nearby/blob/6ce28aa417bb8b3c365629eccd667b72645df33b/connections/implementation/bluetooth_device_name.cc)
- [WebSafe Base64 implementation](https://github.com/google/nearby/blob/6ce28aa417bb8b3c365629eccd667b72645df33b/internal/platform/base64_utils.cc)
- [Classic discovery lifecycle](https://github.com/google/nearby/blob/6ce28aa417bb8b3c365629eccd667b72645df33b/connections/implementation/mediums/bluetooth_classic.cc)

**UNVERIFIED HYPOTHESIS:** stock Samsung Quick Share enables this discovery medium
and it can avoid opening the phone→Linux LE bootstrap connection during audio.
Success must be observed on the real phone, not inferred from these sources.

## Approved temporary radio scope

The current controller only, with original values read again at test start:

| Adapter1 property | Temporary requested value |
| --- | --- |
| Alias | Nearby-encoded local endpoint metadata; phone should decode lab display name |
| Connectable | true |
| DiscoverableTimeout | 90 seconds |
| Discoverable | true |

Nearby devices may discover the computer during this bounded visibility window.
The computer's Bluetooth name will temporarily look encoded in ordinary Bluetooth
settings. The initial real-phone window will be75seconds, one file, with active
headphone audio. There is no BLE advertising request in this mode, no override of
LE capability bits, no arbitrary LE disconnect, no service/controller reset, and
no codec/profile change. Existing native RFCOMM/SDP and UKEY2/consent remain in use.
The regular BLE mode and its behavior are unchanged unless this option is selected.

If the adapter is already discoverable, setup refuses to take over another
client's visibility. Any required authorization is noninteractive/fail-closed;
the diagnostic sudo terminal remains the separate, scoped workspace5 interface.

## Ownership, timeout and rollback

A private0600 functional checkpoint inside the new0700 lab session stores original
and expected properties. It is not a sanitized report and must not be uploaded or
copied into notifications; the original alias stays private.

An independent, detached Node watcher must acknowledge that checkpoint before
native setup changes any property. Setup writes the unique encoded alias first,
then connectability, timeout and visibility, then verifies actual property values.
The runtime reports `classicDiscoverable` separately and keeps `bleAdvertising=false`.
Property readiness is not proof of RF emission or Samsung discovery.

After first observing the fully enabled scope, the watcher checks the four
properties every two seconds and ends the lease on a detected external change.
Changes before that first observation can remain undetected until cleanup;
ownership checks still protect an externally changed alias from rollback.

The watcher restores on native scope stop, actual process exit (including an
unreaped zombie), or its90second monotonic lease deadline. Restoration checks
current ownership/values, restores visibility/timeout/connectability, and restores
the alias last. Partial errors retain the ownership marker for bounded retry;
errors and external property changes are reported, never converted to success.
A different alias is preserved as an ownership conflict. D-Bus property operations
are not an atomic transaction; concurrent external changes remain a limitation.
Visibility has the controller/BlueZ90second timeout; restoration itself is async,
with bounded calls/retries and a separately checked result. A failed rollback is
an intervention blocker, not a passed experiment.

Only this experiment's processes/files are cleaned. The foreground phone request
and verification-code comparison always require the owner; no real consent is mocked.

## Validation and fingerprints

- Full Node:309 passed, zero failed/skipped.
- Native Rust workspace:75 application +25 library passed before the readiness
  observation fix. Its isolated subprocess/real Unix datagram regression passed;
  the refreshed full suite is recorded in native-readiness-regression.log.
- Default Rust workspace:19 application +25 library passed.
- Updated private D-Bus wire contract: normal rollback, partial setup failure and
  actual SIGKILL of an owned synthetic client (left unreaped to test zombie handling)
  all restore the fake adapter. This test never uses the workstation BlueZ service.
- Headless Electron:1 passed; Chromium sandbox retained. A disposable network
  namespace and an empty private system/session bus prevent a real Samsung request
  from reaching the synthetic consent test; no ordinary desktop window is opened.
- Golden codec vector preserves exactly the full local advertisement's discovery
  identity and excludes its transport address/token. No independent identity is
  silently substituted.

Exact final helper/source hashes and test logs are under
`.cache/codex-s24-goal/t36-classic-inquiry/`. Starting HEAD remains
`23431854ecdcd264e23774b041d18e5e812ce8ad`; all pre-existing dirty work is preserved.
Nothing has been pushed, merged or published.

## Reproduction after explicit owner approval

Preparation (no radio settings changed):

```
bash scripts/quickshare-android-lab.sh --prepare --skip-install --ble-native --receive-only --classic --classic-inquiry --receiver-name 'Airdrop S24 T36' --workspace .cache/s24-codex-inquiry-36
```

Do not start the prepared workspace until the owner approves the four-property
scope above. The guarded launcher must confirm active AAC, healthy baseline graph
and HCI progress, actual workspace5 rules/window, the acknowledged rollback watcher,
classic property readback and actual RFCOMM registration before READY. Request one
fresh native Quick Share send to the distinct T36 label; codes/consent stay manual.
Stop owned receiver and trigger rollback on an observed>=500ms audio progress gap,
long active-audio queue stall, failure, deadline or15seconds after a verified receipt.
Check file bytes/hash, phone result, code confirmation and rollback result separately.

A successful first test still leaves the requested ten consecutive active-audio
small transfers, larger files and different initial connection states unverified.

## Setup-only diagnostic correction

MEASURED: the first profiler window had a223.949ms follower interval while the
Bluetooth driver max was11.653ms, newXRUN0 and deadline0. The strict gate aborted;
subsequent fresh windows passed without relaxing thresholds. A later setup reached
Classic property readback and RFCOMM registration on workspace5. It then stopped
because the new Classic-ready path did not emit the event that initializes the
lazy application trace. The first trace event was owner-stop, confirming the
instrumentation gap. No Samsung request was invited. Rollback fullyRestored=true.
The correction emits numeric radio-stage7 on Classic-ready, matching existing
legacy-advert-ready observation semantics; it changes no transport/radio policy.
A fresh child-process test verifies trace-start then stage7 arrive over a real
Unix datagram socket before any phone connection. Original capture is retained;
the pending phone experiment uses fresh retry/ evidence and a fresh lab session.
