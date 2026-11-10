# Cross-platform implementation status

This is the execution record for the architecture plan accepted on 9 November
2026. Baseline: `ebbfd152b562515bbf265f13e78d1420c36cc080` (v1.8.1).

## A — Seamless sharing

Implemented on `feat/seamless-sharing`:

- Application-owned sharing broker wraps the existing Nearby and guest engines.
- Transfer queues files until Send. Files-view uploads still copy immediately
  into the shared workspace, independently of the Transfer recipient.
- Share link / QR is always available. It preserves the queue, requires an
  explicit connection choice when no provider is ready, waits for verification,
  and grants only downloads of the selected files. It does not grant workspace,
  clipboard or upload access. Legacy bidirectional guest sessions remain.
- Invitations are revoked on cancellation and become unavailable after expiry,
  provider changes, replaced sessions or tunnel recovery. Copy validates current
  state rather than trusting the displayed URL.
- Nearby accepts positively on-link IPv4/IPv6 endpoints, including public campus
  subnets. Link-local IPv6 uses the interface scope. Container/VPN interfaces,
  loopback, multicast and off-link targets are excluded from discovery hints.
- A dual-stack listener prefers TCP 53318, with an ephemeral fallback on conflict
  and a configurable port. Existing version-1 peers still use the advertised port.
- Paired endpoints are persisted as hints, checked again for current on-link
  reachability and authenticated with the existing certificate pin before use.
- Probe concurrency is bounded and renaming only restarts discovery.

`scripts/test-sharing-networks.sh` is a disposable-VM acceptance harness. It
tests two network namespaces on a normal LAN, multicast filtering followed by a
restart with a cached authenticated endpoint, and denied peer TCP with a separate
simulated permitted relay. The relay fixture is not a Cloudflare acceptance test
and does not establish that any real school's policy permits a public tunnel.

No subnet scan, mDNS reflector, institutional configuration change or filtering
bypass is introduced. LAN guest links still use HTTP; on an untrusted network use
a permitted HTTPS provider. A local gateway probe does not establish remote LAN
reachability, and the UI says so.

## B — Quick Share foundation

The separate development branch adds a GPLv3 headless Rust helper, a pinned
vendored core, versioned bounded JSON IPC, an independently supervised Node
adapter, private receive staging and source/license provenance. The helper has
compiled and passed native lifecycle tests without BlueZ on Linux x64.

For development only, build with `node scripts/build-quickshare.js`, run
`npm run prepare-desktop`, and launch Electron with
`AIRDROP_EXPERIMENTAL_QUICK_SHARE=1`. This requires Rust/protoc and the exact
hash-verified helper in the source checkout's `.cache/quickshare/<arch>`.
It does not download or enable a helper in stable packages. The opt-in path adds
Quick Share recipients to the existing picker and compares codes for each
receive; it grants no persistent trust or resume capability.

The runtime packaging copy filter excludes the experimental source/build trees
and rejects misplaced helper binaries. This applies to native channel payloads,
portable releases and the standalone installer bundle. Source archives preserve
the complete GPL-covered helper source and license.

Initial resource/path tests, IPC tests and same-host lifecycle tests are software
evidence. They do not establish Pixel, Samsung or Windows interoperability.
The dedicated native workflow tests x64 and ARM64. Android enablement, independent
cryptographic fixtures/fuzzing, full resource/crash coverage and signed native
helper distribution remain release gates.

## C — Native Quick Share interoperability gates

Selected research base: `ignotusbucius/open-quickshare` core at
`fb9c8f9502e5313e3d788aa3498659773ef12d28`. Native integration must remain
disabled until receive-path/resource hardening, helper lifecycle tests and the
Pixel/Galaxy physical acceptance matrix pass. Device names are not identities;
the upstream frontend's name-based auto-accept must never be imported.

The root upstream license is GPLv3; its excluded Tauri frontend declares AGPL.
Any imported core must have explicit provenance, notices, corresponding source
and an audited license boundary. The integrated edition cannot be called MIT-only.

## D — Wireless convenience gates

BLE and network-changing mediums require per-controller, per-driver and
per-package acceptance. Do not inherit the upstream hotspot commands unchanged:
use owned network leases/checkpoints, disclose temporary Wi-Fi disconnection,
verify crash restoration and prevent upstream forwarding/bridging. No permanent
firewall change or broad privilege grant is part of default installation.

## E — Experimental AirDrop gates

Separate research track, disabled by default. Start with a dedicated validated
radio. MT7921/MT7922 reports do not establish general support. No automatic kernel
patches, passwordless sudo rule, Apple credential extraction or global
NetworkManager shutdown. Require safe archive extraction, explicit acceptance,
native Apple-list discovery and separate send/receive hardware results.

## Release gates

- Preserve the MIT core, application ID, existing identities/journals and data.
- Do not publish a stable transport based on mocks or same-host tests.
- Public repository availability is checked independently of GitHub releases.
- Preserve protected signing and package-manager update ownership.
- Flatpak/Snap wireless permissions require their own validation/review.
- Flathub manifests and submission/review material require independent human
  authorship under the current Flathub policy; agents must not submit them.
- AUR publication depends on actual account access.

Physical hardware is absent from the current cloud environment. Record device,
OS/firmware, driver, protocol version, application/helper commits and artifact
hashes for each physical result; unavailable cells stay blocked.

## Executed validation

The seamless-sharing branch passed 202 Node tests with pinned Node 26/dufs,
sandboxed Chromium guest/browser tests, and sandboxed Electron workspace and
Linux send/receive tests. Sharing validation run `42727686792` also passed
independent namespaces: ordinary discovery, multicast-blocked restart with a
cached authenticated endpoint, and isolated peer TCP with a permitted simulated
relay. Tray acceptance skipped where no StatusNotifier watcher was available.

No physical phone, Wi-Fi Direct, BLE or Apple AirDrop result is recorded.
