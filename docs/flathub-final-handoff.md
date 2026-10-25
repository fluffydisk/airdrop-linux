# Final Flathub technical handoff

Historical pre-device-sharing r1 record. See [the published r2 device-sharing report](flatpak-device-sharing-r2.md) for current GitHub Flatpak behavior and evidence. Earlier logs and Flathub policy findings remain preserved.

This is the preserved pre-publication Flathub audit. The maintainer subsequently
authorized independent GitHub distribution of the tested x86_64 bundle; see
the [publication record](flatpak-github-release.md) and README instructions. That publication does not change the Flathub
source-build or host-dependency verdict below.

**Not Flathub-ready.** The x86_64 reference has a clean offline build and executable
acceptance evidence, but Electron source-build compliance and host-dependent
inclusion remain unresolved. Native ARM64 is excluded, not advertised. This is
an internal reference; no submission, PR, push, release or workflow dispatch was
performed. Earlier evidence and failed attempts are preserved.

## Changes completed

- Restrict the reference and its validation workflow to x86_64 with `flathub.json`.
- Upgrade the reference's Electron runtime from 44.7.0 to **44.9.3**, the latest
  stable 44.x release in the checked official feed. Electron supports only the
  latest minor of each of its three supported major series; 45.0.0 is the newest
  major in that feed. This avoids a cross-major migration while fixing the stale
  runtime selection. The actual downloaded SHA-256 is
  `6e7fd2d450d442507b846ace4ae6e2bd17e1b1653e86a033b5231abfc23e6df4`.
- Fix production `body-parser` **1.20.8 → 1.20.9** for
  [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828).
  Only that transitive package changed. The application lock is fixed; the
  immutable v1.5.0 reference receives the same change through
  `dependency-security.patch` and a real-byte-verified npm cache entry. No
  publishing or unrelated distribution configuration changed.
- Add input-boundary/checksum/architecture regression tests, actual loopback
  listener checks, a malformed compressed-request survival test, runtime version
  and Electron isolation assertions, plus real uninstall/reinstall persistence.
- Let the validator accept `--manifest PATH` and stage only its declared inputs.
  A staging helper produces a minimal independent directory, source inventory
  and `SHA256SUMS`. No application checkout payload is silently copied into builds.
- Inventory actual ELF files, production npm packages, source checksums, licenses
  and sandbox grants; verify production lock integrity is covered by offline
  sources. Existing local/remote status and safe local fallback remain intact.

## Delivery and evidence

The complete independent directory is
`.test-artifacts/flathub-final/submission-final/`. The maintained reference remains
in `packaging/flathub-draft/`. The final evidence matrix and raw command/exit-code
reports are under `.test-artifacts/flathub-final/`; the review archive includes
those ignored artifacts and the previous sprint logs. Build repositories are
kept locally but are not bundled as a release.

| Artifact | Purpose |
| --- | --- |
| `secure-build/results.json`, `matrix.md`, numbered logs | Final clean offline build, lint, installed-package and removal results |
| `secure-build/source-inventory.json` | Every declared source, remote checksum/commit and local input hash |
| `secure-build/package-audit.json` | Actual ELF hashes, production dependency inventory, installed licenses and grants |
| `requirements-matrix.json`, `.md` | Official requirement → solution → exact command → status → log → remaining blocker |
| `research/current-electron-source-identity.json` | Current Electron/Chromium/Node source identities |
| `research/electron-44.9.3-verified.json` | Actual binary archive SHA-256, ELF architecture and version verification |
| `research/electron-44.9.3-prepare.log`, `.status` | Current source-preparation attempt stopped by capacity, not a compiled Electron |
| `sdk-current.json`, `.log` | SDK-packaged Builder attempt and its namespace failure |
| `npm-audit/server/audit.json`, `audit-fixed.json` | Original high-severity finding and zero reported production vulnerabilities after the fix |
| `npm-audit/desktop/audit.json` | Desktop production audit: zero reported vulnerabilities at query time |
| `payload-comparison.json` | Previous/new 44.7.0 app trees: all 5,371 files identical; not a claim about the later 44.9.3/security update or all OSTree bytes |

The full unit suite is **94 passed, 0 failed, 0 skipped**, including the new
compressed-request regression. Installed tests separately cover transfer bytes,
ZIP contents, system/shared clipboard, backend lifecycle, installation/removal/
reinstallation, persistence, permissions, Chromium sandbox, context isolation,
disabled renderer Node integration, X11 and native headless Wayland. Runtime
versions are read from the actual Electron process, not inferred from an archive
name. Portal and connection simulations are explicitly labelled as fixtures.

Failed checks remain evidence: old missing-tool/session/root/media failures,
the SDK namespace denial, earlier desktop harness failures, the first new package
auditor's bad Python import (fixed before the passing retest), and the original
npm audit finding. No failed attempt is relabelled as a successful build.

## Remaining blockers and decisions

| Item | Classification | Exact reason / next requirement |
| --- | --- | --- |
| Electron source build | Technical/policy blocker plus environmental limit | 44.9.3 remains a binary archive. Full offline Chromium/Electron compilation is not established. This worker has only 32 GB total disk, below the documented 100 GB free prerequisite. A verified complete source recipe/build on adequate compute, or an explicitly granted reviewer exception, is still required. |
| Full SDK Builder execution here | Environmental limit | Actual nested build fails to create a user namespace. Native builder succeeds without weakening module isolation. Repeat the SDK route on a normal supported host; no sysctl, seccomp or Chromium sandbox bypass was used. |
| Host Tailscale inclusion | Policy / pending reviewer decision | Local functions are real and independent, but supported cross-device sharing still requires host Tailscale sign-in, tailnet HTTPS and Serve. No inclusion decision or exception has been received. |
| Real Tailscale / physical desktop acceptance | Environmental / NOT TESTED | No authenticated tailnet, second device, physical GNOME/KDE session or input seat is available. Headless startup and fixtures are not substitutes for these particular interactions. |
| Branding/rights | Human decision | Identity/metadata/license declarations are consistent. This does not establish trademark rights in the Airdrop name/icon or guarantee reviewer approval. No speculative rename was made. |
| ARM64 | Excluded | Native execution was not available; `only-arches` is x86_64. This is not a blocker to the selected x86_64 scope. |

