# Physical Galaxy S24+ evidence: first verified LAN fixture transfer

**Verified physical result:** Linux → stock Samsung Quick Share delivered the
49-byte `lab-small.txt` fixture, accepted manually on the Galaxy S24+, with native
receiving-UI completion and owner-performed independent USB ADB readback whose
SHA-256 matches the original. This verifies this fixture on this home-LAN path.
It is not production acceptance, a Bluetooth transfer, proof of BLE discovery,
a Samsung → Linux result, or proof of an application-success ACK to the sender.

Tested application commit: `3cec650445595873497634d909e4c378b3648d37`.
The attached reports record a clean source tree, verified helper hash and source
fingerprint, and the `ble-native` feature. Both captures used ordinary home Wi-Fi.
The owner independently attributed the selected recipient's IP to the S24+; that
IP and other device identities are intentionally not recorded here.

## Sources and provenance

| Evidence | Provenance | Archive SHA-256 |
| --- | --- | --- |
| `quickshare-discovery-test.tar.gz` | Owner-provided physical diagnostic capture | `290b125898fcd96d528624d7dc458030257ef63549628b87f3123eb9c20f668e` |
| `quickshare-first-samsung-transfer.tar.gz` | Owner-provided physical diagnostic capture | `cb5f7961851364240750055b43c41800423ef8f60520410a9c5b4415c26b6454` |
| Native recipient, phone acceptance and receiving-UI completion | Owner UI observation; recipient/completion confirmations also in second archive | Not a packet capture |
| Independent USB readback, 49 bytes, matching SHA-256 | Owner-performed independent verification, reported **after** the archived capture | Retrieved bytes were not attached; the engineer verified that the reported digest also matches the deterministic repository fixture |

Original Linux fixture and owner-retrieved phone copy:

```text
size:   49 bytes
sha256: b753383d7fabdf101bb7ce2c3cb6261ed9960e5212ece3bfc3b103ccfe7efbd7
```

The archives are not committed. A minimized regression fixture contains only
reviewed counters and protocol/publication transitions, with separate provenance
for the later readback statement. The archived report's missing readback hash is
not retroactively replaced or presented as an original runtime observation.

## Successful session

The connection and sending sequence occurred on 11 November 2026 at
23:45:48–23:45:52 CET. The archive retains UTC timestamps (22:45:48–22:45:52Z).

| Offset from outgoing connection | Recorded event |
| ---: | --- |
| 0 ms | outgoing `connecting` |
| 109 ms | `SentUkeyClientInit` |
| 165 ms | verification available |
| 166 ms | `SentUkeyClientFinish` |
| 254 ms | `SentPairedKeyEncryption` |
| 343 ms | `SentPairedKeyResult` |
| 345 ms | `SentIntroduction` |
| 3916 ms | `SendingFiles` |
| 4046 ms | `Sent` |
| 4048 ms | `outcome-unknown`, 49/49 bytes |

**Transport diagnosis — source-code inference corroborated by runtime and owner
observations:** mDNS/DNS-SD recipient discovery → direct Wi-Fi/LAN TCP connection
→ UKEY2/Nearby encrypted session → introduction/remote acceptance → encrypted
payload transmission. Only LAN and BLE recipient sources were enabled; BLE
produced no decoded/resolved/ready endpoint or connection. Published recipients
therefore came from the mDNS path. The helper sends such endpoints through
`TcpServer::connect`, using the endpoint's advertised IP/port. No BLE-to-LAN
upgrade or Wi-Fi Direct was enabled. The archives did not contain an explicit
per-connection transport event; the new implementation records that separately
for both incoming and outgoing connections.

The first capture already recorded a LAN recipient publication and rendered
ready recipient, but no owner attribution or transfer. It must not be described
as Samsung discovery proven by that capture alone.

## BLE boundary and strict Fast support

| Capture | FEF3 observations | Old Fast-shape recognizer | Jointly rejected | Decoded / resolved / ready BLE |
| --- | ---: | ---: | ---: | --- |
| discovery | 64 | 63 | 64 | 0 / 0 / 0 |
| transfer | 102 | 94 | 102 | 0 / 0 / 0 |

