# Protocol core provenance and modifications

Original source: ignotusbucius/open-quickshare commit
`fb9c8f9502e5313e3d788aa3498659773ef12d28`, core only. Original input hashes are
preserved in `upstream-files.sha256`; those hashes deliberately do not describe
our modified files. The upstream Tauri/AGPL application is excluded.

The upstream GPLv3-or-later grant remains in the original license. This
distribution selects GPLv3 for its covered modifications; selecting that version
does not remove the upstream recipients' original rights. Existing MIT and
Apache/BSD component grants remain in effect.

Files modified by Airdrop Linux, recorded 2026-11-10:

| File under vendor/rqs_lib | Changes |
| --- | --- |
| Cargo.toml | Locked Git dependencies; disabled default wireless features; release profile moved to workspace root |
| src/channel.rs | Separate typed protocol diagnostics containing no transfer metadata |
| src/lib.rs | Local receive directory; scoped inbound listener; headless modules and feature guard |
| src/manager.rs | Bounded incoming sessions/timeouts; correct outgoing UUID on failure |
| src/utils.rs | Anonymous advertisements, validated P-256 coordinates, persistent frame prefix, version/name/TLV bounds |
| src/hdl/mdns.rs | Register initial receiver visibility and keep private device names out of logs |
| src/hdl/mdns_discovery.rs | On-link address filtering, bounded probes, closed-channel exit |
| src/hdl/inbound.rs | Consent, safe names/private staging, file completion bounds, shared setup-payload limits, cancellation-safe prefix and consent-gated RFCOMM to Wi-Fi LAN upgrades |
| src/hdl/outbound.rs | Safe source reads, empty/truncated source handling, shared payload bounds, truthful LAN roles, finalization errors and unconfirmed sender outcome |
| src/hdl/mod.rs | Local payload assembler and explicit sent-but-unconfirmed state |
| src/receive_safety.rs | Added filename, count and size limits |
| src/secure_payload.rs | Added MAC-before-parse, CBC/padding checks and vectors |
| src/bytes_payload.rs | Added symmetric bounded setup reassembly and regression tests |

Wrapper `src/main.rs` and the tests are local additions. File headers identify
modifications; this index supplies their scope. Future changes must update this
record rather than replacing original attribution or original-input hashes.

Binary publication is still blocked. Complete corresponding source, enabled
dependency license/SBOM review, final-package source/binary provenance,
installation-information assessment and required specialist review remain gates.
IPC separation is not a copyleft exemption. See THIRD-PARTY-NOTICES.md for the
Chromium schema's distinct BSD terms and remaining historical mapping question.

2026-11-10 owner-assisted lab addition: wrapper `src/fast_init.rs` borrows FE2C
advertisement bytes from upstream core_lib/src/hdl/blea.rs at the same pin,
retaining GPL terms. The new wrapper feature uses bluer/D-Bus only for a bounded
sender advertisement, with vendored libdbus for portable development builds.
Dependency/source obligations for any binary distribution still need audit.
It does not enable the upstream experimental GATT/L2CAP/hotspot paths.

Owner-lab diagnostics also publish named protocol state transitions without any
metadata when the original update requested no public metadata. Keys, codes,
addresses and payload contents are never part of those diagnostic transitions.
The adapter preserves them separately from coalesced progress; lab export maps
session IDs to bounded per-run aliases and allowlists stage names.


2026-11-10 native BLE wrapper addition: `src/ble/{bloom,protocol,radio}.rs`
implements the separate bounded bootstrap described in
`docs/quickshare-ble-implementation.md`. `bloom.rs` adapts the existing pinned GPL
`blea.rs` hash/Bloom code; original upstream experimental modules remain disabled.
Core `src/lib.rs` exposes the run's endpoint ID and new BLE schema module;
`utils.rs` correlates ephemeral BLE/LAN/connection metadata; `mdns_discovery.rs`
adds optional route/correlation fields; `outbound.rs` permits a bounded duplex
without enabling bandwidth upgrade. The former test-only Duplex trait impl is
now shared with this production development path; its tests are preserved.

`build.rs` additionally compiles `src/proto_src/ble_frames.proto`, copied unchanged
from google/nearby commit `1bbe8ec1eadd0c08d01db6b634254526141068e6`, path
`proto/mediums/ble_frames.proto`. Original Google Apache-2.0 attribution and
license text are retained. Original-input hashes for the earlier GPL vendor pin
are not rewritten. Binary distribution and Samsung compatibility remain gated.

