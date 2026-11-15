# S24+ inbound LE CoC interruption and Realtek controller reset

This change is an application lifecycle mitigation, not a demonstrated firmware,
kernel or Samsung interoperability fix. BLE-native remains opt-in; the default
helper and previously verified encrypted LAN transfer path are preserved.

## Physical evidence and its limits

The owner tested db064ad7272ec2e3c87f1b1d31194633519664d0 on November 15,
2026. The uploaded `s24-visibility-01-sanitized.tar.gz` contains three sanitized
reports, not the underlying journal or a core dump. A minimized reviewed fixture
is in `tests/fixtures/quickshare-s24-hci-reset.json`, with the archive SHA-256.
The supplied screenshots and quoted kernel/BlueZ/WirePlumber excerpts are
separately attributed owner evidence. Personal phone/account labels and images
are not copied into this repository or default reports.

Archive timeline (UTC; CET = UTC+1):

| Time | Direct runtime observation |
| --- | --- |
| 10:32:07.302 | Own scan lease reported active |
| 10:32:08.039 | Own scan lease closed; sampled scanning false |
| 10:32:08.688 | First LE CoC bootstrap attempt disconnected |
| 10:32:09.858 | Second incoming connection, `ble-l2cap` |
| 10:32:09.958 | `ReceivedConnectionRequest` |
| 10:32:09.965 | `SentUkeyServerInit` |
| 10:32:10.044 | `ReceivedUkeyClientFinish` |
| 10:32:10.046 | `SentConnectionResponse` |
| 10:32:10.090 | Disconnected; no payload |
| 10:32:10.545 | Advertisement Release observed |
| 10:32:10.546 | Adapter unavailable |
| 10:32:15.566 | New adapter/GATT setup reported prepared by the old build |
| 10:32:18.354 onward | Advertising registration rejected |

The owner saw the recipient, selected it, and saw connecting followed by error.
Recipient visibility alone does not prove BLE discovery. The runtime connection
method establishes actual incoming BLE/LE CoC bootstrap and Nearby/UKEY2
processing. It does not establish completed mutual authentication, user file
consent, finalization or transferred bytes. `SentConnectionResponse` follows
server-side key derivation and initial setup output; no authenticated peer
acceptance/final file result was established. `captureOutcome=completed` only
means collection finished. The archived owner completion answer remains UNKNOWN;
the later explicit owner failure observation is preserved separately.

The owner's kernel excerpts show LE Set Scan Enable (0x200c) timing out while
stopping scanning, followed by USB reset and hci0 -> hci1. WirePlumber also crashed
in libspa-bluez5.so. These excerpts have second precision and unknown delivery
latency relative to the application events. They cannot establish whether a
protocol rejection caused the disconnect, a failing controller interrupted a
valid handshake, or the audio crash preceded/followed the underlying fault.
The two unexpected vendor 0xfc19 events are evidence of abnormal controller
traffic, not an identified application command or a demonstrated cause.

Final archive totals: 1/11 advertisements registered; 10 rejected, 2 GATT
registrations, 2 LE CoC binds/accepts, 1 bootstrap rejection, 1 Nearby connection
message, 2 UKEY2 progress events, zero completed file transfers. The one Fast
candidate remains unattributed. A separate successful owner trace of initial
registration and renewal demonstrates that this controller can configure this
advertisement under some conditions; it does not prove reliable RF emission.

## Source-backed application defects corrected

`bluer` 0.17.4 `discover_devices()` owns a SingleSessionToken. Dropping its stream
schedules an asynchronous StopDiscovery; the old helper recorded `scan_closed`
and immediately continued connection/advertising work without observing its
reply or failure. An inactive sampled flag therefore did not establish stop
completion. BlueZ 5.87 `src/adapter.c` distinguishes these cases:

- If this is the last discovery client and scanning is enabled, StopDiscovery
  defers the D-Bus reply until the MGMT stop callback.
- With other discovery clients, or in an idle discovery phase, releasing this
  client's lease can reply without establishing controller-wide RF idle.

