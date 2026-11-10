# Diagnostic implementation map and source audit

Scope: current PR #21 at owner-tested `4a68dd4`, extended by this change. No parser acceptance rule, advertising payload, advertised PSM, secure-session algorithm, consent rule or transport framing is relaxed. New source is original GPL-3.0-only repository work; no additional upstream implementation was imported. Existing upstream provenance/notices remain in `quickshare-ble-implementation.md` and the vendored library.

| Boundary / source | Previous loss or early return | Instrumentation / qualification |
| --- | --- | --- |
| `ble/radio.rs` scan lease | BlueZ start error discarded, deliberate 3s/7s cycles, active-session pauses | requested/success/failure/windows, scan/pause milliseconds, pause cause, stream close, D-Bus error categories |
| scan cache / device watchers | initial replay skipped; 1024 cache / 128 watcher limits | replay suppression, cache/watcher limits; no RSSI-only refresh |
| FEF3 service data | observed counter advanced; failed full and header decode immediately continued | bounded lifetime observations, internal ephemeral repeat/distinct tracking, length/high-bit buckets, two parser results, jointly rejected observation count |
| `ble/protocol.rs` full parser | anyhow validation strings discarded | typed length/version/socket/fast/hash/PCP/endpoint/flags/PSM/truncation/unknown-field reasons, same rejection gates |
| compact parser | raw/base64 decoding, length/version/slots/Bloom/PSM errors erased | typed encoding/length/version/slot/Bloom/PSM reasons, no weakened checks |
| compact cache hit / resolution retry | cached target refreshed; retry/capacity skipped | cache hit, resolution throttling, target capacity; headers only retained for live targets |
| `characteristics` / `resolve` | optional slot read/decode failures ignored; existing ACL refused | service/slot/read/rejection/characteristic capabilities; owned-ACL attempt/outcome, refusal, timeout and D-Bus category |
| target conversion / publication | absent slot, hidden/self endpoint, stale target or full target map skipped | endpoint accepted/visibility/self/transport availability, expiration/removal, readiness and IPC queue/drop |
| local GATT application | registration, slot reads, invalid offset/write length/visibility, bounded ingress/notification gate | registration request/outcome, read/write/rejection, notification setup/busy, ingress overflow; local ACL activity before a callback remains unknown |
| Weave / LE CoC | generic bootstrap/session failure | first Weave negotiation, established/rejected/timeout, LE PSM bound/validation/attempt/outcome, inbound CoC and bootstrap rejection; not confused with slot reads |
| `main.rs` | bounded recipient map/expiry; core protocol events routed separately | helper recipient receive/publication; UKEY progress, Nearby connection request and terminal/transfer state counters; detailed existing protocol events retained in lab |
| `lib/sharing/quickshare.js` | IPC name/route validation, route limit, route dedup; intentional stop invokes failure | validation/capacity/route/selector/outbound counters; explicit clean/forced/unexpected/start-failed lifecycle |
| `desktop/nearby-ui.js` → `desktop/main.js` | main-process state did not prove renderer published options | lab-only renderer acknowledgement with ready/unready counts; no names/IDs exported |
| `lab-evidence.js` / old report | teardown overwrote active snapshot | monotonic counter maxima, last active helper snapshot, shutdown intent and sanitized lifecycle; older collected report also prefers active state |
| USB / `adb.cjs` | no Android observation | authorized USB-only, discovered/validated package aliases, service/readability status, strict fixed categories, bounded read-only commands and sample clocks |
| `diagnose.cjs` / `deep-report.cjs` | separate manual steps and ambiguous yes/pass answers | isolated bounded orchestration, explicit markers/phrases, current-capture protocol evidence, closed export DTO, byte readback check, three-file archive allowlist |

Counters aggregate observations across peers. No address, endpoint hash or per-candidate identifier is exported. Full/compact rejection counters are parser attempts; slot rejection counters are separate. Zero/absent counters before instrumentation cannot reconstruct the reason for the owner's 72 observations. Error categories report API results, not RF emission or Samsung attribution. Protocol-state tests and independent wire peers do not constitute a stock-device test.

Review targets: fixed input/queue/cache bounds; no await while holding diagnostic locks; no callbacks blocked by diagnostic emission (`try_send` remains bounded); no notification-worker ownership changes; no new radio/policy permissions; owned ACL disconnect behavior retained; session cancellation/deadlines and cryptographic/file-handling code unchanged. The global fixed-schema counters live for one helper process, survive adapter retries, and never reset on Bluetooth stop. Capture-window deltas are separately reported on attachment.
