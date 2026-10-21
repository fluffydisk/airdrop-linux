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
| ARM64 | Electron, native DEB and payload archives built; local execution on ARM64 not tested |
| Snap build | Real amd64 `.snap` produced with Snapcraft 8.11.1/core24; native runtime libraries staged; GNOME content-library and NSS dynamic-loading warnings remain |
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

The Snap archive has been built but has not been exercised in its runtime sandbox.
Flatpak SDK, runtime and Electron BaseApp 25.08 were downloaded and sources were
validated. The build reached the module command, where bubblewrap failed because
the managed container cannot create the required user namespace. Using the
supported copy-based cache mode avoided the separate missing-FUSE issue; sandbox
namespace checks were kept enabled.
After the environment network draft was saved, follow-up requests to Flathub and
AUR returned HTTP 200 and the Snap API returned HTTP 404 for `airdrop-linux`.
GitHub repository metadata is now accessible and reports push/admin access.
AUR returned zero matching entries and the Flathub application repository returned
404; these observations do not establish reservation rights or store acceptance.
GitHub secret/variable and Actions-permission metadata requests still return
“Resource not accessible by integration” (HTTP 403). Signing/store configuration
therefore remains unverified, rather than proven absent. Creating the GitHub
Pages site through the API was also rejected with HTTP 403. The repository
currently reports Pages disabled and no configured deployment environments.

A draft implementation PR was opened at
https://github.com/fluffydisk/airdrop-linux/pull/2. Its first native validation run
found Ubuntu ARM64 lintian classifying the upstream musl dufs binary as static;
the package now documents this deliberate upstream-runtime choice with a narrow
path-specific override. Follow-up checks also added the explicit Node libatomic
runtime dependency and Snap runtime search paths. Native checks are being rerun
for these corrections; consult the PR checks for the current remote outcome.

Flathub's prebuilt-payload policy review, Snap strict-confinement/portal and user
service checks, actual background permission behavior, physical devices and
Tailscale HTTPS still require validation. A unit test covers matching background
portal responses, denial and absence, but does not replace a real portal test.

Production repository signing requires maintainer-owned signing keys; test keys
are not production keys. Protected GitHub environment credentials and channel
ownership/reviewer approval are required as documented in
[the package-manager guide](package-managers.md). No channel is marked as
submitted or live solely because its recipe was generated.
