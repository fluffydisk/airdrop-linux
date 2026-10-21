# Package-manager distributions

The 1.5.0 work adds native packaging and sandbox recipes. **No APT/RPM repository,
AUR entry, Flathub app or Snap Store listing is claimed to be live.** Only use the
commands below after the corresponding channel has passed validation and been
published. Flathub/Snap acceptance and name availability are external requirements.

## Native packages: APT, AUR, DNF and Zypper

Packages install immutable code and bundled, checksum-pinned Node/dufs under
`/usr/lib/airdrop-linux`. Personal files, identity, state and preferences remain
under `${XDG_DATA_HOME:-$HOME/.local/share}/airdrop`. Never launch the desktop as
root. Packages do not authenticate Tailscale or change Serve settings.

After installing, launch **Airdrop Linux**, or run `airdrop setup` as the normal
user. This generates a private per-user VAPID identity and enables
`airdrop-linux.target` and its backend service in the user's systemd manager.
Closing the native desktop leaves these services running. Manage them with:

```sh
systemctl --user status airdrop-linux.target airdrop-linux-backend.service
systemctl --user stop airdrop-linux.target
systemctl --user start airdrop-linux.target
```

User services start with the user's login. Continuous sharing after logout requires
an administrator to opt into systemd lingering; installation never enables this.
An existing script installation is not silently replaced. Quit its desktop and use
`airdrop setup --migrate` with the package-installed command (usually
`/usr/bin/airdrop`) to explicitly preserve data and archive old code/launchers.
Older installations without ownership records must first rerun the updated script
installer. Review custom manually managed services separately.

### APT (Debian 13, Ubuntu 24.04 and 26.04)

Once the signed GitHub Pages repository has been published:

```sh
curl -fsSL https://fluffydisk.github.io/airdrop-linux/airdrop-linux.gpg -o /tmp/airdrop-linux.gpg
# Compare the key fingerprint with the maintainer's independently published fingerprint.
gpg --show-keys --with-fingerprint /tmp/airdrop-linux.gpg
sudo install -Dm644 /tmp/airdrop-linux.gpg /etc/apt/keyrings/airdrop-linux.gpg
printf '%s\n' 'deb [signed-by=/etc/apt/keyrings/airdrop-linux.gpg] https://fluffydisk.github.io/airdrop-linux/apt stable main' | sudo tee /etc/apt/sources.list.d/airdrop-linux.list
sudo apt update
sudo apt install airdrop-linux
```

This is the project's repository; it is not admission into the official Debian or
Ubuntu repositories. Never use `trusted=yes` or disable signature checks.

### AUR

Build `airdrop-linux-bin` with a normal AUR helper after the entry is published,
or review its PKGBUILD and use `makepkg --syncdeps --install`. It pins native x86_64
and aarch64 release tarballs by SHA-256. AUR is community packaging, not an official
Arch repository. Never run makepkg as root.

### RPM / DNF / Zypper

After repository publication, import the public key, independently check its
fingerprint, and enable both package and metadata signature verification:

```ini
# /etc/yum.repos.d/airdrop-linux.repo (or /etc/zypp/repos.d/airdrop-linux.repo)
[airdrop-linux]
name=Airdrop Linux
baseurl=https://fluffydisk.github.io/airdrop-linux/rpm/$basearch
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=https://fluffydisk.github.io/airdrop-linux/airdrop-linux.asc
```

Install using `sudo dnf install airdrop-linux` or `sudo zypper install airdrop-linux`.
Native RPM targets require glibc 2.39 or later; Fedora and openSUSE installation
checks must pass before documenting a distribution as supported.

## Flatpak and Snap

Both sandbox distributions contain the desktop, gateway and dufs. They do not
install a VPN. Flatpak data lives in its application-specific XDG data directory;
Snap uses `$SNAP_USER_COMMON/airdrop`. They never automatically import native
installation data. Export files from the existing installation and import them
through the file chooser. The chooser/open/save portals grant access to selected
files instead of the whole home directory.

