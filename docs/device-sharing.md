# App-managed device sharing (Flatpak r2)

## Why r1 had no setup wizard or QR

The r1 desktop only supported a manually entered external workspace URL. It did
not embed a Tailscale node, create a LAN listener, or implement first-launch
onboarding. Healthy loopback services did not establish cross-device access.
The legacy URL field remains available; the new **Connect device** page is the
normal setup path.

## Connection choices

- **This computer:** backend/file service stay on loopback. No sharing address.
- **Trusted LAN:** an explicit private IPv4 interface is selected, a gateway binds
  that address on an automatically assigned port, and an actual authenticated
  backend health request must pass before displaying a pairing link and QR.
  Both devices need the same LAN; client isolation/firewalls may block peers.
  This mode uses unencrypted HTTP: only use a trusted LAN. No router/UPnP or
  firewall changes are performed. A changing interface revokes the displayed URL.
- **Tailscale:** a source-built Go helper embeds `tailscale.com/tsnet` v1.104.2.
  Electron manages its lifecycle and stores node state in its private user data
  directory (0700). No host Tailscale package, daemon, CLI, TUN device, root
  privilege, host filesystem grant, or host-command execution is required.
  Normal system routing and configured HTTP(S) proxies are retained; no host
  VPN routes or privileged bypass socket marks are installed. This does not
  disable Flatpak's namespace or Chromium's sandbox.

Tailscale login is real interactive browser authentication, without shipping an
API key. The application waits for the control plane's login URL and offers an
**Open Tailscale sign-in** button. It follows login/device approval status. The
user may switch to LAN/local mode while authentication or networking is pending.
Previously selected Tailscale mode reconnects after restart; LAN exposure always
requires explicitly starting sharing in that session.

The helper uses `tsnet.ListenTLS` on the private tailnet, never Funnel. MagicDNS
and HTTPS certificates must be enabled by an authorized tailnet user in the
Tailscale DNS settings; the UI offers the official settings page. DNS alone is
not treated as working HTTPS. Before advertising a URL, the helper performs a
real HTTPS request through its userspace network to the paired backend, verifies
the certificate and the expected health payload, and rejects redirects. Failed
login, TLS, or route checks clear the address and QR. No certificate-verification
bypass is used.

**Phone/tablet requirement:** install and sign in to the Tailscale client on that
other device, join the same tailnet, and allow access under its ACLs. A browser
alone cannot join a private VPN. On the Linux desktop only, Airdrop embeds its
own node. For a browser-only phone experience, choose trusted LAN instead.

## Pairing and security

The link carries a random 256-bit capability in the URL fragment. The pairing
page removes that fragment from browser history, posts it to its own origin,
and establishes an HttpOnly, SameSite=Strict session cookie (Secure for TLS).
Without the capability/cookie, file, clipboard and API requests receive 401.
Foreign origins/hosts are rejected. Tokens/cookies are stripped before proxying
requests to the loopback backend. Disconnect closes sockets and revokes links.
Anyone with the current pairing link can use the shared workspace: treat links
and QR codes as secrets. Never include them in public screenshots or logs.
LAN HTTP does not protect them against an observer on that LAN.

The core Node file, ZIP and clipboard implementation is retained. The gateway
streams requests to it instead of exposing the backend directly. No unrestricted
D-Bus, filesystem, device or host-execution permissions are added.

## Reproduce

```sh
npm ci --ignore-scripts
npm ci --prefix desktop --ignore-scripts
npm run prepare-desktop
# Include a real dufs on PATH for the existing integration test; umask 022 is
# required by the existing portable-update executable-permission fixture.
umask 022
npm test
cd network/tsnet
GOTOOLCHAIN=local CGO_ENABLED=0 go mod verify
GOTOOLCHAIN=local CGO_ENABLED=0 go mod vendor
GOTOOLCHAIN=local CGO_ENABLED=0 go test -mod=vendor ./...
GOTOOLCHAIN=local CGO_ENABLED=0 go build -mod=vendor -trimpath -o ../../airdrop-tsnet .
cd ../..
node scripts/test-tsnet-bootstrap.cjs ./airdrop-tsnet
# Preparation is online; compilation and npm/Cargo installation are offline.
python3 scripts/prepare-device-flatpak.py --commit "$(git rev-parse HEAD)" --output /path/to/new-r2-recipe
python3 scripts/validate-flatpak-reference.py --manifest /path/to/new-r2-recipe/io.github.fluffydisk.airdrop-linux.yml --arch x86_64 --builder native --output /path/to/new-r2-validation
```

Use Go 1.27.3, native x86_64 Flatpak tools and signed 26.08 SDK/BaseApp/Node24/Rust
extensions. The preparer downloads the published immutable application commit,
verifies newly required npm archive integrities, vendors checksum-verified Go
modules, creates a normalized vendor archive and records its actual SHA-256.
Keep that archive alongside the generated manifest. It is an internal GitHub
reference, not a Flathub submission; the official prebuilt Electron runtime
remains a separate Flathub source-build limitation.

The publication workflow gates upload on independent staging, clean offline
compilation, package lint, install/startup, paired transfer/QR tests, and an actual
unauthenticated Tailscale control-plane login URL. It never logs login links or
publishes node state. Authenticated tailnet/phone acceptance requires a real user
account and second device and must be reported separately.

## Official implementation references

- https://tailscale.com/kb/1244/tsnet
- https://pkg.go.dev/tailscale.com/tsnet#Server.ListenTLS
- https://pkg.go.dev/tailscale.com/tsnet#Server.Dial
- https://tailscale.com/kb/1153/enabling-https
- https://tailscale.com/kb/1081/magicdns
- https://tailscale.com/kb/1223/funnel
- https://docs.flatpak.org/en/latest/sandbox-permissions.html

Publication checks and remaining acceptance limits are recorded in
[the r2 evidence report](flatpak-device-sharing-r2.md).