The helper now owns each scan on a separate D-Bus connection, preserving the
same LE/duplicate-data/non-discoverable filter. It subscribes to bounded device
observations without starting a second bluer-owned discovery lease. A bounded
StopDiscovery reply and owned I/O teardown precede bootstrap, outbound GATT/LE
CoC work and advertising replacement. Cancellation of a caller does not cancel
or detach an unbounded stop: its bounded task is retained and joined before any
new start. A stop/start failure invalidates this generation; it does not keep
issuing radio operations. No global discovery session is stopped.

The old run loop also returned early on health errors before its normal async
teardown, and its outer cancellation select could discard the run future.
Every loop exit now runs teardown: cancel/join owned sessions and GATT workers,
join the discovery stop, release owned advertising, drop the GATT/listener
handles, expire BLE routes and invalidate ownership. LAN routes remain separate.
After adapter loss it does not issue Device.Disconnect against stale paths that
may now refer to another connection. Normal live-generation cleanup still
releases only GATT connections claimed after refusing already-connected devices.

Adapter removal and powered-down events invalidate a generation even if a new
controller reuses the old index. Recovery retains the original adapter identity
only in memory, finds it at its new index, and refuses unrelated controllers
which happen to acquire the default index. No Bluetooth identity is exported.
Capabilities are read from that same adapter, not a second default selection.
Recovery waits 5/10/20/30 seconds between failed generations, with an additional
read-only two-sample powered-state interval. Queued sends cannot shorten the
cooldown. Background scanning after a failure remains suppressed until fresh
receiver advertising registers; replacement/renewal is deferred while sessions
hold permits. These are bounded application precautions, not a controller
health certificate. The prepared stage is now `adapter-prepared`, separate from
successful `advertisement-registered`.

The added counters distinguish scan stop request, acknowledgement, timeout,
failure, unobserved drop, owner closure, adapter generations/index changes,
invalidated handles, forced teardown, recovery waits and scan suppression.
Inbound core errors/timeouts and LE CoC EOF/I/O/timeouts are recorded separately
from adapter loss. All fields remain closed-schema numeric counters or fixed
stage strings; no raw error messages, payloads, addresses, keys or codes export.
The deep report now identifies runtime interruption and incomplete inbound
handshakes without inventing a root cause or file success.

Sources inspected:

- bluer 0.17.4 `src/adapter.rs` discovery_session and `src/session.rs`
  single_session: https://docs.rs/crate/bluer/0.17.4/source/src/adapter.rs
- BlueZ 5.87 discovery_stop/stop_discovery_complete:
  https://github.com/bluez/bluez/blob/5.87/src/adapter.c
- BlueZ 5.87 advertising registration/error mapping:
  https://github.com/bluez/bluez/blob/5.87/src/advertising.c
- Linux v7.2.8 add_ext_adv_data, error conversion and legacy enable path:
  https://github.com/gregkh/linux/blob/v7.2.8/net/bluetooth/mgmt.c
  and https://github.com/gregkh/linux/blob/v7.2.8/net/bluetooth/hci_sync.c
- Published linux-omarchy 7.2.8-9 patches inspected in the preceding MGMT audit:
  https://github.com/omacom/omarchy-pkgs/tree/cc664d884b8400accad0e02347c39d6b2cd6b688/pkgbuilds/linux-omarchy

## Kernel/BlueZ boundary still unresolved

The 17-byte compact header and 24-byte conservative legacy budget are unchanged.
Post-reset org.bluez.Error.Failed / MGMT Invalid Parameters is not proof of a
malformed payload. This kernel can emit 0x0d for a missing instance, TLV rejection,
an asynchronous host -EINVAL, or a converted controller error. The legacy
is_advertising_allowed state gate is one possibility; the headset's presence
and the BlueZ central/peripheral roles do not establish the required LE link
counts or supported-state bits. No new post-reset MGMT/function trace identifies
which branch failed here. The historical extra-eight-byte command bug does not
match a correctly sized command and its fixes are present in the matching
versions. No kernel bypass, parameter relaxation, firmware changes or audio
service workaround is implemented.

## Automated validation scope

The regression suite uses real private D-Bus exchanges with an independent peer,
not a physical controller. It covers delayed and missing stop replies, failure,
caller cancellation, restart serialization, changed index and an unrelated
controller at the old default index. The actual runtime is driven through
adapter removal, fresh GATT setup, three advertisement rejections and recovery;
no stale registrations or recovery scans against unrelated controllers are
allowed. A separate independent-byte LE CoC peer verifies that bootstrap waits
for scan-stop acknowledgement, reaches UKEY2 ServerInit, and interrupts safely
when cancelled during the handshake. Its dummy commitment is never treated as
authentication. Virtual-time tests cover cooldown/cancellation. The captured
physical timeline is a provenance-aware report fixture, not a mock success.

