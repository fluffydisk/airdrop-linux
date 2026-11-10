# Samsung Quick Share deep diagnostic laboratory

This is an experimental diagnostic tool on PR #21, stacked on PR #19. It does not establish Galaxy S24+ compatibility. It preserves the current strict BLE parsers, GATT/LE CoC bootstrap, UKEY2, encryption, manual consent and private file staging. It introduces no Samsung protocol bypass.

## Authoritative starting evidence

The corrected owner report at `4a68dd47cae40d9d18325290d33f1fe71b54ab0a` describes Linux → Samsung, `lab-small.txt`, approximately 253 seconds, ordinary home Wi-Fi. Helper startup and local mDNS passed. Samsung discovery is **UNKNOWN**. Connection, authentication, transfer and independent hashes were **NOT TESTED**. Earlier answers of `pass` were entered to skip questions and are not interoperability evidence.

The reported timeline has 59 events, including 54 Bluetooth events: compact-gatt registration, GATT and LE CoC active, scanning alternately active/paused, maximum FEF3 observations 72, decoded/resolved/ready all zero, no native recipient or connection/authentication event. mDNS maxVisible was 2 with no Samsung attribution. Observations are repeated service-data events, not device counts. No packet has been attributed to Samsung. The old `decoded` counter advanced after validation/filtering and target insertion; zero does not by itself identify a parser rejection.

Source inspection found that decoder errors were discarded and `QuickShare.stop()` explicitly called `failure()` on intentional shutdown. That explains a possible synthetic HELPER_UNAVAILABLE after shutdown-requested. Source and regression evidence establish the reporting defect; the historical ordering alone cannot prove the old process exited cleanly. New lifecycle evidence distinguishes clean-stop, forced-stop, unexpected-exit and start-failed.

## Omarchy setup and single command

Use your regular graphical login, without running Electron as root. Review/install missing build dependencies yourself. For Omarchy/Arch, ADB is supplied by `android-tools`; build dependencies normally include `base-devel rustup nodejs npm protobuf pkgconf dbus`. Follow the existing preflight for local display/runtime dependencies. The repository pins its Rust toolchain; Node 26 is recommended, minimum host Node 24 for preparation.

```bash
git fetch origin
git switch fix/quickshare-protocol-hardening
git pull --ff-only origin fix/quickshare-protocol-hardening
bash scripts/quickshare-android-lab.sh --preflight
bash scripts/quickshare-android-lab.sh --diagnose --adb \
  --direction linux-to-samsung --network ordinary --duration 180 --archive
```

The first run prepares the BLE-native helper, installs the lockfile's development dependencies and builds the source desktop. Preparation validates the source commit, tracked-source fingerprint and helper SHA-256. Radio/OS policies are never modified. The default deep workspace is `.cache/quickshare-deep-lab`, separate from `.cache/quickshare-lab`. Each owned lab start creates a fresh isolated application session. Only disposable fixtures can be sent in lab mode.

For the reverse direction:

```bash
bash scripts/quickshare-android-lab.sh --diagnose --adb \
  --direction samsung-to-linux --network ordinary --duration 180 --archive
```

`--diagnose` currently checks `lab-small.txt`. Copy that generated fixture from the private workspace to the phone yourself before the reverse trial. Do not substitute a personal file. Empty answers mean UNKNOWN, never PASS. Prompts expire after two minutes; EOF or interruption does not create a manual action marker.

Optional `--authorize-adb` explicitly authorizes the read-only collector for that invocation and suppresses its consent prompt. It does not authorize the phone's RSA prompt or enable USB debugging. Omit `--adb` for a Linux-only capture; Android evidence will be not-requested/unknown. `--non-interactive` records no owner UI assertions. The observation window is 10–600 seconds, plus a 10-second baseline and bounded preflight/cleanup operations. Log collection is stopped during owner prompts and at the observation deadline. No capture runs indefinitely while waiting for an answer.

## USB debugging: owner actions

