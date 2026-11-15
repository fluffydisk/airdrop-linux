# S24+ post-consent follow-up to PR #22

Development only. No merge, release or claim of a successful Samsung-to-Linux
transfer. Preserve the independently hash-verified 49-byte Linux-to-Samsung LAN
result at `3cec650445595873497634d909e4c378b3648d37`.

## Physical evidence and limits

The owner supplied `s24-hci-recovery-result.tar.gz` (archive SHA-256
`59019a2fdf350bfb92b88f6381589d92145f4a9be64a06fc7184c1ba851e64c8`).
Its runtime, rebuilt after the older preflight, verified clean commit
`b3bb1869d5be0e9e95b5dff910110df48d314344`, helper SHA-256
`839b6fe5bf9b62339e8389271cc84e49f8e86c5f9840012fef4e3a13e760aade`.
The archive contains three sanitized reports, not the raw kernel journals or
screenshots mentioned in the subsequent owner statement.

Direct runtime observations, 2026-11-15 UTC (CET is UTC+1):

- 13:17:41.354: attempt-2 incoming `ble-l2cap` connection.
- 13:17:41.516–41.902: Nearby connection request, UKEY2 progression, connection
  response and paired-key results. Comparison-code availability is recorded
  without its value. Neither persistent peer trust nor independent owner code
  comparison is implied by these states.
- 13:17:42.044: awaiting consent for 49 bytes.
- 13:17:45.711: acceptance; 45.714 `ReceivingFiles`.
- 13:17:47.386: disconnected; 47.396 interrupted **0/49**. This is 1,675 ms
  after acceptance. No completed file or independent inbound hash exists.
- One aggregate `l2cap_transport_io_error`. In that source revision this counter
  specifically covered a socket **read** error; the errno was discarded. It
  cannot identify peer behavior, link failure or the originating controller.
- Initial advertising succeeded, then ten registrations failed. Renewal cleanup
  was acknowledged at age 90,240 ms within a 120,000 ms lease, with owner closed
  and a 250 ms guard. This is not controller-removal or RF-transmission evidence.
  First reported renewal failure follows the transfer disconnection by ~9 s.
- No adapter-generation loss/runtime failure was recorded. The owner-inspected
  14:17–14:19 CET kernel excerpts report `0xfc19` events, without a reported
  `0x200c` timeout, USB reset or index change. This bounded absence is not proof
  of universal controller stability. Scan stops were acknowledged 27/27.

The archive's owner answers remained UNKNOWN. The later, explicit owner UI
statement confirms recipient visibility, an incoming Linux dialog, acceptance,
Samsung's code and subsequent error, no delivered file, and no observed headset
interruption or WirePlumber crash. Linux's comparison code was not visibly seen.
Keep these provenances distinct. Remote Fast/GATT observations are unattributed.

## Source-backed corrections; physical cause remains unknown

1. **BLE ACK length:** the bridge acknowledged `data.len()` including the inner
   four-byte length prefix. Google's `BleSocket::ReadPayloadLength` passes the
   decoded payload length to `SendPacketAcknowledgement`. We now exclude the
   prefix and acknowledge the validated header before waiting for the body, as
   the reference does. A peer may wait for that acknowledgement before sending
   its body. A separately encoded positive fixture checks exact bytes; the
   independent client checks every acknowledgement against its transmitted
   payload sizes. This mismatch is proven; its role in Samsung's failure is not.
2. **Full-duplex progress:** the serial pump awaited a whole socket write inside
   a select branch, blocking socket reads under backpressure. Reads and writes
   now progress concurrently, with one writer, eight queued control messages,
   bounded accumulators/duplex buffers, timeouts and cancellation of all halves.
   A constrained-buffer test fills the outbound direction while the peer sends
   an inbound frame without reading output. This proves the former deadlock
   condition independently of actual HCI credits. Linux/bluer still handle LE
   credits/MTUs. No application-level credit policy is invented.
3. **Unsupported bandwidth upgrades:** the old encrypted receiver path silently
   ignored offers and sent `SAFE_TO_CLOSE_PRIOR_CHANNEL` for a late LAST_WRITE
   without proving an installed replacement channel. Now an offer is answered
   with encrypted `UPGRADE_FAILURE` and its path info; unsolicited LAST_WRITE or
   SAFE_TO_CLOSE never causes a false handoff acknowledgement. No candidate IP
   is dialled. LAN upgrade remains disabled. Independent post-consent fixtures
   decrypt/verify the failure, then deliver the file over the same BLE framing.
   The physical capture does not establish that Samsung attempted BWU.
