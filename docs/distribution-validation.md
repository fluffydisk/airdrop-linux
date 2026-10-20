# Distribution acceptance record — 1.5.0

This file records evidence, not an assertion that every supported desktop has been tested. Do not publish a stable 1.5.0 or enable the production APT repository until the pending acceptance checks below have passed.

| Check | Evidence / status |
| --- | --- |
| Shared operation and regression tests | Local Node suite, including managed paths, import, migration and signed APT staging |
| Bridge operations | Python tests: OS mapping, signed source key checks, connection JSON and route conflicts |
| Bridge authorization | Isolated real D-Bus with a fake Polkit authority: permission denial, per-connection jobs and login URL isolation |
| Desktop interactions | Real Electron chooser/drop, ZIP, double-click, clipboard and restart tests |
| Debian 12 amd64 | Local disposable container: installation, backend health, nested uploads, removal and reinstall retaining files/credentials |
| Debian 12/13 and Ubuntu 22.04/24.04/26.04, amd64/arm64 | Native GitHub Actions build and disposable container matrix required |
| GNOME X11/Wayland and Mint Cinnamon 21/22, LMDE 7 | Pending full desktop VM acceptance |
| Graphical administrator authentication | Pending real Polkit dialog, cancellation and retry in desktop VMs |
| Authenticated Tailscale sharing | Pending test tailnet: browser login, machine/HTTPS approval, second device, lost connection and preserved unrelated routes |
| Session lifecycle and package upgrades during transfers | Pending real logind/systemd sessions, including logout with pre-existing linger |
| Flatpak desktop portals | Bundle builds locally; file chooser/opening, background allow/deny and explicit native-data import require desktop acceptance |
| APT production | Not enabled. Only ephemeral test keys used. Production key, backup and Pages configuration pending DEB acceptance |
| AUR publication | Not submitted. Requires both architecture manifests, clean Arch validation and maintainer AUR account |

The existing installed Airdrop on the development computer must not be upgraded as part of these tests. Use isolated test roots, containers or VMs. Never use a real user tailnet or its credentials for unattended CI.