1. Keep Wi-Fi and Bluetooth on and both devices on the ordinary home LAN. Connect the phone by a USB data cable. Do not enable USB tethering.
2. If you choose to authorize diagnostics, open Samsung Settings → About phone → Software information. Enable Developer options by tapping Build number as the phone instructs; then enable USB debugging in Developer options. Screen layout and policy restrictions vary by firmware.
3. Unlock the phone and approve **this computer's** RSA USB-debugging request. Decline if you do not recognize the host. The tool never enables debugging, changes permissions, installs an app, modifies Quick Share/Play Services or disables protections.
4. Attach exactly one Android device by USB. ADB must report an authorized USB transport. Unauthorized, multiple, offline, unavailable or unconfirmed USB transports block collection and produce a sanitized partial report. No serial or transport identifier is exported. Resolve host USB access using the distribution's documented setup yourself; do not run the desktop as root.
5. After testing, disable USB debugging and revoke that computer's authorization if no longer needed.

The collector discovers package candidates from the installed package list, validates each through targeted package metadata, and exports aliases plus numeric version information. It does not assume a Samsung package ID. A candidate package is not proof that it implements the active Quick Share service. Privileged services may hide logs, process visibility or state even from authorized ADB: missing data remains UNKNOWN.

## During a trial

Close the phone Quick Share view for the 10-second baseline without changing radios. Then follow the prompt to open **native Samsung Quick Share Receive**, keep the screen visible, and press Enter to mark ANDROID_RECEIVE_OPEN. Linux → Samsung: choose the generated fixture in the Linux Transfer view, select a native recipient if one appears, and Send. Samsung → Linux: share the generated fixture using Samsung's native Quick Share and choose the Linux lab if visible. Compare codes on both devices and accept manually; mismatched codes must be rejected.

Optional console markers are `selected`, `connect`, `auth`, `accepted`, `completed`, `end`. These record an owner action, **not success**. Protocol, consent and transfer transitions are collected separately from the helper. At the end, only the exact phrases `CONFIRMED RECIPIENT` and `CONFIRMED RECEIVED` assert the described UI observations. Enter skips them. A completed marker or an answer of `pass` cannot establish a transfer.

For Linux → phone independent integrity verification, copy the received **fixture** back to a private directory yourself, without using this implementation for that readback. Pass that directory with `--readback /absolute/private/fixture-readback` on the capture containing the actual transfer. For phone → Linux the runner independently hashes the isolated received fixture. A completion finding requires a protocol completion event **within this capture**, explicit native UI completion and matching independently read fixture bytes. Previous attached-session completion events cannot satisfy it. An outgoing `Sent`/outcome-unknown alone never proves remote completion. No compatibility certification is issued even when these three observations agree.

## Expected observations and how to interpret them

Linux should expose its current advertising mode, GATT registration, LE CoC availability and scan windows. BlueZ registration is not independent proof that a controller emitted an advertisement. The phone might show the Linux lab, or might show nothing; neither outcome is predeclared. A visible packet or mDNS service is not necessarily Samsung.

Read the report in this order:

- `bluetooth.peak` and `lastActive` preserve active state across teardown. Counters are helper-lifetime aggregates; `windowCounters` subtracts the capture baseline when attaching. Address-derived internal candidate tracking is capped at 256 and never exported; rotation can increase the count, and candidates are not physical-device counts.
- `full_accepted` / `compact_accepted`, `candidate_rejected`, the per-parser rejection reasons, size buckets and leading-bit buckets identify the first validation gate. **Both** parsers are attempted on each observation; their rejection totals must not be added as distinct packets. Leading-bit buckets are raw input high bits, not guaranteed decoded protocol versions (headers may be base64 encoded). Unsupported fast-shape recognition is diagnostic-only and does not accept a peer or prove the complete format valid.
- Slot errors use `slot_reject_*`, independently of advertisement parsing. GATT resolution request → ACL attempt → service → slot/read → required write and notification/indication characteristics are separate counters. GATT metadata resolution is not Weave. Weave requested/established and LE CoC attempts/PSM outcomes identify the bootstrap boundary. An ACL attempt not exposed through local characteristic activity remains unobservable; registration is not acceptance.
- `self_suppressed`, `visibility_rejected`, retry throttling, capacity, expiry/removal and cache replay counters distinguish valid-but-unpublished candidates from decoder rejection. Regular scan pauses are deliberate duty cycling; session pauses and BlueZ discovery-active/busy errors are separate. A generic D-Bus failure does not prove controller disappearance.
- Helper IPC queue/drop/publication, Node route validation/capacity/publication, and actual renderer acknowledgement distinguish decoded endpoints from selectable UI recipients. They are aggregate evidence, not per-phone attribution. Renderer counters are diagnostic-only and enabled in the isolated source lab.
- Review protocol/UKEY2, consent and file states only when reached. Authentication, link acceptance and file consent are separate events. LAN discovery and encrypted TCP transfer remain enabled; BLE is still opt-in and stable builds remain disabled.

