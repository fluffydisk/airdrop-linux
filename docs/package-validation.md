# Package distribution validation — 1.5.0 preparation

No store submission or public repository deployment has been completed.

| Check | Observed result |
| --- | --- |
| Node test suite | 58 passed, no failures or skips |
| Chromium integration | 1 passed: uploads, ZIPs, Android staging, folders, trash, clipboard |
| Packaged Linux x64 Electron on Xvfb | Functional test passed; tray test skipped because no StatusNotifier host is present |
| DEB on Debian 13 | Built, installed, exercised UI/API/dufs and ZIP transfer; removal retained user files |
| Signed APT repository | Temporary test key used; InRelease verified, APT installed from the local signed repository |
| Debian lint | No errors, with documented narrow embedded-library overrides; warnings remain |
| AppStream and desktop entry | Validation passed (AppStream has one pedantic suggestion) |
| RPM | x64 package built; package signature and repodata signatures verified with a temporary test key |
| AUR | Generated .SRCINFO matches makepkg; x64 package built with checksum verification and --nodeps |
| ARM64 | Electron and native/Flatpak/Snap payload archives built; execution on ARM64 not tested here |
| Workflow and Snap recipe syntax | YAML parsed; shell and JavaScript syntax checks passed |

The Electron test container requires a UTF-8 locale (`LANG=C.UTF-8`,
`LC_ALL=C.UTF-8`) for the Unicode filename test. An ASCII locale reproduces the
same file-input failure in the unmodified desktop implementation. Tests were not
weakened to bypass this failure. Electron's sandbox remains enabled.

The AUR build above verifies packaging and checksums, not runtime dependency
resolution or a complete Arch installation. ARM64 native DEB/RPM execution,
Ubuntu/Fedora/openSUSE clean-install checks and real user-systemd lifecycle checks
remain for their corresponding CI/host environments. CI jobs for these native
distribution checks have been added; their remote results are not available here.

Flathub and Snap bundles have not been built or exercised in their actual
sandboxes here. Store endpoints (`dl.flathub.org`, `api.snapcraft.io`,
`aur.archlinux.org`) and GitHub API requests returned HTTP 403 through the managed
network. The checked endpoints were added to the environment's editable allowlist
draft; saving that draft does not update current networking or publish anything.

Flathub's prebuilt-payload policy review, Snap strict-confinement/portal and user
service checks, actual background permission behavior, physical devices and
Tailscale HTTPS still require validation. A unit test covers matching background
portal responses, denial and absence, but does not replace a real portal test.

Production repository signing requires maintainer-owned signing keys; test keys
are not production keys. Protected GitHub environment credentials and channel
ownership/reviewer approval are required as documented in
[the package-manager guide](package-managers.md). No channel is marked as
submitted or live solely because its recipe was generated.
