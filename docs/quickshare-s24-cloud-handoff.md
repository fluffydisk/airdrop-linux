# Samsung Quick Share — Cloud continuation handoff

Checkpoint: 2026-11-21. Goal **INCOMPLETE; physical acceptance pending**.
Repository: fluffydisk/airdrop-linux.
Branch: `fix/quickshare-s24-post-consent-transfer`.
Previous published checkpoint: `ad04b0c939181863d7ee0ffbffbd770d9891f8f2`.
Do not substitute the separate `codex-flathub-recovery` branch for this investigation.

## Read first

- `docs/quickshare-s24-t30.md`: diagnostic design, evidence and historical results.
- `docs/quickshare-s24-classic-inquiry.md`: default-off T36 design and rollback.
- `docs/quickshare-s24-controller-baseline.md` and audio-measurement document.
- `docs/evidence/quickshare-s24/`: previously archived laboratory reports.
- `docs/evidence/quickshare-s24/latest-checkpoint.json`: sanitized final T36 state.
- `.github/workflows/quickshare-validation.yml`: existing regression environment.

Historical reports are snapshots, not proof of the latest build passing. The
working source on this branch takes precedence over old PR/source snapshots.
The mandatory research Markdown reports and ZIP were read locally; their originals
and raw `.cache` captures are not included in this handoff. Do not claim to have
read those missing originals in a new Cloud session. Ask for them if required.

## Measured findings

- T29: 0/49 file bytes; approximately13.923s audio HCI progression stall, exhausted
  BR/EDR ACL credits, USB callbacks continued. Firmware causation remains unproven.
- The advertising eligibility failure is separate: active LE roles and reported
  simultaneous-state capability restrictions can make the kernel reject enablement.
  Never override capability bits or fabricate advertising/discovery success.
- T30: one real active-audio small-file receipt, matching hash and owner-confirmed
  verification codes/audio. T31: two receipts, then a connection without codes.
- T31B: no RFCOMM arrival; audio queue/completion gaps about1.76/1.83s, raw HCI
  completion and USB interrupt progression also stopped in sampled intervals.
- T33: connection failed before codes while sampled audio progression remained
  healthy. Thus not every connection failure coincides with a measured audio stall.
- T34: real49-byte/hash success, matching codes and phone sent, but headset ABSENT.
  LE timeout after RFCOMM arrival did not prevent this transfer; not every timeout
  is necessarily fatal. USB attachment and elapsed time also differed.
- T36 initial setup: strict baseline gate aborted on one follower223.949ms interval;
  subsequent windows passed without relaxed thresholds. Classic setup then passed
  but lacked startup application telemetry. The receiver stopped before READY and
  restored settings. Numeric readiness stage7 and a real Unix datagram subprocess
  regression fixed that diagnostic defect, not the Bluetooth reliability problem.
- T36 final retry (2026-11-17): READY19:30:23.886Z, stopped19:31:39.260Z by75s limit.
  Active AAC/headset BR/EDR+LE condition; RFCOMM registered, ZERO incoming RFCOMM,
  ZERO completed transfers. All74 observed app-window samples stayed workspace5.
  Independent rollback reported `restored`, `fullyRestored=true`.
  No owner confirmation of phone-side discovery/send/code exists for this run.
  Empty diagnostic signatures do NOT prove acoustic continuity or transfer success.

Original fixture:49 file bytes, SHA-256
`b753383d7fabdf101bb7ce2c3cb6261ed9960e5212ece3bfc3b103ccfe7efbd7`.
File size is not encrypted wire-frame size. Acceptance still requires at least ten
consecutive small sends with active audio, then larger files/different start states.

## Implementation and test state

T30 metadata-only tracing uses a common monotonic clock, bounded nonblocking app
records and bounded kernel/USB/audio counters. No PCM/audio recording is needed.
T36 is explicitly opt-in (`--classic-inquiry --classic --ble-native --receive-only`)
and uses Nearby Classic inquiry identity plus existing authenticated RFCOMM. It
avoids BLE advertisement registration in this mode; Samsung discovery is unverified.
It temporarily leases Alias/Connectable/DiscoverableTimeout/Discoverable. An
independent watcher acknowledges before mutation and conditionally restores on
stop/crash/deadline. Do not make this experimental mode the default.

Historical successful validation: Node309/309; native Rust75+25; default19+25;
private D-Bus normal/partial-failure/SIGKILL-zombie rollback; isolated sandboxed
headless Electron1. These are prior results, not a fresh Cloud certification.
Readiness-stage subprocess test passed separately (one test,75 filtered out).
The LAST broad native rerun recorded71 passed/4 failed, with missing Python
`cryptography` in the independent peer subprocesses (including a nested peer test
called by the renewal test). It must not be described as fully passing. This run
also predates inclusion of the new readiness test in the full suite.

On a suitable Ubuntu Cloud environment, follow the workflow's dependency setup:
`protobuf-compiler pkg-config libdbus-1-dev python3-cryptography xvfb dbus-x11`, plus
repository-pinned Rust and supported Node. Verify which `python3` the subprocess
actually resolves; installing a module for another interpreter is insufficient.
Then run `npm ci`, `npm test`, and the workflow's locked workspace Cargo commands
from `network/quickshare` for default, ble-fastinit, and ble-native+ble-fastinit.
No hardware test should be replaced by synthetic consent evidence.

## Next work and boundaries

1. Reproduce automated tests with the correct Python environment; record exact
   commit, dependency versions, commands and results. Diagnose new failures rather
   than assuming all failures are dependency-related.
2. Review T36 identity encoding, service hash/PCP/endpoint identity and Samsung
   support against pinned primary Nearby sources. Zero incoming RFCOMM does not
   distinguish no discovery from no phone action or a connection failure.
3. Keep controller starvation, USB event delivery, coexistence and independent
   protocol faults as separate hypotheses. No confirmed firmware/kernel fix exists.
4. Prepare one useful, instrumented local experiment before requesting another
   manual phone send. Restore owned resources and verify cleanup separately.

Cloud can review, change, build and run supported headless/private-bus tests.
It cannot verify this owner's local S24+, Realtek controller, headphones, USB ADB
or Hyprland unless that environment is explicitly connected. Never start receiver,
phone acceptance or privileged tracing against an assumed Cloud/local device.
Physical work returns to the owner's machine: workspace5 silent/no focus theft,
Turkish actionable notifications, manual matching-code confirmation/consent,
no resets/services/codec/PM/Wi-Fi changes without specific approval. Never upload
raw payloads, keys, addresses, original adapter aliases or private lease checkpoints.
