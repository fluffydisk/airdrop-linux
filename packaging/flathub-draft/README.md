# Airdrop Linux: working Flatpak reference

This is a technical reference for independent manifest development, not a Flathub
submission. The full validation procedure, evidence matrix and comparison
checklist are in upstream `docs/flatpak-reference.md`. The directory name is kept
to continue the existing work. Source-build and untested integration limits remain
explicit even when the packaged application runs successfully.

Copy this entire directory into an otherwise empty repository. It contains the
correctly named manifest, the two generated offline dependency source lists and
the compatibility/metadata patches. No symlink or `../` source refers back to the
application checkout. There is no application binary or copied application source
in this directory.

The application archive is immutable v1.5.0. Build helpers, build-tool lockfiles
and original desktop/metainfo files are separately fetched from immutable
upstream commit `54382392a6897eda9629de7ba4a48926d0a774fd`, with SHA-256 values
verified against downloaded bytes. `metadata.patch` applies the reviewed store
description, explicit Tailscale setup link, search keywords and screenshot caption.
It is applied after those original files are downloaded. A later upstream release
can incorporate these packaging changes and remove the corresponding patches.
`connection.patch` adds the reviewed local/remote status distinction, a bounded
HTTPS health check and a local fallback when the saved workspace cannot be
reached. It applies to the pinned v1.5.0 source after `application-id.patch`.
It contains no dependency or permission expansion.
`dependency-security.patch` updates the pinned server lock from body-parser
1.20.8 to 1.20.9 for GHSA-27r3-jxmh-p828. The matching single npm source/cache
entry is refreshed from the real lock integrity and verified downloaded tarball,
using the same npm cacache SHA-512 layout as the existing generator output. The
remaining generated graph is unchanged; complete production-lock cache coverage
and a download-disabled build are checked. The reference Electron runtime is
44.9.3; the application's original development lock is not used to fetch it.

The dependency JSON files were generated using the pinned official
flatpak-builder-tools described in the upstream release workflow. When changing
application or build-tool versions, regenerate dependencies from their actual
lockfiles and verify a download-disabled build on each architecture. Do not copy
new lockfiles into a recipe with an old cache description.

## Build and validate

From this directory on a normal Flatpak-enabled Linux desktop:

```sh
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user --noninteractive flathub org.flatpak.Builder \
  org.freedesktop.Platform//26.08 org.freedesktop.Sdk//26.08 \
  org.electronjs.Electron2.BaseApp//26.08 \
  org.freedesktop.Sdk.Extension.node24//26.08 \
  org.freedesktop.Sdk.Extension.rust-stable//26.08
flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest io.github.fluffydisk.airdrop-linux.yml
flatpak run --command=flatpak-builder org.flatpak.Builder --download-only \
  --disable-rofiles-fuse fetch-build io.github.fluffydisk.airdrop-linux.yml
flatpak run --command=flathub-build org.flatpak.Builder --disable-download \
  --disable-rofiles-fuse --jobs=2 --default-branch=stable --repo=repo \
  io.github.fluffydisk.airdrop-linux.yml
flatpak run --command=flatpak-builder-lint org.flatpak.Builder repo repo
flatpak install --user --noninteractive ./repo io.github.fluffydisk.airdrop-linux
flatpak info --user --show-permissions io.github.fluffydisk.airdrop-linux
flatpak run --user io.github.fluffydisk.airdrop-linux
```

Use fresh builder state/build/output directories for a clean acceptance build.
This reference targets x86_64 only, enforced by `flathub.json`. ARM64 inputs were
investigated but native ARM64 execution is not verified and is not advertised.
Enable another architecture only after its own clean build/install/runtime checks.
The upstream `Validate standalone Flathub draft` workflow validates x86_64 without
publishing. A configured workflow is not a passing run.

The package initializes its own workspace and starts its loopback backend without
Tailscale. Test local file import, ZIP export and clipboard sharing with no host
Tailscale installation. Cross-device access still requires authenticated host
Tailscale, tailnet HTTPS and Tailscale Serve targeting `127.0.0.1:6001`; the app
neither installs the VPN nor detects its host daemon status. Settings can check
the saved HTTPS application's health; this verifies reachability from this
computer only. Failure leaves local functionality available. Do not expose that
unauthenticated loopback gateway publicly. This dependence for cross-device
sharing remains subject to Flathub's host-dependent application inclusion policy.

Test file/open/background portals with grant, cancellation and denial on real
GNOME/KDE sessions, plus X11/Wayland clipboard handling and backend shutdown.
Check that the installed Node executable runs, the desktop entry groups under
the application ID and the Chromium sandbox remains enabled. A real installed
x86_64 Flatpak capture is prepared upstream at `assets/airdrop-flatpak-desktop.png`.
The metadata still uses the reachable immutable v1.5.0 screenshot URL: publishing
the replacement and pinning its immutable URL requires the maintainer's approval.
No image was generated or substituted at a nonexistent URL.

The upstream technical review records a successful local x86_64 clean offline
build, repository lint, installation, backend transfers, X11 clipboard/sandbox and
headless native Wayland startup. ARM64 execution, interactive GNOME/KDE portals
and real cross-device Tailscale access remain unverified. The separate workflow
has not been executed. Local validation used native flatpak-builder 1.4.4 and the
official linter 3.0.0; the full SDK Builder run failed in this worker. These results
do not establish policy acceptance or an Electron source build.

## Remaining source-build blocker

The x86_64 Electron 44.9.3 archive is still **precompiled**. It is retained
explicitly for reproducible technical testing, not presented as source builds.
The BaseApp provides supporting libraries and Zypak; it does not provide a
source-built Electron executable. The Node SDK extension is distinct from
Electron's embedded Node runtime.

Electron's official source build uses its pinned Chromium/Node dependency graph,
gclient hooks, a Clang toolchain, GN and Ninja. An offline recipe must declare and
verify all of those inputs, including Yarn caches, tool packages, architecture
sysroots and any selected profiling data before compilation. Merely downloading
Electron's GitHub source tarball, repackaging the binary or running
electron-builder does not achieve this. No speculative source-build module has
been substituted into this manifest. Until a complete offline source build is
verified on the target, an explicit Flathub exception for the bundled Electron
binaries would be needed; no such exception has been obtained.

This remains an AI-assisted review draft. No submission approval, policy exception
or source-build compliance is implied by lint success.
