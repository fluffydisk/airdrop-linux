# Distribution and package-manager roadmap

## What ships in a GitHub release

All assets must come from the same version tag and source commit. Keep the root and desktop versions synchronized.

| Asset | Use |
| --- | --- |
| `install-prebuilt.sh` | Stand-alone entry point: resolves one stable tag, verifies its native install bundle, then runs system setup. |
| `airdrop-bundle-linux-<arch>-<version>.tar.gz` | Installers, production server dependencies, web UI and prebuilt desktop. No Electron build or npm dependency installation on the target machine. |
| `Airdrop-<version>-x86_64.AppImage` / `Airdrop-<version>-aarch64.AppImage` | One executable file containing the desktop companion. |
| `airdrop-linux-<arch>-<version>.zip` | Complete application payload used by the installed app's updater. |
| `airdrop-update.json` | Combined architecture/version/checksum metadata for the installed updater and portable downloads. |
| `SHA256SUMS` | SHA-256 digests for the public release assets, including the install script. |

The first release is v1.4.0. The workflow builds on native x64 and arm64 runners and prepares a draft. It does not publish a stable release automatically. Publish the draft only after both architectures have completed and assets/metadata agree. Do not overwrite assets on an already-published version: create a new version instead.

### Install from a single downloaded script

After a release has been published, download `install-prebuilt.sh` from that release, then run it as your normal user:

```bash
curl -fL https://github.com/fluffydisk/airdrop-linux/releases/latest/download/install-prebuilt.sh -o install-prebuilt.sh
bash install-prebuilt.sh
# Or select an exact published stable release:
bash install-prebuilt.sh --version 1.4.0
```

No repository checkout is required. The script requires Bash, curl, tar, sha256sum and standard shell utilities. It pins the tag before fetching the checksum list and bundle, rejects unsafe archive entries, and validates bundle architecture and component versions. It reuses the existing installer for Node runtime, dufs, clipboard tools, credentials, Tailscale login/Serve and systemd setup. sudo and browser login may still be required. Server production dependencies and the Electron desktop are already built. The source-based `install.sh` and `install-desktop.sh` remain available.

Quit Airdrop before upgrading. Use the same absolute `AIRDROP_HOME` as the existing installation; the default follows XDG_DATA_HOME. Existing shared files and credentials are retained. Never run the GUI or the installer as root.

### Run the AppImage

[AppImage's official quickstart](https://docs.appimage.org/introduction/quickstart.html) describes enabling execution and launching a downloaded file:

```bash
chmod +x Airdrop-1.4.0-x86_64.AppImage
./Airdrop-1.4.0-x86_64.AppImage
```

The AppImage is the **desktop companion**, not a replacement for the local server, dufs or Tailscale setup. Set up the backend with the regular installer first. Without it, the app opens but reports unavailable services. It shares the same data/profile as a normal Airdrop installation, so run one desktop instance at a time.

Portable updates open the matching AppImage download from Settings. Quit and replace the old AppImage yourself. They do not replace the backend. The regular per-user installation still updates the complete app through the installed updater.

If FUSE mounting is unavailable, the pinned AppImage runtime supports extraction mode:

```bash
./Airdrop-1.4.0-x86_64.AppImage --appimage-extract-and-run
```

GTK/NSS and graphical-session support are still required. On Ubuntu/AppArmor systems that restrict unprivileged user namespaces, prefer the prebuilt installer: it creates the executable-specific sandbox profile at a stable installed path. Never work around this by disabling Electron's sandbox or system-wide protections.

### Build and verify

```bash
npm ci
npm ci --prefix desktop
npm run prepare-desktop
npm run package --prefix desktop
npm run release:build
npm run release:appimage
# Once artifacts from both architectures are collected in release/:
node scripts/merge-release.js
(cd release && sha256sum --check SHA256SUMS)
```

Run checksum verification from `release/` with `sha256sum --check SHA256SUMS`. AppImage tooling and its runtime are pinned by SHA-256 in `packaging/appimage-tools.json`. The upstream continuous-download URLs can change: a checksum failure must be reviewed and the lockfile updated deliberately. The build extracts appimagetool instead of requiring FUSE, and supplies the pinned type-2 runtime explicitly. It never disables Chromium's sandbox.

Local build outputs are ignored by Git. Publish the generated assets through the tag workflow; do not commit binary bundles or tool caches into the source repository.

## Package managers

Version 1.5.0 adds package-managed installation, explicit removal, native DEB/RPM
and AUR payload builds, and bundled-server Flatpak/Snap recipes. See the
[package-manager guide](package-managers.md) for build commands, installation
layout, migration, removal, signing and submission requirements.

These channels are not advertised as published until their builds, host tests,
repository deployment or store review have completed. Existing GitHub bundles
and AppImages remain supported.
