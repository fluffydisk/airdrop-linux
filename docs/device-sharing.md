# Connect devices inside Airdrop

The first-run wizard handles connection, background sharing and phone pairing
without sending the user to a terminal, VPN login or server setup page:

1. Choose **Connect over the internet — free** for different networks, or
   **Connect over Wi-Fi** for the same trusted local network.
2. Wait for a real authenticated health check. Only then does Airdrop ask
   **Keep sharing when you close the window?** Choose either background sharing
   or sharing only while the app is open. The screen explains that this can be
   changed anytime in **Settings → Device connection**.
3. Scan the verified QR code with an iPhone or Android camera. The phone opens
   the web app in Safari/Chrome and can upload/download files immediately.
   The desktop confirms pairing only after a successful pairing request.

No Tailscale client/account, purchased server, domain or manually entered access
key is required for either normal setup option. Advanced operator settings are
collapsed and are not part of the wizard. Setup completion is saved on disk only
after connection verification and an explicit background choice. Dismissing setup
does not mark it complete; the wizard returns next time.

## Free internet sharing

This optional mode uses Cloudflare Quick Tunnels. First use downloads the pinned
official cloudflared component inside the app, showing actual download progress.
Its size and SHA-256 must match [internet-helper.json](../packaging/internet-helper.json)
before it can execute. Only verified cached bytes are reused. The helper runs as
the app user with an isolated configuration, disabled self-updates, private
metrics listener and a loopback target pointing to the authenticated sharing
gateway. It never exposes the unauthenticated backend directly. No browser login
or Cloudflare account is requested. Ports are not opened on the user's router.

Cloudflare provides the public HTTPS address; no user-owned server/domain is
needed. Cloudflare terminates TLS and can read relay traffic. This is not
end-to-end encryption between devices. Account-free Quick Tunnels have no uptime
guarantee and are intended for temporary use; they may be unavailable or blocked
by a network. Airdrop shows errors rather than advertising an unverified QR code.
Choose Wi-Fi if the free service cannot connect. A new tunnel/app session creates
a new sharing link, so scan a fresh code after restarting. Background sharing
keeps the current helper and pairing session alive while the window is hidden.

The provider's limitations are documented in its [pinned implementation](https://github.com/cloudflare/cloudflared/blob/2026.10.7/cmd/cloudflared/tunnel/quick_tunnel.go).
The downloaded component is distributed by Cloudflare; its [Apache 2.0 license](https://github.com/cloudflare/cloudflared/blob/2026.10.7/LICENSE)
applies. No third-party account credentials are bundled.

## Direct Wi-Fi sharing

This mode uses no internet relay. The wizard selects a private Wi-Fi/Ethernet
interface automatically; advanced network selection remains available in
Settings. Both devices must use the same reachable local network. Guest Wi-Fi
client isolation, VPN routing and host firewalls can prevent access. LAN mode
uses HTTP and must only be used on a trusted network. The wizard explains this
before the user starts sharing. Pairing links grant workspace access; keep them
private. This mode does not silently replace an unsuccessful internet connection.

## Background behavior

Automatic connection on app open defaults to on. Background sharing defaults to
off until the user chooses it in the wizard or Settings. With background off,
closing the window stops the connection and invalidates its session. Opening
Airdrop reconnects using the saved mode. With background on, closing hides the
window; reopen Airdrop to return. **Quit** always stops the connection and any
child helper. This preference does not install a login startup task or keep the
app running after logout/reboot.

Flatpak requests OS background permission only after opt-in. Denial keeps the
setting off and is explained inside the wizard, which still allows foreground
sharing. Snap also requires its background user service. The setting applies to
the desktop computer. iPhone/Android browsers may pause when backgrounded; the
phone UI explains that transfers should stay open until finished. Native mobile
background services are not implemented.

The mobile web app verifies connection status, offers a retry, and gives
instructions when the computer is unavailable or a pairing session expires.
Downloads use short-lived, single-use GET tickets so native mobile downloads can
stream without loading entire files into memory or weakening origin checks.
The original POST download API remains available for existing clients.

## Optional managed service for distributors

For a stable operator-owned service, the earlier Airdrop HTTPS relay remains an
alternative. Set `relayUrl` in [connection-service.json](../packaging/connection-service.json)
or set `AIRDROP_CONNECTION_SERVICE_URL` when running `npm run prepare-desktop`.
The URL is embedded in the desktop package; end users never need to type it.
Enable `AIRDROP_RELAY_ENROLLMENT=1` on the relay to enroll devices automatically.
Enrollment issues a device-scoped token rather than distributing the relay's
master key, and applies rate/concurrency limits. The credential remains in the
private desktop state file and is not returned to the renderer.

The optional relay requires DNS for its domain and wildcard subdomains, a trusted
TLS certificate, and Node 18+. Run `node network/relay/server.js` with:

```sh
AIRDROP_RELAY_DOMAIN=relay.example.com
AIRDROP_RELAY_ACCESS_KEY=<random service secret of at least 32 characters>
AIRDROP_RELAY_ENROLLMENT=1
AIRDROP_RELAY_CERT=/etc/airdrop-relay/fullchain.pem
AIRDROP_RELAY_KEY=/etc/airdrop-relay/privkey.pem
PORT=443
```

Keep these in a private service environment file. A systemd example is in
[airdrop-relay.service.example](../systemd/airdrop-relay.service.example).
No managed service is configured/deployed by this repository. It is optional;
the normal Wi-Fi/free internet wizard does not ask the user to host one.

## Validation

```sh
npm run prepare-desktop
npm test
npm run test:desktop-connection
npm run test:mobile
```

Tests exercise a real desktop wizard with sandboxed Electron, persistence,
background denial/opt-in/opt-out, and real authenticated file upload/download in
Chromium using iPhone and Android viewport/user-agent profiles. These are browser
emulations, not physical iOS/Android hardware or a native Safari/WebKit run.
Relay tests use real TLS sockets and a trusted test certificate. Component tests
verify checksum enforcement, cancellation, progress, provider-origin parsing and
child-process cleanup with a controlled process; they do not claim a live tunnel.

The pinned real cloudflared binary and CLI options were checked. A live Quick
Tunnel attempt in the managed development environment failed with a direct TCP
connection refusal to `api.trycloudflare.com:443`; no external phone transfer
through the free service was established here. Public-service availability and
real-device acceptance remain separate validation steps. Historical release
reports describe the old Tailscale implementation and do not validate this flow.
