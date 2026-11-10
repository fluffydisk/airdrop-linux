# Cross-platform implementation status

This is the execution record for the architecture plan accepted on 9 November
2026. Baseline: `ebbfd152b562515bbf265f13e78d1420c36cc080` (v1.8.1).

See [protocol and licensing decisions](native-protocol-decisions.md) for the
upstream comparison and explicit go/no-go decisions, and [native validation](native-transport-validation.md)
for hardware, commands, acceptance cells and usability targets.

## A — Seamless sharing

Merged to main in PR #18, with v1.9.0 release preparation merged in PR #20:

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

The development helper revision additionally passed 215 Node tests, 12 Rust
tests (including published cryptographic vectors), and real compiled-helper
startup/shutdown. Its new namespace regression exposed the inherited empty-file
final-frame bug; the local source fixes that path and fails truncated sources.
The complete native transfer regression subsequently passed on x64 and ARM64 in
[workflow 42783011046](https://github.com/fluffydisk/airdrop-linux/actions/runs/42783011046).
Both endpoints run this implementation, so Android interoperability is still
unverified.

## Architecture and ownership

`desktop/main.js` owns the broker, existing Nearby/Devices lifecycles and optional
helper supervision. The sandboxed renderer receives sanitized snapshots through
the guarded preload IPC; it never spawns helpers or gets identity keys. File
paths must come from main-process file selection/drag authorization. Existing
background backend/installer ownership remains with the existing installation.

`lib/sharing/broker.js` exposes `snapshot()`, `send({recipientId,sources,retryId})`,
`startInvitation({sources,direction,provider})`, `stopInvitation()`,
`invitationLink()` and `stop()`. Current recipient records have `id`, `name`,
`kind`, `availability`, `trust`, `lastUsed` and `routes`. A route records
`transport`, route `id`, availability, `requiresAcceptance`,
`requiresNetworkChange` and `supportsResume`. Linux key fingerprints and
`quick-share:<ephemeral endpoint>` IDs are separate namespaces. Matching display
names never merges identities or trust. `lastUsed` supports recent ordering;
cross-protocol identity reconciliation remains a later explicit association.

| Boundary | Ownership / persistence |
| --- | --- |
| `lib/nearby.js`, `lib/peer-store.js` | mDNS/Linux identity, TLS pairing and pinning, explicit per-peer auto-accept, last authenticated endpoint hints, existing resumable chunk journals/history |
| `lib/devices.js`, `lib/device-share.js` | Existing local/provider state, workspace connection, gateway lifecycle and existing transfer engine |
| `lib/internet-connection.js`, `lib/tailscale-connection.js`, `lib/connection-service.js` | Existing Cloudflare/Tailscale/relay connection authentication and health; no new account or tunnel configuration flow |
| `lib/guest-share.js` | Revocable bounded guest session/token, selected file staging and download/upload grants; broker invitations default download-only |
| `lib/sharing/broker.js` | Recipient selection, provider choice and generation-bound invitation ownership; no duplicated native transfer journal |
| `lib/sharing/quickshare.js` | Hash-verified child process, request deadlines, sanitized recipient/transfer snapshots, fresh consent, private staging and inbox publication; bounded history without codes/source paths |
| `network/quickshare/src/main.rs` and vendored core | Quick Share discovery/negotiation/UKEY2/wire framing/native file transfer; bounded JSONL pipes and EOF shutdown; no persistent trusted-device policy |
| `desktop/{renderer,nearby-ui,sharing-ui}.js`, preload/main | Existing picker and file queue, consent/progress/cancel/completion, scoped invitation UI; no cosmetic redesign |

The adapters expose common product state without imposing a universal transfer
wire protocol. Linux retains its chunk hashes/resume. Quick Share completion
means native authenticated transport and local publication; it does not assert
Android verified the app's SHA-256 or supports resume. Browser invitations remain
sessions, not invented persistent device identities. Apple would own AWDL and
its HTTP/archive transfer behind a separate adapter only after the research gate.

Helper commands are `hello/start/snapshot/send/respond/cancel` over inherited
stdin/stdout with version 1, request IDs, deadlines and finite frames; no control
port is opened. Receive consent expires and never persists. Helper exit interrupts
only that transport; Linux and browser routes remain usable. Staging/publication
uses exclusive creation, safe names, regular-file checks and no-follow behavior;
consented manifests are immutable, and completion/cancel/crash cleans owned
staging without following symlinks. Adversarial resource/fuzz and physical
recovery testing remain native release gates rather than claimed finished
security certification.

## School-network diagnosis

No packet capture or network configuration from the original school failure is
available, so its exact cause remains unconfirmed. The old mDNS browse/publish
architecture depends on UDP 5353 multicast reaching peers and TCP reaching the
advertised endpoint; sharing one SSID establishes neither condition.

| Condition | What code can improve | Necessary fallback / limitation |
| --- | --- | --- |
| Multicast filtering | Revalidate a saved paired endpoint, unique service hostnames, bounded retry/status | New recipients need an explicit permitted invitation; no subnet scanning |
| Client isolation | Distinguish advertised-but-unreachable from online; keep fallback available | Cached addresses cannot make blocked TCP work; permitted Internet relay/browser route |
| Different VLANs | Restrict hints to on-link networks and avoid stale routes | No mDNS reflection or cross-VLAN bypass; permitted provider |
| Host firewall | Show discovery versus authenticated TCP failure and stable default port | Explain applicable app permission; do not open permanent global firewall rules |
| IPv4/IPv6 mismatch | Dual-stack listener and scoped link-local IPv6, positive subnet validation | A network/OS that disallows the address family still needs another route |
| Multiple interfaces / NetworkManager changes | Exclude loopback/container/VPN hints, retry verified endpoints on active LAN interfaces | Never stop NetworkManager or change AP/security policy to discover peers |
| Linux permissions / sandbox | Surface socket/start failures and retain browser sharing | Native BLE/raw radio privileges are separate from ordinary mDNS/TCP permissions |

## User journeys

- Linux → Linux: choose files, select reachable paired recipient, Send. First
  contact compares pairing codes on both machines. Receive prompts honor the
  existing explicit per-peer auto-accept choice. Offline paired devices remain
  visible; retry retains native resume semantics.
- Linux → Galaxy/Pixel (gated): native phone visibility/receive screen, choose
  recipient, Send, compare fresh code and accept on phone. No companion app.
- Galaxy/Pixel → Linux (gated): choose Android's native Quick Share target;
  Linux displays sender/files/size/code and explicit Accept/Decline. Only complete
  validated files appear in the inbox. Quick Share does not inherit Linux trust.
- iPhone ↔ Linux: use Share link / QR in stable builds. Native Everyone-mode
  AirDrop is an experimental dedicated-radio acceptance journey only; disclose
  temporary networking impact before taking a radio lease. Contacts-only and
  universal hardware support are outside current scope.
- School/client-isolated or different networks: retain selected files, choose
  Share link / QR, explicitly select a permitted HTTPS provider if needed, wait
  for verification, scan/send the scoped expiring link. Local HTTP is separately
  disclosed and requires direct reachability. If policy blocks every route, say
  so and preserve the queue; do not promise that a tunnel evades policy.
- Completion/cancel/retry: existing progress/history/notifications remain;
  native Linux can resume, Quick Share starts a fresh attempt, stopping an
  invitation revokes its link. A helper crash never empties the other routes.

## Remaining delivery plan

Ranges are engineering effort for an experienced Linux/protocol engineer, plus
independent review; they exclude procurement, OS/store review and upstream fixes.
They are planning assumptions, not delivery promises.

| Milestone / PR grouping | Outcome, dependencies and definition of done | Estimate / stable suitability |
| --- | --- | --- |
| A: recipient/fallback + discovery + independent network acceptance | PR #18; broker/UI/scoped guest sessions, preserved native features, required software/package CI green and no school-network bypass | Implemented; release candidate after CI. Originally roughly 2–4 engineer-weeks |
| B: core/provenance/IPC, Node supervision, opt-in UI, native CI | PR #19; pinned GPL core, no default enablement, independent-network transfer plus malformed-input tests, runtime exclusion guards, x64/ARM builds | Development foundation; 2–5 engineer-weeks total including hardening/review; source-only inclusion can precede Android support |
| C1: receive cleanup/resource/fuzz PR; C2: Pixel/Galaxy protocol fixes; C3: compatibility results | `network/quickshare`, adapter and physical lab. Cancellation/crash must clean partial staging without touching published/user files; parser/crypto/adversarial tests and both phone directions pass | 3–8 engineer-weeks with equipment; native preview only after these gates |
| D1: BLE capability/advertising/discovery; D2: direct-wireless lease/recovery | BlueZ/NetworkManager host service and package permissions; validate controllers, rfkill, concurrent advertising/scanning, driver P2P, no routing/forwarding, checkpoint restoration after kill/reboot | 4–10 engineer-weeks, highly driver-dependent; separate opt-in phases before stable |
| E1: pinned dedicated-radio prototype; E2: consent/archive/radio restoration | OWL/OpenDrop forks, validated radio/iPhone; native-list discovery and real file send/receive plus safety/recovery evidence | 2–6 engineer-weeks bounded research; experimental, independent of Android |
| F1: license/SBOM/source artifacts; F2: native packaging/update acceptance; F3: signed publication | Preserve installer update ownership, complete source obligations, both architectures, verified provider/invitation regressions and physical matrix. Use protected signing/store infrastructure | 2–5 engineer-weeks plus external review; stable only for individually validated transports |

Native format policy: DEB/RPM/AUR/AppImage can carry a helper but still need host
BlueZ/NetworkManager policy and dependencies; Flatpak/Snap require explicit
host/sandbox interface validation or a separately installed narrowly scoped host
service. No setuid Electron, broad passwordless sudo or bundled-binary assumption.

Release A as a minor semantic version after stable checks, with matching root,
desktop, locks and package manifests, release notes and same-source artifacts.
The release workflow intentionally pins publication to `1.9.0`; each new version
needs a reviewed update of that exact publication guard, not its removal.
Do not overwrite old releases/tags or route managed installs through portable
updates. Native previews have distinct prerelease tags/opt-in flags and must not
replace stable installations. Signed APT/RPM/Flatpak publication requires actual
protected signing access; disposable-key CI validates the machinery only.

## Prioritized continuation checklist

- [x] Merge the independently validated Linux/browser sharing work (#18).
- [x] Prepare and merge the v1.9.0 version, sandboxed AppImage acceptance and
  runtime helper exclusion gates (#20); monitor production publication separately.
- [x] Build the disabled Quick Share foundation, consent-bound staging/cleanup,
  bounded history, cryptographic input hardening and two-namespace regressions.
- [ ] Finish independent protocol fixtures, bounded fuzzing, full-disk/slow-peer/
  repeated-crash resource tests and cryptographic review for draft #19.
- [ ] Obtain the physical Pixel/Galaxy lab and validate both native directions.
  If a phone needs BLE to activate discovery, bring validated BLE discovery
  forward; a working LAN wire engine alone is not a shippable phone experience.
- [ ] Complete corresponding-source/SBOM/license review and architecture-specific
  signed native-helper previews with per-package host/sandbox acceptance.
- [ ] Validate BlueZ controller support and owned NetworkManager direct-wireless
  leases/checkpoints before enabling wireless conveniences.
- [ ] Run the bounded dedicated-radio Apple research independently; never make
  Android release depend on general AWDL support.

Ready-to-use continuation goal:

```text
/goal Finish Quick Share draft PR #19 against main using docs/cross-platform-implementation.md, docs/native-protocol-decisions.md and docs/native-transport-validation.md. Complete adversarial/resource validation and native Pixel/Galaxy acceptance, then prepare a legally complete signed helper preview. Preserve Linux/browser sharing, require fresh consent, and keep unavailable hardware results blocked. Enable BLE/direct wireless only after separate host/package validation. Keep Apple research independent. Respect existing release/signing/review gates and never claim untested interoperability.
```
