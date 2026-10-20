# Native distribution and guided connection setup

## Layout and first launch

The full `airdrop-linux` DEB owns `/opt/airdrop`, its launchers, an application icon, user-session units, and the authorized system bridge. The application code is read-only to normal users. Shared files, preferences, VAPID credentials, subscriptions, trash and backups stay under `$XDG_DATA_HOME/airdrop` (or an explicit absolute `AIRDROP_HOME`). `AIRDROP_APP_DIR` selects the immutable code directory independently.

Open **Airdrop** from the application menu, then **Connect devices**. On a new managed installation the connection page opens automatically. The wizard detects completed steps, installs Tailscale from its signed official source on supported Debian/Ubuntu/Mint systems, starts its service, opens the system browser for login, configures private HTTPS sharing and offers a QR code for the PWA. No passwords or auth keys are entered into Airdrop. Tailscale Terms of Service apply; the install button is the explicit installation action.

File management remains available during setup. Connection readiness distinguishes missing software, stopped service, account/device approval, disconnected state, unconfigured sharing, no other online device and connected peers. Peers are Tailscale network peers, not verified Airdrop recipients. Setup never enables public Funnel, resets Serve, switches accounts, changes exit nodes or advertises routes.

The bridge exposes only `Status`, `Run` and per-connection `GetJob` on `io.github.fluffydisk.Airdrop.System1`. It authorizes the sender through Polkit, allows no arbitrary command/path/URL arguments and keeps authentication links private to the exact initiating bus connection. Web API clients cannot invoke system setup. Only active desktop users may inspect connection state; configuration requires a graphical administrator authorization.

Existing Tailscale HTTPS root routes belonging to another application are kept. Resolve a route collision before retrying. The first local user to configure Airdrop sharing owns its bridge record; other users cannot silently take over that record.

## Migration, updates and removal

An existing GitHub installation requires the explicit **Move existing installation** action. Quit the older desktop first. Airdrop pauses new writes, drains existing operations, authorizes stopping only matching user-owned legacy services, backs up credentials and owned launchers, then switches the managed runtime to the existing data. Old application code is retained. Other users' services and unrelated launchers are not removed. Automatic legacy-unit migration currently recognizes the standard `~/.local/share/airdrop` layout; custom legacy system units require manual administrator migration.

The package source marker selects update behavior:

- GitHub installers: existing complete-application updater with checksum verification and rollback.
- DEB: download a matching DEB; open it with the system software installer. If APT is configured, use the OS update manager. No ZIP replacement of managed code.
- Flatpak: matching GitHub Flatpak download; install it with the software manager or Flatpak.
- Arch: AUR/package-manager update instructions.

Package hooks do not authenticate accounts, create VAPID credentials or configure private networking. Active native servers quiesce writes before package changes. Removing a package retains user data, Tailscale and its configuration. Reinstalling uses the same credentials and shared files.

The user-session service stays available after closing the desktop. It belongs to the graphical session and monitors logind so an unrelated linger setting does not keep sharing after the last graphical logout. Flatpak background activity and autostart use the Background portal; denial must fall back to foreground-only operation. Multiple local users/installations cannot share the fixed backend ports simultaneously. A managed desktop verifies its backend instance identity before reporting readiness.

## Build and validation

```sh
npm ci
npm ci --prefix desktop
node desktop/node_modules/electron/install.js
npm test
/usr/bin/python3 tests/system-core.py
dbus-run-session -- /usr/bin/python3 tests/system-bridge.py
npm run test:desktop
npm run prepare-desktop
npm run package --prefix desktop
node scripts/build-native.js .test-artifacts/native-app
AIRDROP_NATIVE_STAGE="$PWD/.test-artifacts/native-app" node scripts/build-deb.js
```

Node 24 LTS and dufs downloads are pinned per architecture in `packaging/runtime-assets.json`. The DEB contains all required application runtime binaries, dependencies and license texts; npm/build tools are not required on end-user computers. Desktop shared-library dependencies are resolved by APT, including pre/post-t64 package alternatives. The standalone `airdrop-system-bridge_<version>_all.deb` is architecture independent and reproducible; it conflicts with the full native package, which already provides it.

The native validation workflow builds on real x64/arm64 runners and tests Debian 12/13 and Ubuntu 22.04/24.04/26.04 disposable systems. `scripts/test-deb.sh` refuses to install anything unless `AIRDROP_DISPOSABLE_TEST=yes` is explicitly set. It must never be used on a user's main computer.

See [the acceptance record](distribution-validation.md). Container tests do not replace real GNOME/Cinnamon VM, Polkit, network and session-lifecycle acceptance.

## APT publication

`build-apt.js` reads verified stable release manifests and DEBs, keeps two versions, generates architecture-specific indices and signs `InRelease`/`Release.gpg`. It refuses mismatched package metadata, unsigned output, corrupt packages, incomplete architecture pairs, an existing output directory and output above the Pages budget. Staging failures cannot replace the live repository.

After native acceptance, create a dedicated signing key in an isolated owner-only keyring, keep an encrypted backup outside the repository and provision the `apt-production` GitHub environment:

- environment secret `AIRDROP_APT_PRIVATE_KEY`: dedicated signing key material; never write it to source control or logs;
- repository variable `AIRDROP_APT_SIGNING_KEY`: full public fingerprint;
- repository variable `AIRDROP_APT_ENABLED=true`: enable publication only after testing;
- Pages build source: GitHub Actions; protect the production environment with the maintainer's review rule.

The workflow collects only published stable releases with both DEB architectures. Weekly metadata refresh keeps the 30-day index validity current. Clients use the public keyring with the supplied Deb822 `Signed-By` source. Rotate the key before expiration: distribute the new public key while old metadata remains verifiable, update the protected signing secret/fingerprint, verify a test repository, then switch. Keep the old public key available throughout the transition.

No production key or Pages site has been provisioned by merely adding these scripts.

## Flatpak and AUR

The GitHub-only Flatpak packager reuses the native payload, the supported Freedesktop runtime and Electron BaseApp/Zypak. It grants network/display access and exact D-Bus destinations, with no blanket home or system-bus access. Install the Electron BaseApp build dependency, then run `build-flatpak.js` with `AIRDROP_NATIVE_STAGE` set. The packager also starts both bundled servers in an isolated network namespace and verifies the web UI and a UTF-8 upload without installing the application. Build inputs in `packaging/flatpak` are for self-distribution and must not be submitted as a Flathub manifest.

The sandbox contains its own servers and workspace. It accesses the host bridge through its narrow D-Bus interface. If no full native package provides the bridge, install the standalone connection DEB through the OS installer. On non-DEB distributions an equivalent native bridge package must exist before guided setup is supported.

**Import existing files and settings** uses a user-selected folder through the file chooser. It refuses active other backends, nonempty destinations, links and special files, stages before replacing anything, retains a backup and keeps source data untouched. Native and sandbox profiles are never silently shared.

After both native architecture manifests exist, `node scripts/generate-aur.js release OUTPUT` creates a pinned PKGBUILD, `.SRCINFO` and package lifecycle hooks. Validate it with `makepkg` on clean Arch, compare generated `.SRCINFO`, then submit through the maintainer's AUR account. The generator does not submit or create accounts.

Flathub is a separate future human-led process: current rules restrict host-dependent apps and AI-assisted manifests/submission interactions. This repository's generated self-distribution packaging is not a Flathub submission.
