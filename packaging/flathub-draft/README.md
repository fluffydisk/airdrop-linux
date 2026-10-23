# Airdrop Linux: standalone technical review draft

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
flatpak run io.github.fluffydisk.airdrop-linux
```

Use fresh builder state/build/output directories for a clean acceptance build.
Repeat on native x86_64 and aarch64 machines. Source availability or an ELF header
check is not a substitute for an ARM64 build and startup test. The upstream
`Validate standalone Flathub draft` workflow uses separate native runners and
does not publish anything. It must actually finish successfully before its tests
can be cited as passed.

The package initializes its own workspace and starts its loopback backend without
Tailscale. Test local file import, ZIP export and clipboard sharing with no host
Tailscale installation. Cross-device access still requires authenticated host
Tailscale, tailnet HTTPS and Tailscale Serve targeting `127.0.0.1:6001`; the app
neither installs the VPN nor detects its host daemon status. Do not expose that
unauthenticated loopback gateway publicly. This dependence for cross-device
sharing remains subject to Flathub's host-dependent application inclusion policy.

Test file/open/background portals with grant, cancellation and denial on real
GNOME/KDE sessions, plus X11/Wayland clipboard handling and backend shutdown.
Check that the installed Node executable runs, the desktop entry groups under
the application ID and the Chromium sandbox remains enabled. Refresh the old
v1.5.0 transfer screenshot with a real current installed application capture.

## Remaining source-build blocker

The two Electron 44.7.0 archives are still **precompiled**. They are retained
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
verified on both targets, an explicit Flathub exception for the bundled Electron
binaries would be needed; no such exception has been obtained.

This remains an AI-assisted review draft. No submission approval, policy exception
or successful full build is implied by the directory layout or by lint success.
