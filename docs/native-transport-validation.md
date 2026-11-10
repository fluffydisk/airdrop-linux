# Native transport validation and release gates

This document is a runnable acceptance specification, not a record of successful
phone tests. The cloud environment has no physical Wi-Fi controller, Bluetooth
controller, Android device or iPhone. Keep those results **Blocked** until the
specified equipment and independent results exist.

## Evidence rules

- **Confirmed**: inspected implementation or the linked reproducible test proves
  the specific claim. Compilation does not prove device interoperability.
- **Probable**: plausible from protocol implementation and upstream evidence,
  but not reproduced against the intended device here.
- **Experimental**: incomplete or dependent on a particular radio/driver/OS.
- **Blocked**: a required device, permission, signing identity, account or
  infrastructure component is unavailable.

Capture the application commit, helper source commit and SHA-256, package and
architecture, distro/kernel, desktop session, NetworkManager/BlueZ versions,
Wi-Fi PCI/USB ID and driver/firmware, Bluetooth USB ID, phone model/OS/security
patch/Quick Share version, network configuration, steps and result. Never record
identity keys, comparison codes, invitation tokens or private file contents.
Keep packet captures private; sanitize addresses and payloads before sharing.

## Reproducible software checks

Use the Node version and dufs hashes from `packaging/runtime-sources.json` and
the Rust toolchain from `network/quickshare/rust-toolchain.toml`.

```sh
npm ci
npm ci --prefix desktop
npm test
npm run prepare-desktop
npm run test:browser
node --test tests/guest-browser.cjs
xvfb-run -a dbus-run-session -- npm run test:desktop
xvfb-run -a dbus-run-session -- npm run test:nearby-desktop
```

Chromium/Electron must retain sandboxing. Ubuntu's restricted user namespaces
require the existing narrowly scoped AppArmor profile; use
`.github/workflows/sharing-validation.yml` and `package-checks.yml`, not a
global sysctl change. Tray tests need a real StatusNotifier host.

```sh
cd network/quickshare
cargo fmt --all --check
cargo test --workspace --locked
cargo clippy --workspace --locked
cd ../..
node scripts/build-quickshare.js
AIRDROP_TEST_QUICKSHARE_HELPER="$PWD/.cache/quickshare/$(node -p process.arch)/airdrop-quickshare" node --test tests/quickshare-native.cjs
```

On a **disposable Linux VM with network-namespace privileges**, run
`scripts/test-sharing-networks.sh` as root. It creates its own interfaces and
firewall tables, tests normal mDNS/TLS, cached authentication after multicast
blocking, and permitted relay downloads after direct peer TCP is denied. It
removes the namespaces and their processes afterwards. It does not modify host
interfaces or establish permission to use a tunnel on an institutional network.

The Quick Share workflow also runs `tests/quickshare-protocol.cjs` with the
compiled helper and namespace privileges. It tests real mDNS, UKEY2 and secure
file traffic between two instances, consent/code agreement and binary/empty/
Unicode file hashes in both directions. Both endpoints use the same code, so
this is neither an independent protocol implementation nor an Android result.
`tests/fixtures/quickshare-helper.cjs` tests IPC only.

## Physical equipment

Minimum stable Android laboratory: two Linux x64 laptops, one ARM64 Linux host,
a recent Pixel and a Samsung Galaxy with current native Quick Share, a
configurable access point, Ethernet and a permitted Internet connection. Include
an older supported Android release and Windows Quick Share as secondary peers.
Use a dedicated spare radio for direct-wireless and AirDrop research.

| Radio/controller | LAN/native Linux | Quick Share LAN | BLE / direct wireless | Apple AWDL |
| --- | --- | --- | --- | --- |
| Intel AX200/AX210; AX201/AX211 with supported platform | Ordinary IP; verify distro driver | No special radio API used | Validate BlueZ advertising/GATT/L2CAP and actual P2P support separately | No supported production path established |
| Realtek RTL8822/RTL8852 family | Ordinary IP; firmware/driver dependent | No special radio API used | Driver variants differ; no family-wide promise | No supported production path established |
| MediaTek MT7921/MT7922 | Ordinary IP | No special radio API used | Validate `mt76`/firmware/controller combinations | Experimental upstream reports; spare radio recommended |
| Atheros AR9280 | Ordinary IP | No special radio API used | Separate Bluetooth controller required | OWL's documented active-monitor development radio; still needs current iOS tests |
| Atheros AR9271 USB / appropriate ath9k_htc firmware | Ordinary IP | No special radio API used | Separate Bluetooth controller required | Candidate dedicated AWDL radio; validate ACK/injection and current OS |
| Intel integrated / supported USB Bluetooth HCI | Unneeded | Unneeded in current LAN-only helper | Record simultaneous scan/advertise, GATT, LE CoC and coexistence results | BLE wake must be independently validated |

`iw list` advertising monitor/P2P capability is insufficient. Prove frame
injection **and automatic ACK reception**, regulatory-compliant channel changes,
and restoration on the exact driver/firmware. Respect rfkill and user consent.

## Acceptance matrix

All phone/radio rows below currently remain **Blocked** in this environment.
The namespace LAN rows are automated CI evidence; retain their run URLs with the
commit under test rather than treating an older green run as a new result.

