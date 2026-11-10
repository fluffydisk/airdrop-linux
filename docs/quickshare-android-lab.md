# Stock Android native Quick Share acceptance

The cloud still has no physical radio/phone, but the owner has a Galaxy S24+.
Use [the S24+ harness and guide](quickshare-s24-test.md) for owner-assisted trials;
acceptance is awaiting that evidence, not permanently blocked. This document is
a general procedure, not a record of successful tests.

Use stock Pixel and Galaxy, x64 and ARM64 Linux hosts, configurable AP, Ethernet
and real Bluetooth controllers. Windows Quick Share is secondary. Record a run
ID, exact package/hash, commit, helper source/lock/compiler/features/hash, kernel,
distro, desktop session, BlueZ/NetworkManager, radio driver/firmware, AP isolation
and multicast settings, phone model/OS/security patch/GMS/Quick Share version,
visibility, Bluetooth/Wi-Fi and Apple-sharing setting. If the Quick Share module
version is not exposed, record that; GMS version alone is not equivalent.

Capture Linux metadata privately:

```sh
date -u --iso-8601=seconds
git rev-parse HEAD
git status --short
sha256sum "$HELPER" network/quickshare/Cargo.lock
uname -a
cat /etc/os-release
NetworkManager --version
bluetoothd --version
nmcli -t -f DEVICE,TYPE,STATE device
iw dev
rfkill list
bluetoothctl show
```

With authorized USB debugging, during setup/readback only:

```sh
adb shell getprop ro.product.manufacturer
adb shell getprop ro.product.model
adb shell getprop ro.build.version.release
adb shell getprop ro.build.version.security_patch
adb shell getprop ro.build.fingerprint
adb shell pm list packages | rg -i 'nearby|share|gms'
adb shell dumpsys package com.google.android.gms | rg 'versionCode=|versionName='
```

Repeat dumpsys for actual Samsung/Quick Share packages and record the About UI.
Disconnect USB during the native transfer. ADB never initiates the transfer.

Prepare an empty private test directory, real redistributable JPEG/PNG fixtures,
empty/small/Unicode files, sizes 1/65535/65536/65537/2097169 bytes, 1-GiB file,
100 files and duplicate basenames from distinct directories. Generate deterministic
bytes with Python (repeated bytes(range(256))), hash all originals independently:

```sh
find quickshare-lab/source -type f -print0 |
  sort -z | xargs -0 sha256sum > quickshare-lab/source.sha256
adb push quickshare-lab/source /sdcard/Download/quickshare-source
```

If the stock picker cannot select zero-byte files, record a picker limitation;
it is not a passing zero-byte transfer result.

## Each direction independently

Android to Linux: start the exact installed candidate, enable receiving and
choose inbox. On phone Files: select fixture(s), Share, native Quick Share,
select Linux. Linux must appear without IP entry/URL/QR/companion app. Compare
codes visually (record agreement, not code), accept once in Linux, and require
actual terminal outcomes. No received file may appear before consent. Compare
received file count/length/names and SHA-256 against the original manifest.

Linux to Android: open stock Quick Share Receive/visibility screen. Choose
files in Airdrop Linux, choose discovered phone, Send. Android must show native
receive prompt. Compare codes and accept. Reconnect USB after completion, locate
new files through stock Files, then adb pull or stock USB export into an empty
readback directory. Independently hash readback bytes, explicitly accounting for
renaming. Do not assume one universal Android destination folder. Missing readback
means integrity unverified. The current sender explicitly reports completion
unconfirmed; that is a remaining stable gate, not a passing outcome test.

Windows: repeat both directions, record Quick Share About, OS build, drivers and
firewall profile; verify with Get-FileHash -Algorithm SHA256.

## Discovery experiment and failures

Keep Android Bluetooth on while comparing helper LAN-only versus minimum BLE.
Repeat fresh sessions/restarts, Linux Ethernet plus phone Wi-Fi, screen states,
available Apple-sharing settings, absent Linux controller and permission denial.
Observe AP associations when Android Send opens: does it leave LAN, and does BLE
selection restore it? Block mDNS only in a disposable lab diagnosis cell.

Repeat each direction: empty, text, JPEG, PNG, large, multiple, Unicode, duplicates;
then decline, code mismatch, ignored consent, sender/receiver cancellation at
before-consent/10%/90%, Wi-Fi interruption, unavailable recipient, full disposable
destination and application/helper kill during handshake/consent/data/publication.
Require bounded failure, no false complete, no truncated publication or stale
acceptance, safe cleanup, and successful fresh transfer after restart. Android may
migrate media; kill the helper when deterministic process interruption is needed.

Diagnose by stage: not listed (visibility/AP/mDNS/BLE); listed but no connection
(endpoint/routes/firewall/GATT); connection but no prompt (UKEY2/version/paired
key/introduction); accepted stall (payload IDs/offsets/BWU/disk/backpressure);
100% without success (terminal response versus local bytes/publication). Stop on
code mismatch; never weaken authentication. Keep btmon/packet captures private.

Developer diagnostics are available through the existing authorized Electron
sharing IPC: `window.airdrop.sharing('diagnostics')`. Export that allowlisted
object rather than full state/history. It contains no peer/file identity or PIN.

Retain all attempts, failures, p50/p95 discovery/establishment, independent hashes
and sanitized outcomes. Initial targets: 30 attempts and 100-transfer soak per
model/direction, >=99% normal LAN success, discovery p95 <=5s, establishment p95
<=3s excluding human response, zero unexplained integrity/consent failures.
Repeat package/architecture smoke tests for every enabled distribution format.