In the transfer capture, 94 observations had full-parser
`unsupported_fast_format` and compact-parser `invalid_length`. Eight short
observations had invalid length/encoding and were unrecognized. These are
observations, not device counts. No FEF3 packet has been independently attributed
to Samsung. The old recognizer established only a bounded shape; it did not
validate a complete protocol variant. Raw advertisements were not collected.

Google Nearby at `1bbe8ec1eadd0c08d01db6b634254526141068e6` independently documents:

- `sharing/nearby_connections_manager_impl.cc`: Quick Share's `NearbySharing`
  service binds Fast discovery to FEF3; identity-only metadata can select Fast.
- `connections/implementation/mediums/ble/ble_advertisement.{h,cc}`: outer version,
  socket version, Fast flag, one-byte data length, optional two-byte token;
  legacy Fast has a 27-byte limit and no room for extra transport fields.
- `connections/implementation/ble_advertisement.{h,cc}`: inner v1 PCP/endpoint/
  endpoint-info data omits the full advertisement's service hash and Bluetooth
  MAC; Fast endpoint metadata is at most 17 bytes.
- `connections/implementation/mediums/ble/discovered_peripheral_tracker.cc`:
  Fast service matching uses the tracked service UUID, not a missing hash.

The new decoder supports the strict FEF3-bound v2/socket-v2, v1/P2P-point-to-point,
17-byte identity legacy subset, with absent/zero-length UWB, optional token,
valid endpoint bytes and bounded exact lengths. Unsupported profiles, versions,
PCPs, extended extras, unknown fields and malformed metadata remain rejected.
Independent Python-encoded positive fixtures and adversarial negative fixtures
are **synthetic protocol tests**, not the owner's packets.

A Fast candidate does not carry a PSM or a full public display name. The scanner
uses bounded GATT resolution; it requires a hash-validated full slot with the
same endpoint and identity before publishing it. Existing public-visibility and
self-suppression rules remain. A missing slot, mismatch, failed connection or
unavailable transport is recorded; it is never converted into a fake ready
recipient or a guessed port. This deliberately conservative subset may not make
an Android background/contacts-only advertiser selectable. Unsupported extended
Fast variants remain unimplemented. The ordinary full/compact codecs, LAN
selection preference and the working TCP send sequence are preserved.

## Completion and listener reporting

`Sent` means the sender finished emitting all file chunks and its existing
bounded finalization wait ended. That wait handles authenticated keepalives,
late payload errors/cancellation, and peer EOF/disconnection. It does not return
a durable Android application-success assertion. The phone can finish and the
owner can independently verify bytes while the sender correctly remains
`outcome-unknown`. The ~130 ms from `SendingFiles` to `Sent` is consistent with an
early peer close, but the old archive did not record the close reason: **unknown**.

New diagnostics observe local payload completion, peer EOF, authenticated
DISCONNECTION, timeout, late error and a matched-file payload receipt ACK
separately. A receipt ACK for one payload is not proof of application finalization
or all-file persistence. No frame sequence, cryptography, wait duration,
keepalive behavior, consent decision or `Sent` mapping was changed.

Deep report schema 2 replaces misleading `protocolCompletionObserved` with
`localPayloadCompletionObserved`, plus separate peer/receipt/application,
receiver-finalization, native-UI and independent-hash fields. Explicit connection
events take precedence over planned transport or legacy source inference.

The archived `lan.listenerReachable=false` is the finalized supervisor snapshot:
shutdown explicitly sets that field false. It is not evidence the active
listener failed, and an outgoing TCP connection does not require Linux's inbound
listener. New reports preserve the active probe, its provenance and ever-reachable
state, and show the post-shutdown value separately. Legacy stopped snapshots
without an active probe are UNKNOWN, not a fabricated active-session failure.

## ADB visibility limits

Both captures had one authorized USB device, readable-partial epoch logcat and
no recognized allowlisted Android events. The discovery/transfer captures had
282/665 discarded records and 13/21 command output-limit events. Bluetooth status
was inaccessible/unparsed, Wi-Fi status unknown, and one of two candidate package
metadata queries was unavailable. One validated system package candidate had
numeric version `13.9.02.31`; that alone does not prove which privileged component
performed the transfer. These data do not establish a Samsung permission defect
or absence of Android service activity. Collector output limits and platform
permission restrictions were not separately attributable per command in the old
report; new Bluetooth/Wi-Fi observation-status fields distinguish them where
observable. Bounds are retained; no raw log or larger full dump is requested.