| Scenario | Test and expected behavior | Required evidence |
| --- | --- | --- |
| Two Linux devices, ordinary LAN | Discover, pair with code comparison, send a multi-file batch both ways, verify SHA-256 | Namespace CI plus two physical computers |
| Multicast blocked, paired devices | Restart on same on-link network; cached endpoint authenticates with pinned certificate | Namespace CI; repeated AP acceptance |
| Multicast blocked, new devices | Explain discovery limitation; explicit QR/link route stays available | UI/broker tests and two-device browser acceptance |
| Client isolation with permitted Internet | Direct peer route fails; user selects a permitted HTTPS provider; only selected files download | Independent relay fixture plus real provider/phone test under actual policy |
| Different networks | Fresh permitted HTTPS link works remotely; expiry/revoke/provider recovery invalidates old link | Live provider tests plus independent network recipient |
| Linux → Pixel and Galaxy | Native receive screen, recipient appears, compare code, accept, verify stored files | Both physical models, no companion app |
| Pixel and Galaxy → Linux | Native Android share sheet lists Linux; explicit fresh code and accept/decline; receive publishes complete files only | Both physical models, no companion app |
| Windows Quick Share ↔ Linux | Repeat both directions; record BWU behavior rather than inferring support from Android | Windows PC and exact Quick Share build |
| BLE, no shared Wi-Fi | Discover both directions; identify actual negotiated data medium; disabled controller gives useful fallback | Physical controllers/phones; experimental feature gate |
| Wi-Fi Direct/hotspot | Negotiate through host APIs, transfer without upstream forwarding, restore previous network on success/cancel/crash | Two validated Wi-Fi stacks; NetworkManager checkpoint tests |
| iPhone ↔ Linux AirDrop | Linux appears in native list; accept both directions; no auto-accept; validate archive safety and file hashes | Dedicated validated radio; exact iOS/device; experimental only |
| Trusted Linux reconnect | Same key reconnects after restart; changed key never inherits trust; offline device remains visible with fallback | Existing Nearby tests plus AP changes |
| Crash/restart | Linux journals retain resume; Quick Share becomes interrupted and requires a fresh transfer | Process kill at handshake/consent/data/publication, then restart |
| Cancellation/rejection | Test each side before consent and during data; no partial files visible in inbox or successful history entry | Fault injection and physical peers |
| Corruption/adversarial data | Changed MAC, malformed headers/IV/padding, sequence replay, oversize/unsafe manifests rejected | Cryptographic vectors, malicious-peer tests, bounded fuzzing |
| Resource exhaustion | Four incomplete connections, repeated invalid frames, full disk, 100-file/64-GiB bounds, helper crash | Measured memory/CPU/descriptors/disk; no stable enablement before cleanup coverage |
| Upgrade/rollback | Preserve MIT native identities, files, journals and installer ownership; old Linux protocol still works | Previous-release upgrade fixtures on both architectures |

File corpus: zero bytes, 1 byte, chunk-boundary sizes, 2 MiB + 17 bytes, 1 GiB,
100-file batch, Unicode names, duplicate basenames, full disk and changed source.
Use disposable files. Compare receiver hashes independently, including files
received by Android via an explicit export/readback procedure. A progress bar
reaching 100% is insufficient evidence.

## Measurable usability and reliability gates

These are proposed release targets, not observed results. Collect at least 30
attempts per supported device/direction/network cell, then a 100-transfer soak
on each primary model. Report failures and p50/p95; do not average away timeouts.

| Measurement | Method | Initial target |
| --- | --- | --- |
| Sender actions | Screen recording; count choose-file completion, recipient selection, Send; pair separately | At most 3 routine sender actions; no IP/interface entry |
| Receiver actions | Count permission/comparison/accept interactions; separate OS first-run prompts | One accept per ordinary transfer after comparison |
| Discovery | Monotonic time from both peers being visible to recipient rendered | LAN p95 ≤ 5 s; BLE research target p95 ≤ 15 s |
| Establishment | Time from Send to authenticated acceptance request; separate human waiting | LAN p95 ≤ 3 s excluding consent |
| Transfer success | Complete file set with matching hashes / initiated transfers; report cancelled separately | ≥ 99% in supported ordinary-LAN soak |
| Reconnect | Previously paired reachable Linux devices connected / restart attempts | ≥ 99%; p95 ≤ 10 s |
| Fallback | From empty list to a remotely usable scoped link, excluding first provider setup | No dead end; ≤ 2 extra connection choices |
| Resources | `pidstat`, `/proc/<pid>/status`, descriptor counts and staging usage; 10-min idle and 1-GiB transfer | No growing idle log/history/descriptor leak; set RSS/CPU budget from baseline |
| Throughput | Verified payload bytes / monotonic data-transfer duration; compare same hardware's direct TCP | Record median/p95 and bottleneck; no advertised speed before measurements |

## Native helper release decision

Keep `AIRDROP_EXPERIMENTAL_QUICK_SHARE` development-only until the security,
cleanup/resource, Pixel/Galaxy and packaging/license cells pass. BLE and direct
wireless need separate flags and evidence. Each package format needs an actual
host/sandbox acceptance run; bundling a binary does not grant BlueZ or Wi-Fi API
access. Stable releases must retain working Linux/browser routes when a helper
is absent, disabled or crashes. Native AirDrop never blocks an Android release.