After acceptance and stable publication:

```sh
flatpak install flathub io.github.fluffydisk.Airdrop
# Or:
# snapd currently requires this host opt-in for user-scoped services.
sudo snap set system experimental.user-daemons=true
sudo snap install airdrop-linux
```

The Flatpak desktop requests background permission. If declined or unavailable,
closing the window stops sharing. If granted, closing hides the window and sharing
continues; reopening the app shows it again. **Stop sharing and quit** stops its
bundled processes. Flatpak does not request automatic login startup.

Snap connects to its own running user service through a private socket. If no
service is enabled, it starts foreground sharing and tells the user that closing
the window stops sharing. **Stop sharing and quit** stops either backend through
that socket. It never elevates the desktop to control services. To opt into
background sharing, enable the user service from the host terminal:
`snap start --user --enable airdrop-linux.backend`. The host snapd API can require
administrative authorization; without it, foreground sharing remains available.
Unprivileged `snapctl start/stop` is unsupported by current snapd. Host service
maintenance can use `snap stop --user airdrop-linux.backend`; the in-app quit
operation uses its private socket instead.
No user data is exposed through a blanket home plug.

All backends use loopback ports 5000 and 6001. Running another installation on those
ports is an error, not permission to reuse or terminate it. Stop the other instance
before switching formats. Configure host Tailscale explicitly if remote devices
need access:

```sh
sudo tailscale serve --bg --set-path / http://127.0.0.1:6001
sudo tailscale serve --bg --set-path /push http://127.0.0.1:6001/push
```

Updates use the installation's package manager. A managed app never installs a
GitHub update over managed files. Existing script/AppImage workflows remain available.

## Uninstall

For native/script installations, run as the installing user:

```sh
airdrop uninstall                # asks whether to remove user data (default: retain)
airdrop uninstall --yes          # noninteractive; keep user data
airdrop uninstall --yes --delete-data  # explicitly delete files, trash, keys, settings and backups
```

Quit the desktop first. Cancellation or a package-manager authorization failure
preserves data. Script cleanup requires its ownership record, checks hashes, and
refuses to delete changed/unrecognized launchers or units. Shared Node, dufs and
Tailscale installations are retained. Custom `AIRDROP_HOME` values must match the
original installation. Tailscale Serve configuration is preserved for manual review.

Direct `apt remove`, `apt purge`, `pacman -R` and `dnf remove` never prompt for or
remove personal data. Sandboxes cannot run a host package manager: uninstall them
from the host with `flatpak uninstall io.github.fluffydisk.Airdrop` or
`sudo snap remove airdrop-linux`. Flatpak retains application data unless the user
explicitly passes `--delete-data`. Snap normally retains an automatic removal
snapshot; explicit `airdrop uninstall --delete-data` directs the host to use
`snap remove --purge`. Earlier saved snapshots remain separate: inspect `snap saved`
and use `sudo snap forget <set-id> airdrop-linux` for each matching set, preserving
other applications in the set. Do not delete native data
when removing a sandbox installation.

## Maintainer build and publication

Build on native Linux x64/ARM64 with Node 26 and the locked npm dependencies:

```sh
npm ci
npm ci --prefix desktop
npm run prepare-desktop
npm run package --prefix desktop
# dpkg-deb and rpmbuild must be installed for their respective targets.
for channel in apt rpm aur flatpak snap; do node scripts/build-packages.js "$channel"; done
# Collect the payloads from BOTH architectures in release/, then:
node scripts/prepare-channels.js
```

The channel generator writes real, fixed-version checksums, PKGBUILD/.SRCINFO,
a Flatpak manifest and one Snapcraft recipe per architecture under ignored
`release/submissions/`. Node/dufs runtime sources and checksums are pinned in
`packaging/runtime-sources.json`; update them deliberately. Rebuild only from a
stable version tag whose root and desktop versions match. Do not replace already
published release assets. The release workflow creates a draft with checksums;
publishing it triggers repository signing/deployment.

