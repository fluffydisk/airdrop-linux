# Native Samsung Quick Share: evidence checkpoint

**Incomplete — real transfers have succeeded, but reliable interoperability has
not been established.** No changes were pushed, merged, released or installed
system-wide. The latest reporting fix has one clean real-phone transfer; reliability remains unresolved.

## Environment

- Branch: `fix/quickshare-s24-post-consent-transfer`, starting commit
  `23431854ecdcd264e23774b041d18e5e812ce8ad`, with local changes.
- Omarchy 4.0.6; Linux 7.2.8-9-omarchy; BlueZ 5.87-2;
  Realtek btusb 0BDA:B00A / RTL8821C; rtw88_8821ce Wi-Fi.
- Original phone: Galaxy S24+ SM-S926B, Android 17 / SDK 37.
  Control phone: Samsung A13, identified by owner.
- Later comparisons: home LAN, tethering off. Observed Wi-Fi: 5500 MHz.
- Headset: Soundcore BR/EDR. Temporary, explicitly approved SBC comparison
  completed; original AAC profile and active codec were independently restored.

## Real-device outcomes

| Condition | Independently verified result |
| --- | --- |
| Second Samsung A13 | One 49-byte receipt, exact fixture bytes/hash |
| Original S24+, video paused, headset connected | Two distinct 49-byte receipts, exact bytes/hash |
| Original S24+, video/audio active | Two further 49-byte receipts across two captures; other attempts failed |
| Same receiver, audio resumed after two paused successes | Accepted transfer failed at 0/49, peer GATT status 8 |
| Original S24+, explicitly approved temporary headset-off control | First attempt completed, 49 bytes with exact fixture hash; AAC/headset restored afterward |
| Labeled T21, active AAC audio | First send failed before code; second verified 49/49 bytes, exact hash; receiver then stopped |
| Temporary SBC | Early connection failures, no accepted transfer or receipt; post-consent comparison untested |

All seven verified receipts (six S24+, one A13) match fixture SHA-256:
`b753383d7fabdf101bb7ce2c3cb6261ed9960e5212ece3bfc3b103ccfe7efbd7`.
A prior phone “sent” display without a disk receipt remains unverified. Cumulative old receipts do not establish success of a later attempt.
Internal bootstrap/retry counts are not counts of manual sends. Owner confirmed
matching codes in earlier S24+ trials; consent acceptance is recorded separately.

## Confirmed findings and limits

1. **Advertising restriction:** kernel tracing observed pre-disable `-EINVAL`
   with active LE roles and absent simultaneous-state bits 35/38. No-LE controlled
   runs registered and renewed after 90 seconds. A later real-transfer run also
   renewed successfully with no persistent LE link. Other runs lost renewal with
   peripheral LE present. Registration alone does not prove RF emission or discovery.
2. **Physical transport timeout:** Linux HCI reason 8 and S24+ GATT status 8
   coincide with accepted transfers receiving 0/49. Successful and failed links
   both used interval 12 / latency 1, so that parameter alone is not the cause.
3. **Common packet stall:** unsuccessful active-audio attempts show simultaneous
   ACL/LE completion gaps. USB requests were directly submitted without reported
   submit/send/callback errors, but completion latency reached 2.335419 seconds.
   Observed completed HCI TX/RX workers and packet-completion handlers did not
   spend seconds blocked. This narrows the device/USB path; it does not identify
   firmware, controller scheduling, RF coexistence or USB hardware as the root cause.
4. **Audio is associated, not a universal trigger:** active audio also allowed
   verified transfers. The owner reported brief audio gaps and one headset
   disconnect/reconnection; the LE-only trace did not capture that headset's reason.
5. A shared-buffer RFC for a different controller is not proof of this device's
   pool semantics. No quirk, firmware, power policy, module or radio reset was applied.

## Repository changes

- Explicit native receiver-only laboratory mode, with helper acknowledgement and
  outgoing BLE discovery disabled only when requested.
- Truthful UI wording distinguishing BlueZ registration from Samsung visibility.
- Normal metadata-finish/EOF handled independently of file completion.
- **Latest fix:** failed/cancelled/timed-out discovery bootstrap retains connection
  diagnostics without inventing a disconnected 0/0 file transfer. Real data-session
  failures remain visible. Independent encrypted peer tests use the production
  incoming handler; raw/framed malformed input, timeout and cancellation regressions
  cover the boundary. This fixes reporting, not the USB/controller stall.
- Validated per-run receiver names distinguish current phone tests from stale recipients.
  Source fingerprints include new untracked modules and exclude build output.
- Bounded, scalar-only controller-role, connection, packet/USB flow probes and a
  read-only connection inventory. No addresses, keys, codes or payloads exported.