Only the first row's source identities are verified: Electron
`c542df1ecbc2c2978e8f53f8c7baf602404d166f`, Chromium 152.0.7977.167 at
`dd78960ccd8a03a2fe1f629543d27783885b78e9`, embedded Node v24.22.0 at
`f14cd3aa7bf9ca8df2cc5b8bb14beb0f335b1d93`. Preparing these revisions is not
proof that their full gclient/CIPD/Yarn/tool graph builds offline.

The official [source requirement](https://docs.flathub.org/docs/for-app-authors/requirements#building-from-source)
covers bundled source-available runtimes. Its case-by-case exception wording is
not automatic approval for Electron or insufficient worker capacity. The general
[Flatpak Electron guide](https://docs.flatpak.org/en/latest/electron.html) does
not grant a Flathub exception. The installed BaseApp contains Zypak/supporting
libraries, no Electron executable; the signed x86_64 runtime catalog contained no
replacement Electron runtime. Fetching another prebuilt binary would not fix the
source requirement. A WebKitGTK shell would require an actual port of Electron
IPC, dialogs, clipboard/image and lifecycle behavior; it was not substituted for
the existing architecture or presented as feature-equivalent.

The official [host-dependency rule](https://docs.flathub.org/docs/for-app-authors/requirements#host-dependent-applications)
also requires explicit case-by-case acceptance for exceptions. A viable migration
candidate is [Tailscale tsnet](https://tailscale.com/kb/1244/tsnet): a userspace
network stack can expose the existing loopback gateway without a host daemon,
TUN device, host execution or filesystem grants. Its login URL, private state,
tailnet HTTPS certificates, reverse-proxy origin handling and disconnect/quit
behavior need implementation and real account/device validation. It changes the
authentication/setup model, and is not a verified drop-in solution here. Neither
this migration nor a reviewer exception is claimed complete.

## Final permission review

| Grant | Reason |
| --- | --- |
| Network | Loopback backend, transfers and outbound Web Push; it does not itself restrict outbound destinations |
| Wayland / fallback X11 | Desktop windows; the Wayland test removes DISPLAY |
| IPC | X11 shared-memory integration |
| DRI | Normal graphics acceleration; current headless tests use software rendering |
| StatusNotifierWatcher talk | Optional tray, no unrestricted session bus |
| GTK_USE_PORTAL | Portal preference, not a filesystem grant |

No host/home filesystem, host execution, system bus, Tailscale socket or device
grant was added. File/background interactions use portals. Both backend ports
are tested for loopback binding; host processes can still access that loopback
service because network is shared. Installed grants are recorded verbatim.

## Validate an independently authored manifest

On a disposable x86_64 Linux account with usable Flatpak namespaces, install the
signed 26.08 Platform/SDK, Electron2 BaseApp, node24/rust-stable extensions and
`org.flatpak.Builder` using the standalone README. For the complete harness also
install Node 24, Python 3/PyYAML/GI, D-Bus, Xvfb, Weston, desktop-file-utils,
AppStream and project npm dependencies; dufs 0.46.0/systemd-analyze are required
for the host tests to run without skips. Keep ports 5000/6001 free.

```sh
npm ci --ignore-scripts
python3 scripts/stage-flatpak-reference.py \
  --manifest /path/to/independent/io.github.fluffydisk.airdrop-linux.yml \
  --output /tmp/airdrop-independent-stage
(cd /tmp/airdrop-independent-stage && sha256sum -c SHA256SUMS)
umask 022
python3 scripts/validate-flatpak-reference.py \
  --manifest /tmp/airdrop-independent-stage/io.github.fluffydisk.airdrop-linux.yml \
  --arch x86_64 --builder sdk --output /tmp/airdrop-independent-results
```

Use fresh paths for every run. For a host with native flatpak-builder, stripping/
debugedit/composer tools and the official linter installed, use
`--builder native --linter 'flatpak-builder-lint'`. The native path is separately
identified in reports. Machine-specific private tool paths used in this cloud
worker are recorded in the raw commands, not embedded in recipe sources.

From the standalone stage itself, the essential build-only sequence is:

```sh
flatpak run --user --command=flatpak-builder-lint org.flatpak.Builder manifest io.github.fluffydisk.airdrop-linux.yml
dbus-run-session -- flatpak run --user --command=flatpak-builder org.flatpak.Builder --download-only --disable-rofiles-fuse fetch-build io.github.fluffydisk.airdrop-linux.yml
dbus-run-session -- flatpak run --user --command=flathub-build org.flatpak.Builder --disable-download --disable-cache --disable-rofiles-fuse --jobs=2 --repo=repo io.github.fluffydisk.airdrop-linux.yml
flatpak run --user --command=flatpak-builder-lint org.flatpak.Builder repo repo
```

Before manual submission, compare source pins/patches/offline cache coverage,
actual runtime versions, grants, ID/desktop/icon/AppStream consistency, licenses,
real screenshot URLs, independent path closure and each acceptance result. Keep
the Electron security and body-parser fixes. Complete the remaining source-build,
host-dependency and real-device requirements above; retain all failures/skips.
Independently authoring the final manifest and submitting manually remain human
steps, but they are **not yet the only remaining steps**.