Configure GitHub Pages to use GitHub Actions and the protected environment
`package-publishing`. Set `SIGNING_KEY_FINGERPRINT` (full fingerprint), secret
`REPOSITORY_SIGNING_KEY` (ASCII-armored private signing key) and
`REPOSITORY_SIGNING_PASSPHRASE`. Keep an offline key backup; publish the fingerprint
independently. The workflow verifies release SHA-256 values, signs RPMs and both
repository indexes, verifies metadata signatures, and deploys Pages. It includes
up to the latest 100 stable release versions, preserving versioned artifacts.
It never signs or publishes from a pull-request workflow.

`store-submissions.yml` defaults to preparation only. To submit after validation:

* AUR: reserve/own `airdrop-linux-bin`; environment `aur-publishing` needs
  `AUR_SSH_KEY` and `AUR_KNOWN_HOSTS` verified against Arch's trusted documentation.
  Validate generated `.SRCINFO` with `makepkg --printsrcinfo`, clean installation,
  upgrades and removal before pushing.
* Flathub: environment `flathub-publishing` needs `FLATHUB_TOKEN` and variable
  `FLATHUB_FORK` (`owner/flathub`, fork of `flathub/flathub`). Choose
  `flathub-check` to verify environment bindings and actual fork write access
  without submitting anything. A fork-only fine-grained PAT cannot open upstream
  PRs. Automatic Flathub PR creation is disabled. A human-authored source-build
  manifest, ID review and manual submission are required under current Flathub
  rules; see [the readiness report](flathub-readiness.md). Runtime sandbox tests
  alone do not establish eligibility for Flathub.
* Snap: reserve `airdrop-linux`; environment `snap-publishing` needs scoped
  `SNAPCRAFT_STORE_CREDENTIALS`. Uploads go to **candidate**, not stable. Review
  strict confinement, portal interaction, user-service control and architectures
  on actual hosts before promoting the revisions to stable.

Never put signing keys or store credentials in source, command arguments or logs.
Missing credentials, unavailable store names and reviewer approval remain external
publication prerequisites, not successful publication.

### Validation boundaries

The Debian lint configuration documents narrow exceptions for libraries embedded
in upstream Electron, Node and dufs binaries. Foreign-architecture npm prebuilds,
development lint configuration and unused CLI links are removed from generated
payloads; ELF files are stripped. These exceptions do not make the package eligible
for Debian's official archive. Native builds require `strip`/binutils.

Cloud onboarding environments may restrict store destinations. The additional
HTTP destinations checked for this work are `api.github.com`, `dl.flathub.org`,
`api.snapcraft.io` and `aur.archlinux.org`. Saving an allowlist draft does not grant
live access: review/save the environment settings and publish the environment.
AUR publication also requires an SSH route to aur.archlinux.org:22 when publishing
from the cloud task; the provided GitHub-hosted publishing workflow uses its own
network access. Store credentials and signing material belong in the protected
GitHub environments described above, not in chat.

For local sandbox build checks before publishing a version tag, use
`node scripts/prepare-channels.js --local`. This writes a separate
`release/local-submissions/` tree using local, checksum-pinned payload archives and
the local icon. It never replaces the production submission manifests or removes
checksum verification. Do not submit these local-path recipes to a store.

The current GitHub integration can push code and open PRs. Pages now uses the
GitHub Actions source, but Secrets/Variables administration returned HTTP 403.
Verify the existing credential names directly in GitHub; the integration cannot
read their configuration through the administration API. The latest environment
metadata shows no protection rules or branch restrictions; configure these before
production publication. Existing keys can be reused under the documented names;
do not paste private keys or store
credentials into chat.

The Snap declares `browser-support` with `allow-sandbox: true` to retain Electron's
own sandbox. Store auto-connection requires review; for a locally built test snap,
connect `airdrop-linux:browser-sandbox` explicitly. The hosted sandbox checks
exercise the real backend and desktop startup/update/quit behavior. Neither the
Snap nor the Flatpak launcher passes `--no-sandbox`.