4. **Comparison UX:** serialization and the adapter already preserved the actual
   four-digit code, and Electron included it in `detail`. There is no proven
   source-level omission. The native dialog now also puts it prominently in the
   primary `message`, explains comparison/declining mismatches, and labels the
   Quick Share action “Codes match — accept files.” Decline remains the default.
   Missing/malformed Quick Share codes fail closed. There is no code-entry field.
   Real desktop/native rendering on the owner's Linux theme still needs review.
5. **Private failure discrimination:** closed, per-attempt stage/cause enums
   distinguish socket read/write/bridge failures, EOF, valid peer control-close,
   malformed frames, timeouts, consent-response queuing, authenticated file frames
   and BWU outcomes. Per-stage/cause events are deduplicated and counters bounded.
   A local response write is not a remote acknowledgement. Socket closure is not
   proof that a controller ACL disappeared. No raw errors, packet bytes, codes,
   endpoint addresses or credentials enter ordinary diagnostics.

Source comparisons (behavioral reference, not Samsung compatibility evidence):

- [Google Nearby 1bbe8ec](https://github.com/google/nearby/tree/1bbe8ec1eadd0c08d01db6b634254526141068e6):
  `connections/implementation/mediums/ble/ble_socket.cc` (`ReadPayloadLength`),
  `ble_packet.cc`, `bwu_manager.cc` (`OnBandwidthUpgradeNegotiationFrame`,
  `RunUpgradeFailedProtocol`, `ProcessLastWriteToPriorChannelEvent`).
- [open-quickshare fb9c8f9](https://github.com/ignotusbucius/open-quickshare/tree/fb9c8f9502e5313e3d788aa3498659773ef12d28):
  `core_lib/src/hdl/l2cap.rs`, `inbound.rs`; upstream assumptions were compared,
  not silently enabled. The active helper keeps unrelated experimental features off.
- bluer 0.17.4 `l2cap.rs`: stream writes truncate to negotiated MTU and permit
  legal partial writes; `write_all` handles segmentation. Kernel LE credits
  require physical testing; a TCP/duplex fixture is not an LE controller emulator.

## Advertising renewal: independent unresolved boundary

The valid compact/GATT service-data profile (17 bytes, conservative legacy
budget 24 bytes) and bounded unregister/retry policy are unchanged. Renewals stay
session-deferred. The private D-Bus renewal test now runs a complete independent
inbound encrypted 49-byte fixture before renewal, with delayed unregister,
registration errors and recovery **without adapter removal**. This validates
application ownership/order only, not the controller's completion.

BlueZ `org.bluez.Error.Failed` / controller-registration does not expose which
Linux MGMT branch produced `0x0d`. On Linux v7.2.8 and the inspected Omarchy
7.2.8-9 patches, correctly sized 0x0055 can fail at missing-instance or TLV
validation, or asynchronously later. The legacy path can produce `-EINVAL` from
`is_advertising_allowed` with residual LE links and unsupported role/state
combinations, or from a controller HCI Invalid Parameters status. The
connectable MGMT flag and AD Flags are different fields. The historical BlueZ
oversized-command bug is not established here. The previously successful 0x55
trace and this failure must be compared at the actual kernel/HCI boundary.

Smallest discriminating **manual, separately authorized** tracing, if renewal
still fails: repeat the owner's existing metadata-only kernel probes around
`add_ext_adv_data`, instance lookup/TLV validation, `add_ext_adv_data_sync`,
`hci_schedule_adv_instance_sync`, `is_advertising_allowed` and relevant HCI
completion statuses. Record only booleans, status codes, instance/role counts
and timestamps; no addresses or packet/key data. Compare idle renewal against
post-connection renewal, using the current HCI index. Do not package raw HCI,
full journals or crash dumps in the ordinary archive. Unregister ACK and
ActiveInstances=0 cannot distinguish these branches. No MGMT bypass, global
Bluetooth restart or package/firmware change is implemented.

## Automated validation scope

The normal Rust suite runs an independent Python/OpenSSL client through the
production BLE bootstrap, framing bridge, encrypted receiver, Engine serializer,
explicit test consent and private staging. It covers 49-byte, binary and empty
payloads; commitment/MAC/replay failures; decline; exact encrypted acceptance;
BWU rejection; finalization and byte hashes. TCP carries test bytes only.
Additional tests cover backpressure, fragmentation, clean/truncated EOF,
control close, categorized errors, deadlines, cancellation, bounded diagnostics,
actual sandboxed Electron dialog options, privacy, original physical timeline,
private D-Bus renewal/recovery, and the existing LAN regressions. No physical
Bluetooth device is required for CI. Vendor provenance is in MODIFICATIONS.md.

## Minimal owner retest on ordinary home LAN

Keep existing radio/system settings. Do this when an unexpected audio interruption
would be acceptable; the application cannot guarantee kernel/firmware stability.
Do not reset Bluetooth or restart WirePlumber. The lab only owns its own sessions.
If a headset drop, controller reset or repeated system error occurs, end the
capture and run `--stop`; do not keep retrying transfers.

From the existing checkout (save unrelated local changes first):

```bash
git fetch origin
git switch fix/quickshare-s24-post-consent-transfer
git pull --ff-only
npm ci
npm ci --prefix desktop
bash scripts/quickshare-android-lab.sh --preflight
bash scripts/quickshare-android-lab.sh --prepare --ble-native \
  --workspace "$PWD/.cache/s24-post-consent-01"
bash scripts/quickshare-android-lab.sh --diagnose \
  --direction samsung-to-linux --network ordinary --duration 180 \
  --workspace "$PWD/.cache/s24-post-consent-01" --archive
```

`--prepare` builds/verifies the helper/source provenance. Use the project's
existing Node 26 / Rust / protoc / D-Bus build prerequisites. ADB is optional;
append `--adb` only if you explicitly authorize USB debugging, unlock the phone
and accept this computer's prompt. No root, APK, tethering or permission change
is required. Do not enable HCI snoop for this first retest.

1. Keep Quick Share closed during the baseline. On Samsung share **only** the
   generated `lab-small.txt` (copy it to the phone separately if needed), using
   native Quick Share. Record whether/when `Airdrop S24 Lab` appears. Its
   appearance alone does not prove which discovery medium was used.
2. Select Linux. Record `selected` / `connect` markers when applicable. Compare
   the four-digit codes privately. If absent or different, decline, mark the
   result unknown/failed, and report that fact without the code itself.
3. If codes match, press “Codes match — accept files” on Linux. Record whether
   bytes progress 0→49, whether Samsung completes or errors, and whether the
   private lab Received directory contains exactly one 49-byte fixture.
4. Let the capture cross 90 seconds. Record whether renewed registration succeeds
   separately from phone visibility. A registration success is not RF proof.
5. Independently inspect the **received** file, not the source or a stale copy.
   The lab prints the private inbox path. Hash that file and the generated source:

```bash
sha256sum ".cache/s24-post-consent-01/fixtures/lab-small.txt"
# Substitute the actual private Received path printed by the lab:
wc -c -- "/actual/private/lab/inbox/lab-small.txt"
sha256sum -- "/actual/private/lab/inbox/lab-small.txt"
```

Both must be 49 bytes and SHA-256
`b753383d7fabdf101bb7ce2c3cb6261ed9960e5212ece3bfc3b103ccfe7efbd7`.
Use the existing fixture-only `--collect --case lab-small.txt` report checks:

```bash
bash scripts/quickshare-android-lab.sh --status \
  --workspace "$PWD/.cache/s24-post-consent-01"
bash scripts/quickshare-android-lab.sh --collect --archive --case lab-small.txt \
  --direction samsung-to-linux --workspace "$PWD/.cache/s24-post-consent-01"
bash scripts/quickshare-android-lab.sh --stop \
  --workspace "$PWD/.cache/s24-post-consent-01"
```

Return only the sanitized report archive path printed by the runner and explicit
UI observations. Do not enter `pass` to skip questions; use unknown/not-tested.
No automatic upload occurs. Reports contain only approved structured fields and
three allowlisted files; private native dialog code/options are never collected.

If transfer still fails, the decisive evidence is the first per-attempt session
failure stage/cause, whether `consent-response-written` and authenticated file
frames occurred, any BWU offer/failure, and the exact 0/49 or partial byte state.
Do not infer a root cause from nearby timestamps alone.

If renewal fails, run one further 130-second capture in a **new** workspace with
no recipient selected, then compare idle renewal with post-session renewal.
Record no-transfer baseline honestly. Defer hotspot or Apple-sharing comparisons.
Finally repeat the previously verified Linux-to-Samsung 49-byte LAN send in a
new lab workspace (`--direction linux-to-samsung`) and independently USB-readback
hash the phone's received fixture. Track controller stability, registration,
visibility, LE CoC, UKEY2/code comparison, consent, bytes, finalization and SHA-256
as independent outcomes.