## Automated verification of latest source

- Node: 287/287 pass, no skips (`npm test`).
- Native BLE + FastInit Rust workspace: 63 application + 23 library tests pass.
- Default Rust workspace: 16 application + 23 library tests pass.
- Sandboxed headless native/receiver-only desktop lab: 1/1 pass on a private
  empty system D-Bus, so this check cannot touch the physical Bluetooth adapter.
- Formatting and diff whitespace checks pass. Clippy completes with warnings.
- A broader earlier desktop run had an unrelated headless clipboard failure;
  this report does not claim every desktop/environment suite is green.

Key commands: `cargo test --manifest-path network/quickshare/Cargo.toml --workspace
--features ble-native,ble-fastinit`; default workspace test; `cargo fmt --check`;
`cargo clippy ... --all-targets`; `node scripts/build-quickshare.js --ble-native`.
The independent Python peer uses a private local cryptography environment.

## Session protection and resumption

Original AAC profile and headset connection were independently restored after the
approved headset-off control. A new bounded T21 receiver trial is staged; current
status is `.cache/codex-s24-goal/CURRENT-TEST.md`. Recent visible test windows were
checked on workspace 5. Earlier isolation incidents and corrections remain in the
[controller evidence](quickshare-s24-controller-baseline.md); perfect historical
focus isolation is not claimed. No services, firmware or modules were restarted.

Private progress and sanitized evidence remain in `.cache/codex-s24-goal/` and
individual `.cache/s24-*` labs. Nothing was uploaded. The installed Omarchy kernel
already backports the reviewed ACL/LE scheduler locking fix; reapplying it is not
justified. A lab-only pacing prototype was removed after inconclusive hardware
correlation; it is not part of the retained implementation.

Delayed chat messages were initially associated with the wrong attempt. The owner
clarified that the latest manual send showed no phone error. No new disk receipt
was found during the subsequent audit, so its outcome remains unverified. T21 uses
a unique recipient name and a ready notification to establish an unambiguous live
window. It does not stop solely on unrelated global Android GATT errors.

No second Bluetooth controller is available. Reliable mixed-audio interoperability
remains unresolved; do not claim the goal complete from isolated successes.

## T21 update

The unique live receiver produced a new independently verified receipt at
23:51:09 UTC on November 15. The owner reported first-send failure before code
and second-send success. The first attempt has phone GATT status 8 and a
pre-consent data-session interruption; no kernel/USB trace was running, so its
lower-layer cause remains unresolved. Three bootstrap failures are internal
events, not three manual sends. Active AAC media was sampled throughout.
Advertising renewed after 90 seconds but also logged two registration failures
and subsequent retry success; this is not proof of reliable renewal. The bounded
receiver stopped after disk/hash validation. A proposed third send must wait for
a new ready notification.

## November 17 local-time update: T22–T28

Later LE trials narrowed but did not resolve the failure: smaller CoC SDUs still
failed after consent; the experimental kernel TX-completion gate consumed five
real reports then stalled before file receipt. Neither prototype established a
production fix. The real-time host/USB evidence still does not identify the exact
controller/firmware/radio cause.

Owner-bound advertising now uses Timeout=0 and retains cleanup on hide/shutdown
and bounded retry after actual removal. A private-D-Bus 131-second regression and
real-controller 130-second observation crossed the former 90/120-second window
with one registration and no failure. Registration is not proof of RF visibility.
Controller enumeration now selects the sole actual adapter even after hci0→hci1
renumbering and rejects ambiguous inventories.

T27 introduced a default-off native Classic RFCOMM lab path, with an application-
owned socket and matching BlueZ SDP record registered before advertising the
actual adapter MAC. Google Nearby's pinned implementation supports this path.
One **real S24+ 49-byte transfer** through `bt-rfcomm` completed with explicit
consent and exact fixture bytes/SHA-256, while AAC media remained active. This
raises audited receipts to seven S24+ and one A13 across the investigation.
The owner now reports intermittent ~100ms audio microcuts since receiver startup.
The short T28 off/on/off host-timing comparison found no new xruns or deadline
misses, which does not establish audible continuity or refute that report.
See [measurement and limitations](quickshare-s24-audio-measurement.md).

Latest completed pre-T28 suites: native Rust 74+23, default Rust 17+23, Node
290/290, private-bus headless UI 1/1. T28 adds a regression for the privacy-
preserving audio timing reducer; subsequent Node results are in the progress
checkpoint. No Rust implementation changed in T28. The lab GUI uses its own
unique class; T27's 72 and T28's 42 window samples stayed on workspace 5. Receivers
are stopped. No services or audio profiles were reset. Goal remains incomplete.
