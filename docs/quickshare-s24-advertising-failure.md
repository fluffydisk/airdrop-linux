# S24+ reverse-discovery failure: advertising boundary

The reviewed physical capture is `quickshare-samsung-to-linux-failed.tar.gz`,
SHA-256 `72471065744c05142b1e8866c912cf11e0c591edc1e59b866b71ccc1be307d8c`.
It identifies clean, source/helper-verified application commit
`e130915a418a86017167e4f11b0d2151a8e643bd`, with `ble-native` enabled.
The observation window was 300.280 seconds on ordinary home LAN. The archive
retains UTC timestamps; the capture started at 01:17:36 CET on 12 November 2026
(00:17:36Z). Only a minimized reviewed fixture is committed, not the archive.

The owner's earlier observation of `Airdrop S24 Lab` appearing for approximately
five seconds is separate. This later capture does not establish when that
occurred, its transport, or a reason for its disappearance. No reverse transfer
or authenticated connection is established by either observation.

## Direct runtime observations

- 148 advertisement registration requests, 148 failures, no successes;
  `bleAdvertising=false` throughout all 223 Bluetooth timeline events. The first
  failure precedes this helper's first scan, so its own simultaneous scanning
  cannot explain that initial failure. Other discovery clients remain unknown.
- Local GATT service registered once; LE CoC socket bound once. Neither proves
  advertisement registration, transmission or phone visibility.
- 33 successful scan windows. Seven 27-byte FEF3 observations passed the strict
  legacy Fast subset; two ephemeral candidates and five repeats are observations,
  not physical phone counts. No candidate is attributed to Samsung.
- Seven GATT resolutions failed. Two made connection attempts and failed;
  both subsequent disconnects failed. Five resolutions failed immediately
  without another connection attempt. Decoded/resolved/ready remained 0/0/0.
- Linux inbound TCP listener was reachable; own mDNS was observed. No native
  recipient, incoming Nearby connection, UKEY2 or transfer event was recorded.
  Shutdown was clean, not a runtime crash.
- Android USB was authorized, but Bluetooth service output hit the collector
  bound, Wi-Fi command failed, and logcat was only partially readable. One
  process-start category cannot establish Quick Share behavior or permissions.

**Confirmed failure boundary:** the local BlueZ `RegisterAdvertisement` API,
prior to any independent proof of RF emission. The capture discarded its precise
error name/body. Its generic `dbus_other_error=150` is consistent with the 148
advertising errors plus two connection errors. No unsupported-operation,
permission, busy or invalid-value category was recorded. A generic BlueZ Failed
reply can still conceal parameter parsing or a controller/MGMT error. This does
not prove a firmware defect, permissions problem, length problem or regression.

**Separate source-code inference:** failed disconnects retain owned ACL entries
conservatively. With only two observed candidates and no existing-ACL refusal
counter, that guard is a plausible explanation for the five immediate later
resolution failures. New ownership-guard counters distinguish this from a new
link connection attempt. The capture cannot retroactively prove a particular
candidate's guard decision. Ownership and unrelated connections are preserved.

## Source comparison and parameter audit

`3cec650` and `e130915` have identical `advert`, `advertise_receiver` and
advertising retry-loop code. The newer changes concern remote Fast resolution
and connection/finalization observations. This capture does not establish an
advertising regression between those commits.

BlueZ **5.87**, commit `65d11edee469c24dcc8d075b8be9c040cebaaf98`:

- `doc/org.bluez.LEAdvertisement.rst`, `LEAdvertisingManager.rst`: peripheral
  type is connectable; `ServiceData`, optional secondary PHY and a bounded
  timeout are standard properties. NotPermitted documents capacity exhaustion;
  InvalidArguments/InvalidLength/AlreadyExists have distinct meanings.
- `lib/bluetooth/uuid.c`, `bt_string_to_uuid`: the canonical Bluetooth-base FEF3
  string is reduced to a 16-bit UUID. It does not consume 16 UUID bytes on air.
- `src/shared/ad.c`, `uuid_data_length`: length/type + UUID16 + service data is
  4 + 17 = 21 bytes; reserve three further bytes for managed flags: **24 <=31**.
  Without a bound PSM, header data is 15 bytes and the conservative total is 22.
- `src/advertising.c`: legacy length checks include flags; generic Failed can
  result from advertisement parsing or controller/MGMT registration failure.

The reported controller has five available slots, zero active at preflight and
no extended support. These are samples, not proof of capacity at every attempt.
It selected only compact legacy/GATT advertising: no secondary PHY, duplicate
service UUID list, local name, manufacturer data or explicit discoverability
flags. The header announces only a bound PSM. No malformed parameter is proved
by the archived payload-free diagnostics. The new profile validator enforces
these properties and budgets before publishing; no protocol acceptance rule or
advertisement payload format has been relaxed.

## Implemented changes and verification scope

- Closed-schema last-attempt phase, mode, error name/category, service-data and
  conservative legacy byte counts, type, PHY, discoverability setting, lifetime,
  retry delay, sampled available/active instances and discovery state. No error
  body, arbitrary error name, adapter name, address, object path or payload bytes
  enter reports. Unknown error strings fail closed.