## 2026-11-11 — physical S24+ evidence and observation-only finalization

`channel.rs`, `manager.rs` and `hdl/outbound.rs`: add fixed-category connection
method and finalization observations. Direct TCP acceptance/connect, payload
emission completion, peer EOF/disconnection, close timeout, matched-file payload
receipt ACK and late errors are distinct. No wire frame, cryptography, consent,
file staging, completion-state mapping, keepalive handling or wait duration was
changed. EOF/disconnection/receipt ACK never upgrades `Sent` to `Finished`.

Incoming TCP method observations are emitted only after a valid Nearby connection
request populated remote metadata. The laboratory's connect-and-close listener
probes do not create peer attempts or exhaust evidence aliases. Outgoing method
observations follow successful TCP connection. Both are diagnostic-only.

## 2026-11-12 — advertising registration lifecycle

The helper now implements a minimal standard LEAdvertisement1 publisher with
explicit connection/I/O ownership; local GATT/scanning remain on bluer. Failed
publication and cancelled registration close their private bus owner; successful
handles unregister with a one-second bound. A private D-Bus peer checks lifecycle
and serialized parameters, not RF behavior. The callback accepts only the
resolved BlueZ owner, honors Release, and never exports identifiers or messages.

Direct optional dbus-tokio/dbus-crossroads dependencies reuse already locked
versions. No new dependency version or upstream code was imported. All new source
is original GPL-3.0-only repository work. BlueZ 5.87 documentation/implementation
was inspected for public API and UUID/length behavior, not copied. TCP/secure
session code, transfer/consent/finalization behavior and dormant experimental
wireless features are unchanged. See docs/quickshare-s24-advertising-failure.md.

## 2026-11-14 — serialized advertisement replacement

Normal renewal, partial-dual fallback, visibility and shutdown await bounded
unregister/owned-I/O cleanup before replacement. Cancellation retains an observed
RAII fallback. Structured lifetime/cleanup diagnostics separate local withdrawal
from BlueZ Release; private D-Bus tests model delayed unregister, errors, repeated
registration and cancellation. Exact known public BlueZ error literals map to
fixed tags only; raw messages and identifiers remain excluded. Controller MGMT
completion and initial RF visibility are explicitly unproven. No transport,
cryptography, consent, staging or feature-default change is included. All new
code is original GPL-3.0-only work using the existing dependencies.

2026-11-15 post-consent follow-up (stacked on PR #22):

- `channel.rs`: private session-boundary diagnostics contain closed stage/cause
  constants only. No error strings, verification codes or payloads are exported.
- `hdl/inbound.rs`: report successful local encrypted consent-response writing
  separately from remote receipt; report authenticated file/BWU boundaries once.
  Reject unsolicited unsupported `UPGRADE_PATH_AVAILABLE` on the current encrypted
  channel with `UPGRADE_FAILURE` and original path information. Never send
  `SAFE_TO_CLOSE_PRIOR_CHANNEL` without an installed replacement transport.
  The helper still has LAN upgrade disabled; dormant experimental wireless stays
  disabled. No cryptographic, consent, payload-limit or publication bypass.
- Wire behavior checked against Google's `BwuManager::RunUpgradeFailedProtocol`
  and `OnBandwidthUpgradeNegotiationFrame` in google/nearby at the source revision
  documented in `docs/quickshare-s24-post-consent.md`. Independent Python/OpenSSL
  fixtures authenticate/decrypt the consent response and BWU failure, and verify
  payload integrity through the active BLE byte-stream bridge. Tests do not
  constitute Android hardware interoperability evidence.

## 2026-11-17: T30 opt-in cross-layer observation

Added `rqs_lib::lab_trace`, a bounded nonblocking Unix datagram metadata sink,
active only with an explicit lab trace socket. Inbound frame/state/consent/file
write progress gets origin CLOCK_MONOTONIC timestamps; native Classic wraps the
actual stream to observe read/write completion/EOF and shutdown. No payload,
filename, address, verification code or cryptographic material is serialized.
Transport policy, deadlines, authentication, framing and radio configuration are
unchanged. Receiver progress is never inferred from telemetry or socket writes.
Tests cover full-sink nonblocking loss, fixed-schema privacy, monotonic clock and
unchanged byte/backpressure/EOF/shutdown behavior.
