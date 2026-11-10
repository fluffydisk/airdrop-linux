# Native Quick Share execution record

Authoritative scope: implement the owner's 10 November 2026 production plan on
PR #19, extending the existing Electron/Node/Rust design. Stock Android native
Quick Share must work in both directions without another Android app, URL or QR.
Existing Linux Nearby and browser transports remain supported independently.

Baseline: main dfaf9091a63deb553e93a5c627ad2bfac666b129, PR #19 head
6a9b53c5e52a43d1107932631ee3cc2c30b0c794, latest published stable v1.9.0.
Refresh release/ref/check state again before publication; v1.10.0 is a candidate,
not a reserved version. No publication or stable enablement is authorized by a
successful software-only test result.

## Implemented hardening

- Cancellation-safe persistent frame prefixes in both roles. The actual inbound
  request regression splits the prefix around an unrelated broadcast.
- Symmetric setup-payload bounds: negative dimensions, inconsistent declarations,
  offsets, final-size mismatches, count and aggregate memory limits. Completed
  payload buffers are released; authenticated malformed-payload tests exercise
  the real outbound decrypt/parser path. Incoming chunk-ID tracking is bounded.
- Original transfer UUID retained through outbound handshake failures. A real
  TCP malformed-peer test verifies error events carry that UUID.
- Immutable terminal records in wrapper and adapter, including coalesced events;
  stale phase regressions are ignored. Incoming helper completion is provisional
  until consent, manifest and publication checks pass. Names shown for consent
  must match staged basenames. Failure cannot leave a forged complete record.
- Finalization rejects malformed crypto and late payload failure/cancellation.
  All-bytes-sent is explicitly `outcome-unknown`, not completed delivery. The UI
  asks users to check the receiver before repeating the send. Positive durable
  remote outcome handling remains a stable release gate.
- Connection metadata no longer advertises unimplemented Direct/hotspot roles
  or responds to PACKET_SEND_META experiment variables.
- Advertisement parsing respects Google's no-name flag, versions 0/1 and TLV
  bounds, with explicit compatibility for existing 17-byte/empty-name Samsung
  advertisements. Emitted name lengths cannot wrap or split UTF-8. These are
  source-based Google-reference fixtures, not an executed independent peer.
- Sanitized diagnostics export capability/status and bounded queue counts only;
  it excludes names, identities, addresses, paths, codes and raw error strings.
- Quick Share helper failures remain visible even with Linux Nearby disabled.
- Development helper metadata binds commit/dirty state, compiler, lock and local
  source-tree digest. The builder respects Cargo's configured target directory.
- Native validation runs for all PRs and is reusable by the release workflow.
  ARM64 Snap gets a measured bounded cold-build budget and retained diagnostics.
- Chromium BSD schema notices and file-indexed modification records are added.
  Historical provenance and full binary legal compliance remain gated.
- Compatible dependency fixes address high-severity Electron/Undici findings;
  remaining moderate archiver/glob/minimatch issues require targeted follow-up.

## Evidence and remaining work

Never merge these evidence categories: same-core regression; independent
protocol compatibility; physical stock-device acceptance. Two helpers in separate
network namespaces remain the first category even with correct hashes.

| Milestone | State / next objective | Exit condition |
| --- | --- | --- |
| M1 audit | Reproductions and baseline complete | Preserve source refs, logs and honest hardware blockers |
| M2 hardening | First remediation implemented; broader robustness work pending | Independent complete UKEY2 fixtures/peer, cancellation at every stage, supervision, per-file immutable IPC manifests, publication/crash journal, measured resource/fuzz tests |
| M3 discovery | Minimum BLE bootstrap implementation and physical baseline pending | Pixel/Galaxy list Linux, authenticated matching codes and native prompts; no dependence on LAN-only behavior |
| M4 native files | Same-core traffic only verified | Stock phones exchange corpus both directions with independent hashes and accurate outcomes |
| M5 physical acceptance | BLOCKED: no phones or radio controllers attached | Complete lab procedure, negative cases, 30 discovery attempts and 100-transfer soak per model/direction |
| M6 distribution | Stable exclusion preserved; native packaging not implemented | All six formats/architectures run the actual helper; matching corresponding source, notices/SBOM and required legal review |
| M7 release | BLOCKED by M3–M6 | Required checks/signing, package upgrades/rollback, real Android evidence bound to final artifacts |

