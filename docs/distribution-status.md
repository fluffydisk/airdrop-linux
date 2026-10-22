# Public distribution status — 2026-10-22

Version **1.5.0** is already publicly installable through the project's signed
APT/RPM repositories. This audit reused the immutable release; it did not replace
release assets or change signing keys or deployment protections.

| Distribution channel | Status | Public URL | Installation verified | Blocker |
|---|---|---|---|---|
| APT | VERIFIED INSTALLABLE | [Signed stable index](https://fluffydisk.github.io/airdrop-linux/apt/dists/stable/InRelease) | amd64/arm64: Debian 13, Ubuntu 24.04/26.04 | None for these targets; Mint untested |
| RPM | VERIFIED INSTALLABLE | [x86_64 metadata](https://fluffydisk.github.io/airdrop-linux/rpm/x86_64/repodata/repomd.xml), [aarch64 metadata](https://fluffydisk.github.io/airdrop-linux/rpm/aarch64/repodata/repomd.xml) | x86_64/aarch64: Fedora 43/44 and openSUSE Tumbleweed, tested separately | Per-distribution graphical desktop acceptance remains |
| AUR | BLOCKED | No public package listing | Public v1.5.0 recipe built/installed/removed on Arch x86_64; aarch64 untested | Maintainer reports account registration unavailable; deferred for this stage |
| Snap | BLOCKED | No public listing | Exact v1.5.0 strict local build/install/desktop/removal passed on amd64/arm64; no Store install | Name registration confirmed by maintainer; SNAPCRAFT_STORE_CREDENTIALS still needed; interface review pending |
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
- [Exact-release Snap validation](https://github.com/fluffydisk/airdrop-linux/actions/runs/39811197914): both amd64/arm64 artifacts built from the checksum-verified v1.5.0 payloads, installed with strict confinement, exercised through CLI, backend transfer and sandbox-enabled foreground/background desktop lifecycle tests, then removed. Tested `.snap` artifacts were retained; no store upload occurred.
- [AUR credential check](https://github.com/fluffydisk/airdrop-linux/actions/runs/39812202638) and [Snap credential check](https://github.com/fluffydisk/airdrop-linux/actions/runs/39809751892): failed explicitly at missing account bindings, before any publication. The AUR scan passed official host-fingerprint verification without a manually supplied known_hosts secret. AUR RPC returned zero matching entries; Snap's public API returned no listing for `airdrop-linux`. This does not establish that the Snap name is unreserved.

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

1. **Snap:** `airdrop-linux` is registered in the maintainer's account, with no
   first revision yet. Follow the [Arch/Omarchy one-time credential guide](snap-store-auth.md)
   using Canonical's temporary container, restricted package/channel/ACL scopes
   and a 90-day expiry. No local Ubuntu, snapd or Snapcraft installation is needed.
   Save the result as `SNAPCRAFT_STORE_CREDENTIALS` in `snap-publishing`.
2. After configuration, run `store-submissions.yml` with `snap-access` to verify
   account access. Both exact-release local Snap tests already passed. Candidate
   installation and any required browser-sandbox interface review remain gates
   before stable; the successful local tests do not replace them.
3. **AUR is deferred** because account registration is currently unavailable.
   No AUR credential action is requested at this stage. Its tested preparation is
   preserved, and none of Snap/APT/RPM depends on AUR account access.

The production `package-publishing` reviewer and deployment-branch requirements
remain in place. No new APT/RPM deployment is necessary for this audit.

## Flathub remains independent

At the start of this audit, `codex/flathub-identity-preparation` was 23 commits
ahead and one behind `main`; it was inspected without merging. Its source-build work is preserved. The
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
