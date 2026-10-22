# Public distribution status — 2026-10-22

Version **1.5.0** is already publicly installable through the project's signed
APT/RPM repositories. This audit reused the immutable release; it did not replace
release assets or change signing keys or deployment protections.

| Distribution channel | Status | Public URL | Installation verified | Blocker |
|---|---|---|---|---|
| APT | VERIFIED INSTALLABLE | [Signed stable index](https://fluffydisk.github.io/airdrop-linux/apt/dists/stable/InRelease) | amd64/arm64: Debian 13, Ubuntu 24.04/26.04 | None for these targets; Mint untested |
| RPM | VERIFIED INSTALLABLE | [x86_64 metadata](https://fluffydisk.github.io/airdrop-linux/rpm/x86_64/repodata/repomd.xml), [aarch64 metadata](https://fluffydisk.github.io/airdrop-linux/rpm/aarch64/repodata/repomd.xml) | x86_64/aarch64: Fedora 43/44 and openSUSE Tumbleweed, tested separately | Per-distribution graphical desktop acceptance remains |
| AUR | BLOCKED | No public package listing | Public v1.5.0 recipe built/installed/removed on Arch x86_64; aarch64 untested | AUR_SSH_KEY and AUR_KNOWN_HOSTS unavailable |
| Snap | BLOCKED | No public listing | No installation from Snap Store; earlier strict local builds are not store verification | SNAPCRAFT_STORE_CREDENTIALS unavailable; name ownership/interface review unverified |
| Flathub | BLOCKED | No public listing | No installation from Flathub | Electron source build incomplete; independent human manifest and submission required |

## Install the published native packages

Use the exact fingerprint-checked [APT and RPM setup commands](package-managers.md#native-packages-apt-aur-dnf-and-zypper), then:

```sh
sudo apt install airdrop-linux       # Debian / Ubuntu
sudo dnf install airdrop-linux       # Fedora
sudo zypper install airdrop-linux    # openSUSE
```

Launch **Airdrop Linux** from the application menu, or run `airdrop setup` as the
normal user for per-user initialization. Host Tailscale login and HTTPS Serve
configuration remain separate. Never run the desktop as root.

Both native package formats are version `1.5.0-1`, with glibc **2.39+** required.
The signing fingerprint is `6513D70958397F60D3787A0CB93F4FC1E97CF3AE`.
Use APT `signed-by` and retain RPM `gpgcheck=1` and `repo_gpgcheck=1`.

## Evidence

- [Production signing and Pages deployment](https://github.com/fluffydisk/airdrop-linux/actions/runs/39687476202): existing production publication, completed 2026-10-21.
- [Desktop/public-install audit](https://github.com/fluffydisk/airdrop-linux/actions/runs/39809722343): public key fingerprint, APT InRelease/Release signatures, RPM metadata and package signatures, both DEB hashes and signed RPM payload correspondence with original release assets. All 12 distribution/architecture installs passed with UI HTTP endpoint, upload/download, ZIP, backend restart, per-user identity preservation, same-version reinstall/update and data-preserving removal.
- The latter audit also installed the **public DEB** on Ubuntu 24.04 amd64/ARM64 and tested the installed Electron binary with Chromium sandboxing enabled. File chooser/drop, folders, ZIP, native text/image clipboard, downloads, health reporting and desktop restart passed. Installed desktop entries and AppStream metadata validated. The tray test skipped because no StatusNotifier host was present.
- [Public-source AUR preparation and installation](https://github.com/fluffydisk/airdrop-linux/actions/runs/39810000020): real v1.5.0 HTTPS release sources, checksum verification, non-root `makepkg`, canonical `.SRCINFO`, dependency installation, backend/file/ZIP checks and removal passed on Arch x86_64. Download the `store-submissions` artifact for the concrete `aur/PKGBUILD` and `aur/.SRCINFO`.
- [AUR credential check](https://github.com/fluffydisk/airdrop-linux/actions/runs/39809746765) and [Snap credential check](https://github.com/fluffydisk/airdrop-linux/actions/runs/39809751892): failed explicitly at missing bindings, before any publication. AUR RPC returned zero matching entries; Snap's public API returned no listing for `airdrop-linux`. This does not establish that the Snap name is unreserved.

Containers do not exercise a full desktop login/systemd session. RPM GUI launch
on Fedora/openSUSE, interactive portals, physical-device Tailscale access and
tray integration remain separate acceptance checks. There is no older published
native package version for a real version-to-version upgrade test. Mint and
older glibc distributions are not certified by Ubuntu tests.

## Account actions that cannot be performed by this integration

The [GitHub environment settings](https://github.com/fluffydisk/airdrop-linux/settings/environments)
are the secure place to configure these bindings; do not paste credentials in
chat. Secret administration returns HTTP 403 for this integration. Runtime checks
confirmed absence rather than inferring it from that API failure.

1. **AUR:** authenticate an [AUR account](https://aur.archlinux.org/), register the
   public half of its authorized SSH key, and set `AUR_SSH_KEY` and
   `AUR_KNOWN_HOSTS` in `aur-publishing`. Verify server host keys against the
   fingerprints published by Arch; see [AUR submission guidance](https://wiki.archlinux.org/title/AUR_submission_guidelines#Authentication).
2. **Snap:** verify/reserve `airdrop-linux` in the [publisher dashboard](https://dashboard.snapcraft.io/).
   Export a Snapcraft login restricted to this snap and candidate/stable upload
   and release permissions, and set `SNAPCRAFT_STORE_CREDENTIALS` in
   `snap-publishing`. [Snapcraft authentication guidance](https://documentation.ubuntu.com/snapcraft/stable/how-to/publishing/authenticate/).
3. After configuration, run `store-submissions.yml` with `aur-access` and
   `snap-access` to verify account access. AUR publication must follow its recipe
   build check. Snap needs testing of the exact built artifact, candidate-channel
   installation and any required browser-sandbox interface review before stable.
   Current local build tests do not authorize skipping these gates.

The production `package-publishing` reviewer and deployment-branch requirements
remain in place. No new APT/RPM deployment is necessary for this audit.

## Flathub remains independent

`codex/flathub-identity-preparation` is 23 commits ahead and one behind `main`;
it was inspected without merging. Its source-build work is preserved. The
[SDK Node/dufs run](https://github.com/fluffydisk/airdrop-linux/actions/runs/39788494373)
passed. The [Electron x64 run](https://github.com/fluffydisk/airdrop-linux/actions/runs/39794823592)
failed during compilation with a missing/unverified
`debian_bullseye_amd64-sysroot`; a complete pair of verified Electron outputs is
not available. No additional Electron/Chromium compilation was started for this audit.

The [current Flathub requirements](https://docs.flathub.org/docs/for-app-authors/requirements/#generative-ai-policy)
(revision `b1f0539de6aed7aa26e097ede5de936510ab1df0`, checked 2026-10-22)
prohibit AI-assisted manifests and agent-created submission/review material.
A human must independently author the source-build manifest and handle submission
and review, disclosing applicable generated material. Existing local test fixtures
must not be submitted. See [technical readiness](flathub-readiness.md) for the
offline-source and desktop acceptance requirements.