- Advertising errors are operation-scoped. Remote GATT connection errors and
  ownership refusals have separate counters. Reports rank the local advertising
  boundary ahead of the unrelated scanning findings.
- Retries back off 2/4/8/16/30 seconds, capped at 30. A 300-second immediate-failure
  state-machine test makes 13 attempts, not 148. Successful 120-second leases
  renew after 90 seconds; visibility changes and BlueZ Release clear capabilities
  and reset the schedule. No global discovery or radio policy is changed.
- Before registration, only the helper's discovery lease is dropped; discovery
  and slot samples are recorded. Other clients may still scan, and snapshot
  `idle` is not a guarantee of radio idle during the following call.
- `bluer 0.17.4` publishes before registration and installs object cleanup only
  after success. Its session event machinery also retains bus connection
  references. A real private-bus regression exposed retained owners after
  failure/cancellation even with a fresh bluer session. The new small publisher
  explicitly owns its I/O task and private D-Bus connection, has no callback
  reference cycle, closes on failure/cancellation, unregisters within one second
  on drop, and honors authenticated BlueZ Release. Its owner is separate from
  the GATT/scanning owner. Standard registration properties are preserved.
- The independent private D-Bus peer checks actual serialized properties and
  injected InvalidArguments/InvalidLength/NotPermitted/NotSupported/InProgress/
  Failed/LimitsExceeded, timeout, cancellation, successful recovery, Release,
  explicit unregister and disappearance of the previous owner. It keeps the
  unrelated scanner/GATT owner alive. This is API/lifecycle evidence, **not a
  Linux controller, RF or Samsung compatibility test**.

The previously owner-verified 49-byte Linux-to-Samsung LAN transfer at `3cec650`
remains recorded in [the physical evidence record](quickshare-s24-physical-evidence.md).
This change does not alter TCP sending, UKEY2, encrypted framing, consent, staging,
remote-completion semantics or any transfer-state mapping. Default/stable feature
flags remain unchanged. New D-Bus code is original GPL-3.0-only work using already
locked dependencies; no BlueZ implementation was copied.

## Minimum next physical test

Use one unused workspace, the same ordinary home LAN and unchanged radio/Apple
sharing settings. Keep USB authorized and Wi-Fi on; no tethering, root or APK.
The runner prepares the current helper automatically.

```bash
git switch fix/quickshare-protocol-hardening
git pull --ff-only origin fix/quickshare-protocol-hardening
bash scripts/quickshare-android-lab.sh --diagnose --adb \
  --direction samsung-to-linux --network ordinary --duration 180 \
  --workspace "$PWD/.cache/s24-advertise-03" --archive
```

Follow the closed-view baseline, then on Samsung select the known disposable
fixture → Share → native Quick Share. Keep the recipient list open across at
least one 90-second renewal. Record whether the lab appears, stays visible or
vanishes, including approximate elapsed times. If you choose to send, compare
codes and explicitly accept in Linux; visibility alone is not a transfer result.
Do not enter `pass` to skip any prompt: Enter means unknown.

Expected registration evidence: `bleAdvertising=true`, mode `compact-gatt`,
`advertisement_registration_success>0`, last attempt phase `bluez`, result
`registered`, secondary `none`, service bytes 17 (or 15 without CoC), conservative
legacy bytes 24 (or 22), and no repeated failure. A successful renewal should
produce another success. GATT/CoC registration alone is insufficient. Phone UI
visibility is a separate owner observation and, with LAN enabled, is not proof
that BLE caused discovery. Incoming slot reads/Weave/CoC or an independent radio
observer would provide stronger transport attribution.

If registrations still fail, stop after this bounded run. Return only
`reports/quickshare-deep-sanitized.tar.gz` plus the UI timings. Inspect
`bluetooth.receiverAdvertising.lastAttempt` (`phase`, `errorName`, `category`),
error-category counters, slot/discovery samples, and separate remote GATT guard
counters before proposing another fix. A generic Failed may still require a
separately reviewed controller diagnostic; no raw HCI/log capture is automatic.
Do not repeat hotspot/Apple-setting sweeps or overwrite the previous successful
fixture evidence. No merge or release is authorized.

## Automated validation

The completed pre-recovery suites passed: Node 268/268; Rust workspace default
39, FastInit 41, native BLE/FastInit 65, including the independent private D-Bus
peer. The final recovery run preserved those results and additionally built both
helper variants, passed real helper lifecycle tests, the six independent Python
protocol cases (commitment/MAC/replay/decline/empty/binary), the BLE wire oracle,
and both default/native sandboxed Electron laboratory suites (2/2 each).

The full Node installer test required a disk-backed TMPDIR in this cloud because
the Rust build cache exceeds its small /tmp mount; no test or installer was
weakened. Privileged network-namespace checks run on the existing disposable CI
runners. All of this is automated software/API evidence, not controller or
Samsung validation of the modified head. Final CI results are linked in PR #21.
