# Package distribution validation — 1.5.0 preparation

No store submission or public package repository deployment has been completed.
“Hazır” below refers to the prepared artifacts and recorded automated checks;
production signing, channel ownership, platform acceptance and the remaining
manual acceptance tests are separate publication gates.

| Channel | Preparation status | Publication status |
| --- | --- | --- |
| APT | Hazır: x86_64/ARM64 DEBs and signed repository tooling | Not published; production signing/protection verification remains |
| AUR | Hazır for x86_64: checksum-pinned PKGBUILD/.SRCINFO, dependency installation and runtime checks; aarch64 recipe awaits an Arch Linux ARM host | Not submitted |
| RPM | Hazır: x86_64/ARM64 RPMs and signed repository tooling | Not published; production signing/protection verification remains |
| Flathub | Hazır for review: both architecture sandbox builds and lifecycle checks passed | Not submitted; prebuilt-payload policy acceptance remains |
| Snap | Not ready: private service-control adaptation passed local tests; updated sandbox checks are queued | Not submitted; name/credential/confinement review remains |

| Check | Observed result |
| --- | --- |
| Current local Node suite | 61 passed, no failures or skips, including real dufs and private backend socket ownership/isolation |
| Chromium integration | Passed on x64 and ARM64: upload, ZIP, Android staging, folders, trash and clipboard |
| Packaged Electron | Native functional checks passed on both architectures; tray checks skip without a StatusNotifier host |
| Native metadata and signatures | Debian lint, desktop entry/AppStream and disposable-key APT/RPM signing/verification passed on both native runners; narrow upstream-binary lint exceptions are documented |
| Signed APT installation | Installed from a local signed repository using a disposable test key; no production key used |
| Distribution installation/removal | All 12 combinations passed: x64/ARM64 × Debian 13, Ubuntu 24.04/26.04, Fedora 43/44, openSUSE Tumbleweed; real file/ZIP transfer and data-preserving removal |
| AUR x86_64 | Official Arch base-devel container: dependencies installed, checksums verified, package built/installed, backend transfer and removal passed; generated SRCINFO fields matched makepkg |
| Flatpak x64/ARM64 | Build/install, real backend file/ZIP transfer, sandboxed Electron launch, managed update guard and quit stopping the backend passed |
| Background portal | Persistent GIO helper compiled and exercised against a real session bus: directed grant, denial, returned request path, unrelated signal and absent portal; also passed native CI on both architectures |
| Snap | Strict archives build and install with snapd user-daemons enabled. Previous runtime checks identified unsupported unprivileged service commands; replacement private socket control and foreground fallback pass local tests, with sandbox verification pending |
| Cloud development startup | Health, UI, upload and download passed; tested install_script and start_skill saved; new-task snapshot restoration not tested |

The completed distribution/AUR/Flatpak evidence is recorded in
[run 39613777548](https://github.com/fluffydisk/airdrop-linux/actions/runs/39613777548)
for commit `ac0e0bc`. That run failed its Snap checks; it is not an overall green
run. The service-control replacement is in commit `e988101`, whose
[validation run](https://github.com/fluffydisk/airdrop-linux/actions/runs/39616453904)
is currently queued. Local tests use the replacement code, including rejection
of control commands sent through another data root's hard-linked socket.

Snapd currently requires `experimental.user-daemons=true` and rejects ordinary
users' snapctl start/stop commands. Airdrop now attaches to its own running user
service through a private, ownership-checked Unix socket. Otherwise it starts a
foreground backend and explains that closing the window stops sharing. Explicit
quit requests stop only that data root's backend. The updated CI exercises both
service attachment/window hiding and foreground/window-close behavior; those
results must pass before marking Snap ready.

The cloud Docker kernel cannot create Flatpak's required user namespaces. That
restriction was preserved; GitHub-hosted sandbox checks supplied the runtime
validation. Electron sandboxing, TLS, artifact checksums and package/repository
signatures were kept enabled. The UTF-8 locale used for Electron filename tests
is required; ASCII locales reproduce an existing Unicode file-input failure.

After saving the network draft, GitHub, Flathub, AUR and Snap API requests worked.
AUR returned zero matching entries; Snap/Flathub returned no existing app listing.
These observations do not establish reservation rights or platform acceptance.
GitHub Pages now uses the GitHub Actions source and package-publishing exists,
but its latest observed configuration has no protection rules or branch policy.
Secret/variable administration still returns HTTP 403, so existing signing/store
credentials remain unverified, rather than proven absent. Configure environment
protection and verify the existing secret/variable names securely in GitHub.

Remaining acceptance work includes interactive file portals and background
permission prompts, real login/session lifecycle, physical devices/Tailscale
HTTPS, AUR on aarch64, RPM lint review, published-repository installation and
production signature verification. Flathub must review the prebuilt payload
approach and may require source-based packaging. Snap requires name ownership,
store credentials and confinement/interface review. See
[the package manager guide](package-managers.md) for those external prerequisites.
