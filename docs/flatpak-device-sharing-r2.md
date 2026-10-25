# Published Flatpak v1.5.0 revision r2

**Published and install-tested:** x86_64 independent GitHub distribution. This is
not a Flathub submission or a claim of completed authenticated phone acceptance.
The original r1 bundle and all 25 previously existing release assets retain their
IDs, sizes and update timestamps.

- [Download r2](https://github.com/fluffydisk/airdrop-linux/releases/download/v1.5.0/airdrop-linux-1.5.0-x86_64-reference-r2.flatpak)
- [SHA-256 file](https://github.com/fluffydisk/airdrop-linux/releases/download/v1.5.0/airdrop-linux-1.5.0-x86_64-reference-r2.flatpak.sha256)
- [Clean build, package validation and append-only publication](https://github.com/fluffydisk/airdrop-linux/actions/runs/40230279699)
- [Acceptance of anonymously downloaded bytes, including real in-sandbox Tailscale bootstrap](https://github.com/fluffydisk/airdrop-linux/actions/runs/40231788061)
- [Architecture, setup, security and reproducible commands](device-sharing.md)
- [Committed evidence and preserved failures](evidence/flatpak-r2/)

Size: **119,629,968 bytes**. SHA-256:

```text
9dcc5d18450eb1404ce1615ebf4cf55dac03eeb09958dc4c767353dfd0cfb9df
```

## What changed

r1 had a manual external-workspace address field, without onboarding, a LAN
listener or an embedded VPN node. r2 adds the first-launch connection wizard,
**Connect device**, real private userspace tsnet authentication, trusted-LAN
sharing, copyable pairing addresses and QR codes. Linux does not need a host
Tailscale installation or terminal setup. Phone/tablet Tailscale mode still
requires its Tailscale client, same-tailnet membership, ACL access, MagicDNS and
HTTPS certificate provisioning. LAN mode needs only a browser on the same
trusted network; it is unencrypted HTTP. No Funnel is enabled.

The gateway authenticates clients using a capability in the QR fragment and an
HttpOnly SameSite session cookie. It rejects unauthenticated requests and foreign
origins/hosts. Disconnect revokes links and closes connections. The original
loopback backend, file/ZIP implementation and desktop clipboard are retained;
the HTTP web interface adds manual text copy/paste when the browser clipboard
API is unavailable. No broad host filesystem, execution, TUN or D-Bus permission
was added. Network sharing remains an explicit Flatpak grant, not network
isolation; only selected sharing listeners become reachable from other devices.

## Verification matrix

| Requirement | Result | Evidence and scope |
| --- | --- | --- |
| Existing regression suite plus connection/clipboard cases | VERIFIED | Local **102/102**, zero skips; [log](evidence/flatpak-r2/unit-tests-102.log). Publication CI passed 101/102 with one pre-existing host-dufs integration skip; the installed sandbox's real dufs was tested separately. |
| Clean offline x86_64 build | VERIFIED | Publication run; `flatpak-builder --sandbox --disable-download --disable-cache --force-clean`; npm offline and Cargo locked/offline, Go uses vendored sources. |
| Independent sources and real checksums | VERIFIED | [Receipt](evidence/flatpak-r2/preparation.json); regenerated manifest/receipt exactly match publication inputs after normalizing vendor source modes to 0644. [Reproduction check](evidence/flatpak-r2/source-reproduction.txt). |
| Source-built embedded Tailscale | VERIFIED | Go 1.27.3, tsnet v1.104.2. Actual installed helper build info/hash match the independent local build: [version](evidence/flatpak-r2/published-helper-version.json), [hash](evidence/flatpak-r2/published-helper-sha256.txt). |
| Real Tailscale bootstrap inside installed Flatpak | VERIFIED | Acceptance run receives an actual provider login URL; URL deliberately redacted. No host daemon, CLI, TUN or preconfigured auth key. |
| Desktop IPC starts bundled helper and displays sign-in action | VERIFIED | Acceptance run clicks Connect Tailscale, waits for the rendered sign-in button and validates the real login origin. Sharing URL/QR stay empty before verified HTTPS. |
| Authenticated tailnet HTTPS/file transfer to phone/tablet | NOT TESTED | No authenticated account/second physical device supplied. The TLS probe and readiness gating are implemented; certificate issuance and peer routing have not been proven with a user account. |
| First-launch wizard, address copy and decoded QR | VERIFIED | Actual installed Electron UI in publication/acceptance runs and [local public-bundle acceptance](evidence/flatpak-r2/published-lan-acceptance.log). |
| Pairing URL opens actual browser UI | VERIFIED | Real Chromium window executes fragment pairing script, establishes its cookie and reaches `/ui/`; manual LAN clipboard send/load passed. No mocked transport. |
| LAN upload/download, ZIP contents and clipboard | VERIFIED | Actual published bundle; real HTTP from a second Docker network namespace, in addition to same-worker browser/API tests. This is **not two physical devices or proof of a user's Wi-Fi/firewall path**. |
| Safe fallback and unauthorized access | VERIFIED | Local service survives disconnect and connection errors; actual 401/403/421 checks and token revocation. Controlled TLS-status tests are labeled as controlled, not real tailnet transfers. |
| Manifest/repository lint, AppStream, desktop entry, icon/screenshots | VERIFIED | Publication validation matrix/artifact; independent local validation also passed. Existing upstream metadata screenshot and newly captured desktop are distinguished. |
| X11, clipboard, backend startup/shutdown | VERIFIED | Actual installed package and downloaded bundle; Chromium sandbox/context isolation remain enabled, Node integration disabled. |
| Wayland startup | VERIFIED | Native headless compositor in local validation and published-bundle acceptance; application has DISPLAY removed. |
| Physical Wayland clipboard and interactive portals | NOT TESTED | No physical input/desktop session. Real D-Bus controlled grant/denial/absence fixtures passed; they do not prove interactive consent. |
| Uninstall/reinstall and persistent private files | VERIFIED | Actual publication validation and local acceptance. No `--delete-data`; exact private file bytes preserved. |
| Permissions and production dependency inventory | VERIFIED | [Actual installed grants](evidence/flatpak-r2/permissions.txt), [package summary](evidence/flatpak-r2/package-summary.json); full ELF/licenses/npm inventory in publication artifact. Desktop production npm audit: zero reported vulnerabilities. |
| aarch64 build/runtime | NOT TESTED | Reference restricted to x86_64; no unverified architecture advertised. |
| Full Electron source build / Flathub exception | BLOCKED | Official Electron 44.9.3 binary remains. No approved exception or Flathub-ready claim; this does not block GitHub distribution. |

The packaged runtime reports Electron **44.9.3**, Chromium **152.0.7977.167** and
embedded Node **24.22.0**. SDK/runtime/BaseApp use the existing signed 26.08
infrastructure. Application sources are pinned to
`680434e8d656d7052374063e7f7e88e69d60f89a`; later commits improve acceptance tooling,
source-archive reproducibility and documentation, without replacing the r2 asset.
The v1.5.0 release tag is not moved.

## Reproduction and failures

Use [device-sharing.md](device-sharing.md) for commands; pass the application
commit above to `scripts/prepare-device-flatpak.py` to reproduce this release's
independent recipe, including `tsnet-vendor.tar.gz`. The normalized vendor archive
reproduces the exact publication SHA-256
`c302179bf3ab2fb78a33a1e9ae0bb902e7f5e61ce61b941ae79cdcf2ced03eca`.
The helper's identical hash across the two builds proves that component's
reproduction; no claim of byte-identical complete Flatpak/OSTree exports is made.

[Failure records](evidence/flatpak-r2/failures/) retain the initial umask-related
portable-update assertion, the early HTTP Host test, managed-cloud Tailscale 403,
cloud browser proxy failure and asynchronous acceptance-test wait failure.
[Notes explain the fixes and cancelled runs](evidence/flatpak-r2/failure-notes.md).
The test-only local proxy exception applies solely to the exact owned listener
in a disposable browser session; external requests retain the configured proxy.
The successful GitHub browser test needs no proxy exception. Neither TLS
verification nor Chromium/Flatpak sandboxing was disabled.

## Remaining user acceptance

1. Quit r1 fully, reinstall the new bundle using README commands, then open it.
2. Choose trusted LAN, select the actual Wi-Fi/Ethernet interface if necessary,
   scan its QR on the same network, and exchange a file/ZIP and shared text.
3. For Tailscale, sign in through the displayed browser action. Authorize the
   device and enable tailnet MagicDNS/HTTPS when prompted. Join the same tailnet
   on the phone/tablet, then verify its actual HTTPS URL and exchange files.
4. Test native Omarchy/Wayland clipboard and interactive portal behavior.

A working self-probe cannot prove another device's ACL, Wi-Fi client isolation or
firewall settings. No loopback address or unverified DNS-only HTTPS address is
advertised to another device. Tailscale errors leave local/LAN modes available.