The corrected 72/0 report cannot be retroactively assigned a rejection reason. A repeat should produce exact **current-parser rejection gates**, or show successful parsing followed by filtering/GATT failure. It may still be impossible to attribute the packets or determine Samsung's hidden behavior with these sources.

Run **separate** sessions for ordinary Wi-Fi (`--network ordinary`), a phone hotspot (`--network hotspot`), and Samsung Apple-sharing comparisons (`--apple-sharing on`, `off`, or `not-available`). Record the actual setting yourself; the runner never changes it. Apple sharing is only a comparison condition, not an implementation of AirDrop/AWDL. Do not infer a Samsung bug from hotspot or school-network failure.

## Outputs, privacy and retention

The runner prints the private report directory, normally `.cache/quickshare-deep-lab/reports`:

- `quickshare-deep-diagnostic.md`
- `quickshare-deep-diagnostic.json`
- `quickshare-event-timeline.json`
- `quickshare-deep-sanitized.tar.gz` only with `--archive`

Every finding identifies Direct runtime observation, Phone system observation, Owner UI observation, Source-code inference or Unknown. Clock samples include host/Android timestamps, round-trip latency, sampled offset envelope and precision uncertainty. Threadtime events without an absolute Android epoch use host receipt time. Sampled offsets do not bound unsampled drift or log delivery delays. Timestamp proximity is a hypothesis, never a causal or identity link.

Raw command output is read into bounded memory and discarded. Logcat uses fixed tag/category parsing: no message bodies, arbitrary fields, PIDs, serials, addresses, SSIDs, account names, personal filenames, verification codes, keys or raw advertising bytes are exported. Truncated, unsupported and multiline continuation records fail closed. Read-only, targeted `dumpsys package` and `bluetooth_manager` output is never written; no global dump, bugreport, HCI capture, log clear or verbose system-log setting is used. Missing/denied log visibility remains explicit.

Limits: 5-second ADB commands; 256 KiB command output; 4096-byte log lines; 4 MiB log stream per baseline/observation window; at most 16 package candidates, 32 PIDs per candidate, 12 clock samples and 2000 collected events. Linux evidence also has a 2000-event ring. The report timeline evenly samples at most 256 Bluetooth status snapshots while retaining protocol/owner/helper transitions (within the overall event bound), and records the omitted snapshot count. Full counter peaks remain in the summary. Private Linux evidence reads are capped at 32 MiB; reports are capped at 8 MiB each, private directories at mode 0700 and output files at 0600. The archive is assembled from the three newly generated, sanitized report buffers; it never traverses the workspace or includes arbitrary files. Overflow/truncation and visibility limitations mean missing events cannot prove absence. The ADB daemon may maintain its normal host authorization state outside this workspace; the runner does not change or bundle it.

Review the three report files yourself, then attach **only those files or the sanitized archive** manually. Nothing is uploaded. Do not attach the entire workspace, raw logs, received personal files or USB identifiers. Stop/inspect the deep workspace using the existing interface:

```bash
bash scripts/quickshare-android-lab.sh --status --workspace "$PWD/.cache/quickshare-deep-lab"
bash scripts/quickshare-android-lab.sh --stop --workspace "$PWD/.cache/quickshare-deep-lab"
```

A runner that starts its lab stops only that lab. A runner attaching to an existing, verified BLE-native lab leaves it running. Another capture cannot use the same workspace concurrently (`diagnose.lock`). After an uncatchable crash, stop the lab and confirm no diagnostic runner remains before removing a stale `diagnose.lock`. Preserve wanted reports elsewhere, then delete this isolated workspace yourself when finished. Do not delete an active workspace.

## Advanced HCI: disabled and unimplemented

