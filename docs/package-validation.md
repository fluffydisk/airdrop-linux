# Package distribution validation — 1.5.0

APT and RPM production repositories are public. Their signed installation paths
were rechecked on 2026-10-22, including the published DEB desktop on both
architectures. See [distribution status and current evidence](distribution-status.md).
The historical build checks below are distinct from store publication.

| Channel | Preparation status | Publication status |
| --- | --- | --- |
| APT | x86_64/ARM64 signed public repository installation verified | Published v1.5.0; Debian 13 and Ubuntu 24.04/26.04 |
| AUR | Hazır for x86_64: checksum-pinned PKGBUILD/.SRCINFO, dependency installation and runtime checks; aarch64 recipe awaits an Arch Linux ARM host | Not submitted |
| RPM | x86_64/ARM64 signed public repository installation verified | Published v1.5.0; Fedora 43/44 and openSUSE Tumbleweed |
| Flathub | Local sandbox builds/lifecycle checks passed; source build incomplete | Not submitted; source-build and independent human-authorship requirements remain |
| Snap | Hazır for review: x86_64/ARM64 strict build/install, CLI, transfer and desktop lifecycle checks passed | Not submitted; name/credential/confinement review remains |

| Check | Observed result |
| --- | --- |
| Current local Node suite | 64 passed, no failures or skips, including real dufs, private backend socket ownership/isolation, managed CLI forwarding, immutable payload permissions and dependency hardlink storage |
| Chromium integration | Passed on x64 and ARM64: upload, ZIP, Android staging, folders, trash and clipboard |
| Packaged Electron | Native functional checks passed on both architectures with Chromium sandboxing explicitly enabled and no `--no-sandbox` argument; tray checks skip without a StatusNotifier host |
| Native metadata and signatures | Debian lint, desktop entry/AppStream and disposable-key APT/RPM signing/verification passed on both native runners; narrow upstream-binary lint exceptions are documented |
| RPM lint | Current x64 package rebuilt and signed with a disposable key: rpmlint 2.7 passed with 0 errors, 4478 retained vendor/hardlink warnings and 3 narrow filters. CI also checks the signed packages on both architectures; missing/invalid signatures remain errors |
| Signed APT installation | Installed from a local signed repository using a disposable test key; no production key used |
| Distribution installation/removal | All 12 combinations passed: x64/ARM64 × Debian 13, Ubuntu 24.04/26.04, Fedora 43/44, openSUSE Tumbleweed; real file/ZIP transfer and data-preserving removal |
| AUR x86_64 | Official Arch base-devel container: dependencies installed, checksums verified, package built/installed, backend transfer and removal passed; generated SRCINFO fields matched makepkg |
| Flatpak x64/ARM64 | Build/install, real backend file/ZIP transfer, Electron launch with Chromium sandboxing explicitly enabled and no `--no-sandbox`, managed update guard and quit stopping the backend passed |
| Background portal | Persistent GIO helper compiled and exercised against a real session bus: directed grant, denial, returned request path, unrelated signal and absent portal; also passed native CI on both architectures |
| Snap x64/ARM64 | Strict build/install, installed-user executable access, CLI help, backend upload/download and ZIP, Chromium sandbox, managed updates, background attachment/window hiding, explicit quit stopping the user service and foreground window-close shutdown passed |
| Snap layout without confinement | Actual Node/dufs UI, upload/download, ZIP, private socket status/stop and clean process exit passed in isolated temporary data; this does not replace strict-confinement CI |
| Cloud development startup | Health, UI, upload and download passed; tested install_script and start_skill saved; new-task snapshot restoration not tested |

All 19 matrix jobs passed for `db10d39` in
[run 39641686307](https://github.com/fluffydisk/airdrop-linux/actions/runs/39641686307),
including both strict Snap desktop checks and installed-user permission checks.
The subsequent RPM metadata/hardlink changes have the local lint and 64-test
evidence above. Consult the current [PR checks](https://github.com/fluffydisk/airdrop-linux/pull/2/checks)
for validation of the final source revision.

Immutable payload normalization sets directories to `0755` and files to
`0644`/`0755`, preserving executable status. This prevents Electron packager's
private `0700` directories from becoming inaccessible after root-owned Snap
installation. Byte-identical files with the same permissions share storage
through hardlinks while retaining their original module paths. This applies
only to package code, never user data. RPM lint filters are limited to the
checksum-pinned static dufs binary, Electron's non-setuid sandbox helper and
the product name Tailscale. Vendor and hardlink warnings remain visible.

Local regression tests verify CLI help/exit status, real file and ZIP forwarding,
private payload permissions and rejection of control commands sent through another
data root's hard-linked socket. Launcher checks also execute all three wrappers
from an unrelated working directory and verify argument forwarding.

Snapd currently requires `experimental.user-daemons=true` and rejects ordinary
users' snapctl start/stop commands. Airdrop now attaches to its own running user
service through a private, ownership-checked Unix socket. Otherwise it starts a
foreground backend and explains that closing the window stops sharing. Explicit
quit requests stop only that data root's backend. CI passed both service
attachment/window hiding and foreground/window-close behavior on x64 and ARM64.

Desktop automation previously used Playwright's default Chromium `--no-sandbox`
argument while asserting the renderer sandbox preference. The updated native and
sandbox desktop checks explicitly enable Chromium sandboxing and reject that
argument. Native, Flatpak and Snap passed the stronger checks on both architectures.

The cloud Docker kernel cannot create Flatpak's required user namespaces. That
restriction was preserved; GitHub-hosted sandbox checks supplied the runtime
validation. TLS, artifact checksums and package/repository signatures were kept
enabled. The UTF-8 locale used for Electron filename tests
is required; ASCII locales reproduce an existing Unicode file-input failure.

After saving the network draft, GitHub, Flathub, AUR and Snap API requests worked.
AUR returned zero matching entries; Snap/Flathub returned no existing app listing.
These observations do not establish reservation rights or platform acceptance.
GitHub Pages uses the GitHub Actions source. The current `package-publishing`
environment requires reviewer approval and a deployment branch policy;
`github-pages` also has a branch policy. Preserve these protections.
Secret/variable administration returns HTTP 403. Read-only runtime checks now
confirm missing AUR/Snap bindings; production signing was already verified by
the published repository signatures. Configure missing store credentials securely
in GitHub; see the linked status report.

Remaining acceptance work includes interactive file portals and background
permission prompts, clipboard on physical sandbox desktops, real login/session
lifecycle, physical devices/Tailscale HTTPS, AUR on aarch64, review of retained
RPM vendor/hardlink warnings and per-distribution graphical RPM launch.
Published-repository installation and production signature verification passed.
Flathub requires a compliant source-build manifest independently authored by a
human; the AI-assisted prebuilt fixture cannot be submitted. Snap requires name ownership,
store credentials and confinement/interface review. See
[the package manager guide](package-managers.md) for those external prerequisites.