M2 depends on M1 (2–4 engineer-weeks originally estimated), M3 on M2 (3–6),
M4 on M3 (2–4), M5 on M4 (1–3), M6 can overlap after M2 (2–4), M7 follows
M5+M6 (0.5–1.5). These are engineering estimates, not time spent or promises;
hardware/access waits are additional. Use narrowly reviewed stacked PRs, with
stable enablement in a final small evidence-bound change.

## Bluetooth decision and scope

Choose B: minimum BLE before broad stock Samsung/Pixel stable support. Reports
are model/build-dependent, not a universal claim that Android cannot use LAN.
See rquickshare #425, Packet #122/#140, and open-quickshare's
`docs/BLE_RECEIVER_DISCOVERY.md` at fb9c8f9. Some current Send interfaces drop LAN
discovery; a receiver beacon alone does not provide the subsequent BLE session.

Split the vendored `experimental` feature rather than enabling it wholesale:
FastInit FE2C while sending; Nearby FEF3 receiver advertisement and endpoint-info
GATT; bounded weave stream; existing authenticated protocol; Wi-Fi LAN upgrade
with correct LAST_WRITE/SAFE_TO_CLOSE ordering and consistent endpoint identity.
No hotspot, Wi-Fi Direct, unrelated L2CAP or AWDL by default. Address dormant
GATT unbounded ingress/reassembly, sequence/version/MTU validation, advertisement
lengths, controller ownership and scan/HID/suspend regressions before activation.
Detect BlueZ capability/permission/rfkill failures without powering radios on
implicitly. Prefer legacy advertisement plus slot fetch where needed.

If captures demonstrate LAN upgrade cannot meet a required stock workflow,
record a stable no-go and separately scope the minimum essential transport.
Do not silently expand into network orchestration.

## Native edition and release gates

The helper remains disabled and excluded from ordinary packages. Recommended
packaged resolver: process.resourcesPath/quickshare/<arch>, outside ASAR, with
immutable binary/manifest/notices. Build native x86_64 and aarch64 release
artifacts on supported ABI baselines; normalize ELF once, then hash. Verify each
final extracted/installed package, not just build output.

AppImage needs mounted/extracted execution; DEB/RPM/AUR need correct dependencies
and licenses; RPM automatic requirements are currently disabled. Flatpak needs
offline Cargo/Git sources, scoped BlueZ and working child file-portal grants.
Snap needs actual strict-confinement BlueZ interface/store connection validation.
No whole-home grants, classic confinement or privileged radio helper shortcuts.
Where a package cannot meet acceptance, keep native functionality disabled there.

Treat the native edition conservatively as GPLv3-compliant combined distribution,
preserving MIT/Apache/BSD grants. IPC alone does not settle copyleft scope. Before
any native preview binary: resolve applicable licensing/installation obligations,
ship exact complete corresponding source beside artifacts, audit target/feature
dependencies, and rebuild both architectures from that source. The existing
source archive/provenance is not yet that completed deliverable.

Stable requires independent fixtures/peer, full Node/Rust/Electron checks,
physical Samsung/Pixel both directions, installed-package/architecture acceptance,
dependency/legal gates, source matching and upgrade/rollback. Keep signing and
required checks. Preview needs explicit prerelease-aware version/channel support
and separate update/package channels; current stable-only version scripts need
changes. A hardware-blocked preview must say Android interoperability unverified.

## Next execution

Continue on PR #19 without recreating its Samsung/Windows/crypto/staging fixes.
Complete remaining M2 independent and failure coverage, obtain the M3 physical
baseline, then implement minimum BLE behind a development gate. Follow
quickshare-android-lab.md. Never turn missing hardware into a successful test.
Do not enable or publish stable native support before the gates above pass.
