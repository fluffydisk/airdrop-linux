# Simplified desktop workspace

Supersedes the mandatory first-run connection flow introduced in revision 4.
Transfer is available immediately. Device connection lives in Settings and never
blocks local work. The Connect navigation item and redundant Activity shortcut
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
