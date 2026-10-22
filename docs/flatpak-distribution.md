# Upstream Flatpak distribution

This is the project's own **AI-assisted** packaging. It is not a Flathub
submission and does not claim human authorship. Flathub is used only as a source
of signed Freedesktop runtimes, SDK extensions and the Electron BaseApp.

The application ID is `io.github.fluffydisk.airdrop-linux`, corresponding to
<https://github.com/fluffydisk/airdrop-linux>. Existing native installations and
the earlier `io.github.fluffydisk.Airdrop` sandbox keep their own data. This
package does not silently migrate, import or delete it.

## Build inputs

The YAML manifest is
[`packaging/io.github.fluffydisk.airdrop-linux.yml`](../packaging/io.github.fluffydisk.airdrop-linux.yml).
It uses Freedesktop 26.08 and Electron2 BaseApp 26.08 on x86_64 and aarch64.

- Application JS/HTML/CSS comes from the immutable v1.5.0 source commit. An
  explicit patch applies the existing upstream desktop identity fix; the release
  tag and original release assets are unchanged.
- Node 24 LTS comes from the signed Freedesktop SDK extension, following the
  standard Electron/Flatpak packaging approach. The application supports Node
  18 or later. dufs 0.46.0 compiles from checksum-pinned source inside the SDK;
  Cargo dependencies come from its lockfile. Node itself is not rebuilt here.
- Production server/desktop npm dependencies and the build-only Browserify
  toolchain come from lockfiles and integrity-checked offline caches generated
  by the official `flatpak-builder-tools`. Install scripts are disabled.
- JSZip's browser bundle is rebuilt from its JavaScript sources. Licenses are
  retained, including npm licenses and the bundler's runtime/shim licenses.
- **Electron 44.7.0 is the official prebuilt runtime**, with a separate pinned
  SHA-256 per architecture. Chromium/Electron itself is not compiled from source
  by this manifest. Zypak integrates its process sandbox with Flatpak; Chromium's
  sandbox is kept enabled. The unused upstream SUID helper is removed.

Every module builds without network access. The CI downloads all declared
sources first, then invokes the builder with `--disable-download`. Application
assembly also asserts that only the loopback network interface exists. Neither
npm nor Cargo can fall back to an online registry during assembly.

`scripts/prepare-flatpak-release.sh vVERSION` is the separate **online** update
phase. It resolves a published stable tag to its exact commit, verifies the
application version, refreshes source/runtime checksums and regenerates npm/Cargo
dependency descriptions from that release's lockfiles. The generator tools are
commit- and archive-hash-pinned in the Actions workflow. A new release already
containing the identity fix does not receive the v1.5.0 compatibility patch.

## Sandbox permissions

| Permission | Purpose |
|---|---|
| Network | Local backend communication, file transfer, web push and configured host Tailscale HTTPS endpoints |
| Wayland / fallback X11 | Desktop window; X11 compatibility on older sessions |
| Shared IPC | X11 shared-memory support |
| DRI | GPU-accelerated rendering |
| `org.kde.StatusNotifierWatcher` | Optional tray registration |
| Desktop portals | User-selected file access, external open and background consent |

There is no whole-home or whole-host filesystem grant, system bus access,
unrestricted session bus access, host command execution, device-wide access or
audio grant. Normal application data stays under
`~/.var/app/io.github.fluffydisk.airdrop-linux/`. Host Tailscale login/HTTPS Serve
is separate; no VPN daemon runs inside the sandbox. Local use does not require
configuring Tailscale.

## Automated validation and publication

**Build and distribute Flatpak** builds natively on both architectures, validates
desktop/AppStream metadata, runs the official manifest/repository linter and
tests installation, backend upload/download/ZIP contents, host-home isolation,
clipboard round trip, Chromium sandbox state, managed updates, shutdown and
native Wayland startup under Weston. Runtime fixture tests are not substituted
for this source manifest build.

Both builds and lint must pass before `.flatpak` bundles are appended to GitHub
Releases. `FLATPAK-SHA256SUMS` is separate from the immutable original
`SHA256SUMS`. Repeating an interrupted upload compares existing bytes and only
uploads missing assets; mismatches fail instead of overwriting files. Native
VMs then download the actual public URLs, verify hashes and repeat real
installation and application tests.

The signed repository helper imports both validated bundles and signs commits
and summary with the **existing** native repository signing key. CI tests it
with a disposable key. The native Pages publisher carries forward the newest
complete Flatpak release even when a newer release initially has only native
packages. Partial Flatpak releases fail validation instead of silently
downgrading or deleting the remote.

Production signing/Pages deployment retains the existing `package-publishing`
environment reviewer and main-branch requirements. Successful public bundle
tests request that protected publication; they do not approve it. This is the
only additional platform approval needed for the optional repository, and does
not block independent GitHub bundle distribution.

## Current acceptance limits

Only completed Actions jobs establish successful builds/installations. Headless
X11/Wayland tests do not certify physical-input Wayland clipboard handling,
interactive file/background portal consent, tray integration on every desktop,
or real remote Tailscale-device reachability. These are not silently marked as
passing.

The current Flathub requirements (documentation commit
`b1f0539de6aed7aa26e097ede5de936510ab1df0`, checked 2026-10-22)
prohibit AI-generated or AI-assisted manifests and agent-created submission PRs
and submission/review text. Human review alone does not change this manifest's
origin. This package can be distributed upstream without a Flathub application;
no disguised submission is made. See [Flathub readiness](flathub-readiness.md).