There is no raw/sensitive capture option in this runner. A future local HCI parser requires separate consent and privacy review; no HCI data belongs in an ordinary archive.

Android's [Bluetooth debugging documentation](https://source.android.com/docs/core/connect/bluetooth/verifying_debugging) describes a manual **Enable Bluetooth HCI snoop log** Developer options setting, Bluetooth restart for full logging, and possible extraction via `btsnooz.py` from a separately obtained bugreport. Typical data-directory locations require privileged access. This is general Android guidance, **not verification of the owner's Android 17/One UI 9 S24+ firmware**. The toggle, bugreport contents and unprivileged access may be absent, restricted or redacted on that build.

Only in a separately agreed advanced experiment should an owner inspect whether that setting exists, decide explicitly whether to enable sensitive local logging, follow the phone's instructions, and disable it afterward. A full bugreport or snoop file can expose unrelated private traffic and must remain local. This tool never enables the setting, restarts Bluetooth, invokes a bugreport, pulls a raw HCI file or packages one. If the firmware hides it, the result is UNKNOWN; do not root or disable protections to obtain it.


## Example: interpreting the corrected historical summary

This excerpt illustrates the corrected owner-reported summary, not a new capture and not reconstructed packet evidence:

```json
{
  "observed": 72,
  "decoded": 0,
  "resolved": 0,
  "ready": 0,
  "rejectionReasonCoverage": "unavailable",
  "samsungPacketAttribution": "unknown",
  "nativeConnection": "not-tested",
  "transfer": "unconfirmed",
  "shutdownClassification": "legacy-error-after-shutdown-intent"
}
```

The next run should fill in `full_reject_*`, `compact_reject_*`, `candidate_rejected`, accepted-format and filter counters. If both parsers reject every observation, GATT resolution should have zero requests; that locates a software validation boundary without proving which phone emitted the packets. If parsing succeeds, inspect the later filters and GATT/transport stages instead. A legacy post-shutdown error remains ambiguous until explicit new exit evidence is collected.

## Automated verification

No phone is required by normal CI. Regression coverage includes the reported 59-event/54-status/72-observation shape, exact parser reasons and unsupported variants, repeated observations, scan accounting, categorized D-Bus failures/timeouts, absent/unauthorized/multiple/disconnected USB devices, log formats and restricted access, clocks, malformed/multiline/privacy inputs, maximum counter/timeline bounds, archive allowlisting, active-state preservation and expected/unexpected exit ordering. An actual sandboxed Electron/helper test invokes `--diagnose` and checks source/hash verification, report creation and owned cleanup. These tests do not verify radio emission or stock Samsung behavior.

```bash
npm test
(cd network/quickshare && cargo fmt --all --check)
(cd network/quickshare && cargo test --workspace --locked)
(cd network/quickshare && cargo test --workspace --locked --features ble-fastinit)
(cd network/quickshare && cargo test --workspace --locked --features ble-native,ble-fastinit)
(cd network/quickshare && cargo clippy --workspace --locked --features ble-native,ble-fastinit)
python3 tests/quickshare-ble-oracle.py
```

The existing `Experimental Quick Share foundation` GitHub workflow also builds both architectures, runs real helper lifecycle, independent Python UKEY2/MAC/replay/consent/file tests, privileged network-namespace transfer regression and sandboxed Electron lab/recipient integration. Namespace tests require a disposable runner with namespace privileges; this is unrelated to phone root or running Electron as root.

Cloud validation for this diagnostic extension (no Android device or Bluetooth controller attached): full Node suite **259 passed, zero skipped**; Rust default **35 passed**, FastInit **37 passed**, native BLE + FastInit **56 passed**; rustfmt and clippy passed (existing vendored-library warnings remain). The independent Python UKEY2 commitment/MAC/replay/decline/empty/binary scenarios passed, as did the independent BLE wire oracle, default/native helper process lifecycle and actual native Electron runner/renderer integration. General Electron transfer/nearby tests passed; the StatusNotifier tray test could not run without a desktop watcher. The privileged network-namespace test is blocked locally by unavailable root/sudo and remains required in the GitHub workflow. CI results belong to the published commit's checks, not to a Samsung compatibility claim.
