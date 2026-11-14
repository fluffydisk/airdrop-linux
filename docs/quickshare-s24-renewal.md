# S24+ initial registration and renewal failure at 4ad207f

Reviewed physical archive: `s24-bluez-test-4ad207f.tar.gz`, SHA-256
`9af4cedc351591e6152441ae0586c309370d684850684d5f028a8c42e60c8803`.
The report verifies clean source/helper provenance for
`4ad207f131b2057b9eef8cfe4be3c36fcad5177e`. A minimized fixture retains the
runtime facts and the separately supplied owner UI-negative observation; the
archived confirmation answers remain unknown rather than being rewritten.

## What the physical evidence establishes

On 14 November 2026 (CET; the archive retains UTC):

| Event | CET | Provenance |
| --- | --- | --- |
| First compact/GATT registration succeeded | 21:53:23.691 | Direct runtime observation |
| Samsung native sender view marked open | 21:54:24.029 | Owner action marker; owner independently reports no Linux recipient |
| First replacement registration failed | 21:54:53.848 | Direct runtime observation |
| Seven subsequent retries failed | 21:54:56.098–21:56:55.598 | Direct runtime observation |

There was one success, eight `org.bluez.Error.Failed` replies and one **local
handle release**. The first failure is 90.157 seconds after success. The sender
view overlapped the initially retained registration by about 29.819 seconds,
but the owner saw no `Airdrop S24 Lab`. No incoming authenticated connection or
transfer was recorded. **Registration is not RF-emission or discovery evidence.**

No `advertisement_daemon_released` callback count was recorded by the instrumented
build. This means no callback was observed; it does not prove that the controller
advertised continuously or that a daemon notification could never have been lost.
The code intentionally initiated local withdrawal of its 120-second advertisement
at the 90-second renewal point. This was not evidence of the lease naturally lasting 120 seconds
or expiring early. The old build recorded neither unregister acknowledgement nor
publisher teardown completion. It does not establish that unregister succeeded
or that the controller stopped the first advertising instance.

Sampled five free instances, zero active instances and idle discovery before
failed registrations do not establish continuous controller idle. BlueZ's
`ActiveInstances` counts its client bookkeeping, not completed kernel removal.

Separately, the capture has 25 FEF3 observations, 15 strict Fast acceptances,
12 failed resolution requests, five timed-out link connection attempts, five
failed disconnects, four retained-owner refusals, three ownership-capacity
refusals and three throttled resolutions. No BLE endpoint became ready. These
are unattributed remote observations, not Samsung identities, and are independent
of Linux's local advertising cleanup.

## Source-backed defect and bounded change

At `4ad207f`, `advertisements.clear()` ran the handle destructor. That destructor
spawned `UnregisterAdvertisement` asynchronously; the renewal path then proceeded
toward a fresh registration without waiting for it. Partial extended-advertisement
fallback also relied on a destructor plus one executor yield. That is an actual
software ordering gap. The capture makes it a plausible contributor to renewal
failure, not a proven explanation for all eight failures or initial non-visibility.

BlueZ 5.87 (`65d11edee469c24dcc8d075b8be9c040cebaaf98`),
`src/advertising.c`: `unregister_advertisement()` calls `client_remove()`, which
queues `MGMT_OP_REMOVE_ADVERTISING` without a completion callback, removes the
client from the queue and schedules deferred freeing. The method returns after
that. Thus even its acknowledgement and zero active clients cannot prove the
controller finished removal.

The new normal renewal/fallback/visibility/shutdown paths await cleanup. Cleanup
records a one-second unregister result, joins the aborted publisher I/O task
with a 500 ms bound, drops the owned connection scope, and leaves a 250 ms guard
interval. The guard is a bounded scheduling precaution, **not proof of controller
completion or a Samsung-specific timing requirement**. Two possible advertisement
handles clean up concurrently, keeping the normal barrier below two seconds.
Incomplete cleanup prevents immediate replacement and uses bounded backoff.
Destructor cleanup remains an observed safety fallback for cancellation/unwinding.
No other client's discovery, advertisement, connection or radio policy is changed.

