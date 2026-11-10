# Nearby device sharing

1. Install Airdrop 1.8 or later on both Linux computers and open it on the same private IPv4 network.
2. In Transfer, select **Pair device** beside the other computer. Compare the code shown on both computers and approve only if it matches. The sender retains the code while waiting for the receiver.
3. Select **Send to this device**, then choose or drop files. Select **Send to device** to start. Accept the request on the receiver; files are saved individually to `Airdrop/Received`.
4. If interrupted, keep the original files and use **Retry / resume** in Device transfers. A restart preserves both device identities and transfer journals. Already verified chunks and completed files are skipped. Changed source files require a new transfer.

A saved device appears offline when it cannot be reached with its pinned identity. Discovery refreshes automatically and checks all advertised private IPv4 candidates. Friendly names need not be unique; the displayed identity prefix distinguishes devices. **Forget device** revokes that device's incoming request permission on this computer. It does not erase received files or remove this computer from the other device's list.

**Automatically accept files from this device** applies only to incoming direct files from that paired identity. It defaults off. It never authorizes clipboard synchronization or browsing a workspace. Device preferences allow naming this computer, stopping nearby discovery/listening and choosing 1–4 simultaneous outgoing transfers. Closing the window follows the existing background-sharing setting and system permissions; quitting stops nearby sharing.

History retains up to 100 transfers in each direction. **Clear transfer history and partial downloads** removes journals and incomplete chunks; it keeps received files and paired devices. A cancelled sender can resume. **Decline remaining files** on the receiver revokes that transfer, so the sender must start a new one. No automatic relay fallback occurs; internet and Tailscale workspace access remain separate options in Settings.

If no device appears, check that both apps are open, nearby sharing is enabled, both computers are on a private IPv4 network and multicast is allowed. Guest/isolated Wi-Fi and firewalls may block UDP 5353 or incoming TCP. Select **Connect a phone by QR** to set up a workspace connection, then use the existing **Share with a guest** QR flow for a phone or network where native discovery is unavailable. Native peer discovery does not run in a mobile browser, and this feature does not speak Apple's AirDrop protocol.

Chunk data is bounded to 1 MiB per request. Receiver staging and complete-file publication happen on the inbox filesystem; private chunk journals can be on another volume. Each chunk is hashed before acknowledgement and rechecked on resume. The receiver checks final size and SHA-256 before exclusively linking a complete file into its inbox. Existing names are numbered rather than overwritten. Data is retained locally for explicit recovery and cleanup.

Competitor patterns evaluated: [LocalSend's discovery/prepare-upload protocol](https://github.com/localsend/protocol), [PairDrop's pairing and browser constraints](https://github.com/schlagmichdoch/PairDrop/blob/master/docs/faq.md), [KDE Connect's identity/pairing model](https://github.com/KDE/kdeconnect-meta/blob/work/protocol-schemas/protocol.md), and [Apple's device-selection/receiver-acceptance flow](https://support.apple.com/en-gb/119857). The implementation is Airdrop Linux's own protocol; no cross-app protocol compatibility is claimed.

## Seamless sharing development

The Transfer view now queues chosen files until Send. Choose **Share link / QR**
for a browser recipient or when discovery/direct traffic is blocked. Reuse a
ready connection, or explicitly create an internet link / start trusted LAN
sharing. The invitation exposes only the selected downloads, expires after ten
minutes, and cannot upload or access your workspace. Copy checks that the link
is still current. Stop invitation revokes it. Existing **Share with a guest**
sessions still support explicit upload/bidirectional workflows.

Nearby now prefers incoming TCP 53318 (configurable in Device preferences); an
occupied port falls back to a dynamically advertised port. Permit incoming TCP
and UDP 5353 only through normal OS/network policy. No firewall exception is
installed automatically. A paired endpoint can reconnect without multicast if
its saved address/port still works; its certificate must still match.

On-link IPv4 (including public campus subnets) and scoped IPv6 are eligible.
No discovery traffic is sent to arbitrary off-link addresses, container bridges
or VPN interfaces. Same SSID does not establish direct reachability. A school
network may block both discovery and peer traffic; use an independently permitted
internet route when available. This does not bypass institutional restrictions.

See [current implementation gates](cross-platform-implementation.md).