## Next physical matrix

Keep ordinary home Wi-Fi, radio settings and Apple-sharing setting unchanged.
Use a new private workspace for each run, the same 49-byte fixture and a
300-second window. A report with no recipient/connection is still useful.

1. **Priority: Samsung → Linux.** Share the already verified fixture from native
   Samsung Quick Share to Airdrop S24 Lab. Compare codes and accept in Linux.
   Record target visibility, first incoming connection, consent, both UI outcomes
   and the independently hashed published Linux file. New connection events
   identify LAN TCP versus Weave/GATT versus LE CoC without exporting addresses.
2. **Preservation check: Linux → Samsung.** Repeat the known-working ordinary-LAN
   fixture transfer on this head, including independent USB readback. Keep native
   completion, local `Sent`, peer-close/receipt events and byte hash separate.
   The report should preserve the active listener probe after shutdown.
3. **BLE analysis within the same runs.** Use the built-in closed-view baseline,
   then open native Receive/Send at the requested marker. Compare `fast_accepted`,
   exact `fast_reject_*`, GATT-resolution/slot-identity and readiness counters.
   A temporal change is a hypothesis, not Samsung packet attribution. No separate
   hotspot, large-file or Apple-setting sweep is needed before reviewing these
   two reports.

```bash
bash scripts/quickshare-android-lab.sh --diagnose --adb \
  --direction samsung-to-linux --network ordinary --duration 300 \
  --workspace "$PWD/.cache/s24-receive-02" --archive

# Use a fresh, fixture-only directory for independent phone readback.
mkdir -p "$PWD/.cache"
mkdir -m 700 "$PWD/.cache/s24-readback-02"
bash scripts/quickshare-android-lab.sh --diagnose --adb \
  --direction linux-to-samsung --network ordinary --duration 300 \
  --workspace "$PWD/.cache/s24-send-02" \
  --readback "$PWD/.cache/s24-readback-02" --archive
```

Copy only the received fixture into the readback directory before the final
confirmation answers (prompts time out after two minutes). Return the sanitized
archive from each workspace's `reports` directory plus yes/no/unknown/not-tested
UI observations. Never send codes, device addresses or raw logs. USB debugging
and collection consent remain manual; no root, APK, radio/policy change, merge
or release is required. A positive result remains scoped to its actual transport,
fixture, phone/software versions and observation conditions.

Google's current `connections/implementation/payload_manager.cc`,
`offline_frames.cc` and `proto/offline_wire_formats.proto` also distinguish modern
`PacketType.PAYLOAD_ACK = 3` from deprecated CONTROL `PAYLOAD_RECEIVED_ACK = 3`.
The vendored enum predates the modern packet type. The new observer recognizes
both shapes through the preserved raw enum value, only after authenticated
frame decoding and only for a matching file payload ID. It records which encoding
was seen. Google's incoming sharing session separately calls `FinalizePayloads()`
after payload completion; a transport ACK cannot substitute for that application
step. There is no evidence in the old archive proving whether Samsung sent either
ACK. No wire schema, ACK transmission or success-state behavior was changed.

## Automated validation of the extension

Cloud verification (no phone/controller attached): 265 Node tests pass; Rust
workspace tests pass in default/FastInit/native configurations (39/41/61).
Formatting and clippy pass with existing vendored warnings. The independent
Python peer passes commitment/MAC/replay/decline/empty/binary cases, with the
binary case additionally validating the incoming TCP method diagnostic. The BLE
oracle validates independently generated positive and negative Fast fixtures.
Actual helper lifecycle/probe filtering and default/native sandboxed Electron
laboratory/recipient/report tests pass; the desktop tray test skips without a
StatusNotifier watcher. Privileged namespace transfer validation runs in CI.
Preflight waits for stdout drainage after process exit; deterministic ordering
coverage and 100 real helper checks pass. These are automated regressions, not
physical validation of the modified head.
The owner-verified physical fixture remains specifically at `3cec650`.

For the forward preservation check, read back the **newly received** phone copy.
Use its creation time/collision suffix, or move only the old disposable fixture
out of the receive folder before sending. Reusing the previous successful copy
would not independently verify the new attempt. The already verified phone copy
is suitable as the input fixture for the Samsung → Linux test.
