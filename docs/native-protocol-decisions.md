# Native protocol decisions

Research refreshed 10 November 2026. Repository activity and release dates are
maintenance signals, not interoperability proofs. Hardware claims below are
attributed to upstream unless an application test explicitly verifies them.

## Decision

Keep Electron/Node and the existing Linux TLS/chunk/journal engine. Use a
separately supervised Rust helper for Quick Share, initially LAN-only and
disabled. Vendor a small, pinned core so receive/security fixes are reviewable;
do not launch a second desktop app or use UI automation. The implementation is
in `network/quickshare`, `lib/sharing/quickshare.js` and the existing sharing
broker. Native protocols own their wire transfers; they cannot consume the
application's Linux chunk protocol interchangeably.

Go for the **disabled development foundation** based on the open-quickshare
core; no-go for stable Android enablement without physical acceptance. No-go for
general production Apple AirDrop on current arbitrary Linux hardware. A bounded,
separate-radio AirDrop research track is credible and must not delay Android.

## Candidate comparison

| Candidate | Evidence inspected | Decision and remaining limits |
| --- | --- | --- |
| [Martichou/rquickshare](https://github.com/Martichou/rquickshare) | GPLv3 Rust core/Tauri application; latest release [v0.11.5](https://github.com/Martichou/rquickshare/releases/tag/v0.11.5), 23 Feb 2025; repository push 1 May 2026. Native `core_lib/src/hdl/{inbound,outbound,mdns_discovery}.rs` implement UKEY2, V1 frames and TCP transfers. | Useful lineage/reference, not selected as the unchanged integration. Fresh open reports include [closed-channel CPU/log growth](https://github.com/Martichou/rquickshare/pull/448), [missing receive directory](https://github.com/Martichou/rquickshare/pull/442), [nameless Samsung advertisements](https://github.com/Martichou/rquickshare/pull/439) and [headless consent failure](https://github.com/Martichou/rquickshare/pull/441). Do not import auto-accept as a headless fix. |
| [ignotusbucius/open-quickshare](https://github.com/ignotusbucius/open-quickshare) | Root GPLv3; excluded Tauri frontend declares AGPL. Latest release [v0.15.2](https://github.com/ignotusbucius/open-quickshare/releases/tag/v0.15.2), 13 Oct 2026; push 1 Nov 2026. Pinned [core source](https://github.com/ignotusbucius/open-quickshare/tree/fb9c8f9502e5313e3d788aa3498659773ef12d28/core_lib) includes LAN plus experimental BlueZ/L2CAP, BLE advertising and bandwidth-upgrade work. | Selected core only, with local consent/path/resource/crypto hardening. Upstream's broad Linux/Android claims are not a supported device matrix. The release's x64 artifacts do not establish ARM64 wireless support; our ARM CI verifies compilation/lifecycle separately. Do not import its hotspot/network commands or name-based trusted-device policy. |
| [google/nearby](https://github.com/google/nearby/tree/e71e92bb246450c56bc1b1823929e8c1c49723fa) | Apache-2.0 C++ protocol/platform code and extensive tests; active on 10 Nov 2026. `sharing/advertisement.cc`, `sharing/incoming_share_session.cc`, `connections/implementation/mediums/` and schemas are useful references. `internal/platform/implementation/g3/ble.h` and `wifi_lan.h` use paired sockets/`MediumEnvironment`, not a ready BlueZ/NetworkManager Linux backend. | No-go as a drop-in Linux Quick Share SDK. A host backend plus sharing service/account/platform integration would be a larger C++ maintenance project. Revisit for independent fixtures and protocol changes; Nearby Connections alone is insufficient. |
| [nozwock/packet](https://github.com/nozwock/packet) | GPLv3 GTK4/libadwaita app; [0.7.3](https://github.com/nozwock/packet/releases/tag/0.7.3), 2 Oct 2026. [Cargo.toml](https://github.com/nozwock/packet/blob/main/Cargo.toml) pins a `nozwock/rquickshare` fork (`c9ac93f5584a4265e8da679ad689df5be1e80c6b`) with `experimental`. Current frontend requires GTK4 4.22/libadwaita 1.9. [BLE discovery request](https://github.com/nozwock/packet/issues/164) and [D-Bus startup fix](https://github.com/nozwock/packet/pull/169) show remaining controller/platform issues. | Good independent application and protocol comparator; no-go for embedding its GTK app inside Electron. Its core remains an alternative if measured interop or maintenance surpasses the selected fork. Do not infer BLE/direct-wireless completeness from a Cargo feature name. |

All Rust candidates share substantial lineage: they are not four independent
confirmations of interoperability. Pixel, Galaxy and Windows each need both
directions tested. Android may use BLE to activate discovery even on a LAN;
LAN-only core availability does not prove a phone will show the Linux recipient.
Google/Samsung Quick Share-to-AirDrop functionality does not supply a Linux
AWDL implementation or Apple credentials.

### Integration alternatives

| Approach | Consequence | Decision |
| --- | --- | --- |
| Native process over inherited pipes | Isolates crashes; no Node ABI dependency; bounded IPC and explicit lifecycle; own per-architecture artifact and license duties | Selected |
| N-API/static/dynamic Rust binding | Less IPC code but protocol bugs can crash Electron; native ABI/build burden; no copyleft advantage | No-go for initial release |
| Launch existing GUI app | Duplicate UI/identity/notification/trust ownership; no stable control API | No-go |
| Independent JavaScript implementation | Owns cryptography, parser, BLE and protocol regression burden; discards useful maintained code | No-go unless selected cores become unmaintainable or licensing strategy changes |
| Full Google C++ port | Permissive license but substantial Linux backend/build/platform integration | Research fallback, not the shortest credible release path |

## Apple verdict

[OWL](https://github.com/seemoo-lab/owl) is archived and its README explicitly
says no longer maintained. Its active-monitor/injection/automatic-ACK radio
requirement is stronger than ordinary monitor-mode support. `daemon/io.c`,
`daemon/netutils.c`, `src/schedule.c` and `src/rx.c` own raw radio/Netlink/AWDL
timing. It creates IPv6 `awdl0`; upstream documents exclusive use of the Wi-Fi
radio, fixed channel/election limitations and no ordinary VM/WSL support.

[OpenDrop](https://github.com/seemoo-lab/opendrop) implements the application
layer, not AWDL. Its README documents incomplete peer authentication,
auto-accepting receive state, BLE wake limitations and single-file constraints.
Contacts-only support uses extracted Apple credentials; this product will not
extract or ship credentials. Python, libarchive, HTTP/TLS and archive parsers
would all require hardening and lifecycle ownership before integration.

[airdrop-mt7921](https://github.com/jedbillyb/airdrop-mt7921/tree/ff3826eade2da5f12506aa4498fc639a21052bf7)
has fresh, detailed MT7921/Void and MT7922/Arch/iOS 26 reports. Its
`patches/README.md`, `daemon/airdrop-helper`, `install.sh` and `airdrop.sh` describe
paired monitor interfaces, `mt76` power-management changes, BLE wake and pinned
[OpenDrop iOS 26 fixes](https://github.com/jedbillyb/opendrop/commit/03b4adc45d3a42659cede76d04cc93b889c2f057).
The README reports receive speeds around 40–67 kB/s and explicitly says the
proving send was only 68 bytes; that is insufficient production throughput or
reliability evidence. Exclusive mode interrupts Wi-Fi. Shared mode has channel,
latency and patched-hostapd requirements. Installer-created passwordless sudo
and service-global network control are not acceptable defaults for this app.

Research budget: 2–6 engineer-weeks **after obtaining** a dedicated AR9280/AR9271
or exact MT7921/MT7922 setup and current iPhone. Pin both forks; establish actual
native device-list presence and send/receive of photos/large files; enforce
consent and safe archive extraction; capture throughput and crash restoration.
Use a narrowly scoped authenticated host service if privileges are needed,
owned interfaces and NetworkManager checkpoints. Stop if the radio cannot ACK,
regulatory requirements cannot be met, networking cannot be restored safely,
or native iOS interoperability remains unreliable. Ship no generic AirDrop
support claim from a laboratory result.

## Licensing decision

The existing application is MIT; that label does not cover the vendored helper.
The Rust wrapper/core subtree is GPL-3.0-only with its own LICENSE, provenance
hashes and preserved Apache schema notices. Root source archives include this
mixed-license source. Runtime packaging deliberately excludes this subtree and
development binaries while the native edition is gated.

| Distribution/use | Required treatment |
| --- | --- |
| Copy GPL core source into application | Preserve notices; covered/combined work must meet GPLv3 source and licensing obligations; MIT-only distribution is insufficient |
| Static linking | Treat the resulting covered binary as GPLv3; ship complete corresponding source and necessary build/install materials |
| Dynamic linking | Do not presume it avoids combined-work obligations; document the legal boundary before distribution |
| IPC helper | Separate ownership/crash boundary is useful engineering, not an automatic copyleft exemption; assess the combined distribution and all covered parts |
| Ship third-party binaries | Provide exact matching corresponding source, modifications, dependencies/build material and notices using a compliant distribution method; upstream URL alone may be inadequate |
| Reference/reimplement documented protocol | Independently written code can retain the project's chosen license; copying implementation/schema text retains its source obligations; protocol documentation is not a trademark/patent clearance |

Before a helper edition, generate a locked dependency SBOM/license inventory,
audit all enabled Cargo features and bundled libraries (including target-specific
dependencies), provide source alongside each binary release, publish reproducible
build instructions and record hashes. Preserve installation information where
GPLv3 requires it. Do not silently relabel the whole repo or claim that process
separation settles the legal question. If MIT-only native binary distribution
is a requirement, the present GPL core selection is a no-go; fund a permissive
implementation/port or obtain appropriate separate rights.

## Remaining implementation order

1. Merge the independently validated sharing/fallback PR; preserve existing
   Linux pairing, chunk integrity, journals, guest uploads and provider ownership.
2. Validate the disabled helper foundation and independent-network regression;
   finish cancellation/staging cleanup, resource limits and adversarial tests.
3. Execute the [physical acceptance specification](native-transport-validation.md)
   for Pixel/Galaxy, then Windows; fix protocol differences behind the adapter.
4. Build a separately identified native-helper preview only after license/source
   delivery and package-specific permissions work. No forced stable replacement.
5. Add BLE behind its own flag and real controller tests, then lease-based
   direct wireless through supported host APIs. Do not bridge institutional LANs.
6. Run bounded Apple research independently. Release stable Android/LAN/browser
   functionality when ready even if Apple remains unsupported.
