# Simplified desktop workspace

Supersedes the mandatory first-run connection flow introduced in revision 4.
A concise first-launch welcome dialog is retained. It offers optional Tailscale
connection and a local Continue action. Device connection also lives in Settings
and never blocks local work. The Connect navigation item and redundant Activity shortcut
are removed. Transfer uses a single drop area with Choose and Paste controls;
advanced preferences, external addresses and LAN configuration are collapsed.
File, ZIP, clipboard, sorting and native drag/export capabilities are retained.

Repeated Tailscale Connect calls reuse a running helper instead of cancelling
its authentication or certificate provisioning. A waiting connection disables
Connect, offers explicit Disconnect, and explains delays after 45 seconds while
Transfer remains available. TLS checks remain enforced; this change does not
claim to accelerate certificate issuance or bypass tailnet approval.

Local validation: 112 unit tests; native Electron integration including actual
clipboard file/image/text paste and sandbox checks. Old mandatory-wizard tests
were replaced by nonblocking startup and idempotent connection regressions.
Physical Omarchy/Tailscale account latency remains unmeasured.

## Welcome connection feedback

The welcome dialog and Settings share a connection status presenter. A spinner
and elapsed time indicate ongoing work; no fake percentage is shown. Browser
sign-in and HTTPS-configuration states expose the relevant action instead of
spinning indefinitely. Administrator approval and slow certificate/connectivity
checks have distinct messages. After 45 seconds, help explains automatic checks
and offers local continuation or explicit cancellation. Reduced-motion users get
a static progress indicator and the same text/timer. Successful TLS health checks
are still required before publishing a link/QR. No certificate-issuance speedup
or real account/device validation is claimed.

Continue and Escape dismiss the welcome without stopping an active connection;
a local presentation preference remembers dismissal independently of verified
Tailscale onboarding. Nothing navigates automatically to connection settings.
Validation: 113 passing unit tests and passing native Electron integration; the
tray test is skipped without a StatusNotifier watcher. See evidence/welcome-progress.