`diagnostics.advertisingCleanup` and
`bluetooth.receiverAdvertising.lastCleanup` expose only closed-schema reason,
unregister result/error category, registration age versus lease, observed daemon
Release before/during cleanup, I/O stop, owned-scope closure and guard/duration.
Registration attempts identify initial/renewal/retry triggers. A cancelled cleanup
can remain pending; it is never automatically reported complete. Registered API
state, observed daemon callbacks, phone UI visibility and RF proof stay separate.

Generic Failed replies additionally classify **exact known public BlueZ message
literals** as controller-registration, registration-incomplete or parameter-parsing.
All other bodies produce unknown. No body, identifier, address, path, key, packet
bytes or arbitrary error name is exported. This narrows the next observation
without fabricating the original error body or exposing logs. The daemon may
still hide its MGMT status code.

The independent private D-Bus peer now models a delayed unregister reply and
rejects overlap. Tests cover first registration, replacement, repeated injected
registration failures, unregister error/timeout, already-removed after Release,
recovery, cancellation during cleanup, explicit shutdown, and previous-owner
absence. A separate test blocks immediate compact fallback after incomplete
partial-dual cleanup. These are API/state-machine tests, not Bluetooth hardware.

TCP, UKEY2, encrypted framing, consent, file limits/staging and transfer outcomes
are unchanged. The [verified 49-byte forward LAN fixture](quickshare-s24-physical-evidence.md)
remains a result at its actual tested commit. No merge or release.

## Smallest useful next physical session

One **210-second** ordinary-home-LAN session covers the first registration and
usually two 90-second replacement boundaries. Keep both radios, LAN and Samsung
settings unchanged. Use authorized USB debugging; no tethering, root, companion
APK or raw capture is required. Use an unused workspace.

```bash
git switch fix/quickshare-protocol-hardening
git pull --ff-only origin fix/quickshare-protocol-hardening
bash scripts/quickshare-android-lab.sh --diagnose --adb \
  --direction samsung-to-linux --network ordinary --duration 210 \
  --workspace "$PWD/.cache/s24-renewal-04" --archive
```

Complete the baseline prompts promptly. Open the native Samsung sender list as
soon as instructed and keep the phone awake and that view open across both
replacement boundaries. Record appearance/disappearance times; do not enter
`pass` to skip a confirmation. A transfer is optional for this registration test;
if attempted, compare codes and consent explicitly in Linux.

For initial **RF** visibility, an independent BLE receiver is required: for
example a second Linux controller/machine with a read-only scanner, identifying
the lab through matching endpoint metadata (or a separately consented local
comparison with its expected FEF3 data) during a controlled baseline. An
unattributed FEF3 count is insufficient. Do not send addresses or payloads in the
default diagnostic bundle. No extra Android APK, HCI snoop or privileged logging
is enabled automatically. If no independent receiver is available, this session
can validate API renewal and owner UI visibility; actual initial RF emission
must remain UNKNOWN. A phone failing to list Linux cannot distinguish missing RF
from filtering or bootstrap behavior. LAN-enabled UI appearance alone would also
not prove a BLE discovery path.

Review initial/renewal/retry triggers, `lastCleanup` acknowledgement and owner-scope
closure, daemon-Release flags and registration success/failure counts together.
Expect cleanup completion before replacement attempts. Successful API renewal
still does not establish Samsung discovery. If generic Failed persists, compare
its static `failureDetail` and cleanup result before proposing another fix.
Return only `reports/quickshare-deep-sanitized.tar.gz`, UI timings and any explicitly
identified independent-observer conclusion with its provenance. Raw captures and
logs remain excluded. No hotspot or Apple-sharing sweep is needed for this case.

## Automated validation

Cloud regressions pass without a phone/controller: Node 270/270; Rust workspace
default 39, FastInit 41 and native BLE/FastInit 67, including both real private
D-Bus scenarios and incomplete partial-fallback cleanup. Formatting and clippy
pass with existing vendored warnings. Default/native helper lifecycle tests
pass, the independent Python commitment/MAC/replay/decline/empty/binary peer
passes all six cases, the BLE wire oracle passes, and both sandboxed Electron
laboratory variants pass 2/2. The Node installer test uses a disk-backed TMPDIR
because its Rust build cache exceeds this cloud's small /tmp mount. No test was
weakened. Privileged namespace transfer checks run in CI; current run links and
conclusions are recorded in PR #21. These results are not physical acceptance.