Run the existing CI commands in `.github/workflows/quickshare-validation.yml`.
They cover default/FastInit/native Rust, private D-Bus regressions, Node/lab
privacy and lifecycle, independent Python cryptography and BLE wire oracle,
isolated network transfers, and sandboxed Electron. Normal CI needs no Android
or Bluetooth hardware. Passing CI does not establish controller stability or
Samsung-to-Linux compatibility on the new commit.

## Smallest safe owner retest

A controller reset can still affect every device on that controller. The app
never disconnects unrelated devices or changes Bluetooth policy, but cannot
promise to protect an active audio session from a kernel/firmware fault. Choose
a time when the headset is not carrying a call or important audio; leave its
connection/settings unchanged. Do not use this session to restart services,
reset/power-cycle the adapter or repeatedly retry a failed connection. Stop the
lab on the first headset interruption, controller reset or new service crash.

```sh
git fetch origin
git switch fix/quickshare-realtek-hci-recovery
git pull --ff-only origin fix/quickshare-realtek-hci-recovery

bash scripts/quickshare-android-lab.sh --preflight
bash scripts/quickshare-android-lab.sh --prepare --ble-native \
  --workspace "$PWD/.cache/s24-hci-recovery-01"
bash scripts/quickshare-android-lab.sh --diagnose \
  --direction samsung-to-linux --network ordinary --duration 210 \
  --workspace "$PWD/.cache/s24-hci-recovery-01" --archive
```

Use a fresh workspace name on each trial. Source/build provenance and helper
hash must match. Keep both devices on the ordinary home LAN. USB/ADB is optional
and is not needed for this first retest. Let registration settle, follow the
baseline prompt, open native Samsung Share with the generated 49-byte fixture,
and mark ANDROID_SEND_OPEN. Select Linux once if shown. Compare any verification
codes privately, then explicitly accept only in the Linux native receiver UI.
Do not treat connection establishment as file consent.

Record these outcomes independently:

| Checkpoint | Required evidence |
| --- | --- |
| Controller stable | No new HCI timeout/reset, headset interruption or service crash during the bounded trial; absence from a restricted log source remains unknown |
| BLE registration | New successful registration; separately record renewal and cleanup acknowledgement |
| Samsung visibility | Owner saw the lab recipient; do not infer discovery medium solely from the UI |
| Inbound LE CoC | Runtime incoming `ble-l2cap`/bootstrap events |
| UKEY2/mutual authentication | Named protocol progress and matching private comparison, followed by authenticated session progress; response-sent alone is insufficient |
| Consent | Explicit Linux receiver acceptance |
| Complete transfer | Receiver finalization and phone UI completion, not captureOutcome |
| Byte integrity | Independent SHA-256 of the received fixture matches the source |

The expected lab-small.txt SHA-256 is
`b753383d7fabdf101bb7ce2c3cb6261ed9960e5212ece3bfc3b103ccfe7efbd7`.
If a file completes, independently hash its published Linux copy and the source
fixture. Only then record delivery/integrity as passed. After a stable inbound
trial, repeat the previously verified Linux-to-Samsung 49-byte LAN fixture as a
separate regression trial, recording its actual transport and independent bytes.

On a fault, press Ctrl+C in the diagnostic terminal so the runner's finally
block preserves active evidence and writes the sanitized reports. Then, if
needed, stop only this workspace:

```sh
bash scripts/quickshare-android-lab.sh --status \
  --workspace "$PWD/.cache/s24-hci-recovery-01"
bash scripts/quickshare-android-lab.sh --stop \
  --workspace "$PWD/.cache/s24-hci-recovery-01"
```

Return the three sanitized report files or their generated sanitized archive
from this workspace's reports directory. State whether the headset/service
fault recurred and which checkpoint failed. Default reports do not contain raw
journal/logcat/HCI traces or phone identities, and upload nothing automatically.
Keep any separately consented raw logs/core dump local; provide only reviewed
opcode/status/time summaries if further kernel discrimination is needed.
