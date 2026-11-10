# Experimental native Android discovery and bootstrap

Status: implementation and protocol regression evidence; **no Galaxy S24+
connection or transfer has been demonstrated**. Development stack remains
PR #21 → PR #19 → main. The owner-tested baseline was `cb19e83`; its FE2C
registration and LAN advertisement did not establish Android discovery.

## Implementation map and inspected sources

The existing vendored core originates at open-quickshare
`fb9c8f9502e5313e3d788aa3498659773ef12d28`, also its current remote HEAD at
inspection. Its `blea.rs`, `gatt.rs`, `ble_client.rs`, `l2cap.rs`, `manager.rs`,
`migratable.rs` and relevant history (including `8342a40` discovery deduplication)
were compared with our disabled feature gates and modified secure session code.

Additional source inspection:

| Source / revision | Relevant implementation | Decision |
| --- | --- | --- |
| [open-quickshare](https://github.com/ignotusbucius/open-quickshare/tree/fb9c8f9502e5313e3d788aa3498659773ef12d28) | FEF3 headers/full advertisements, GATT slots/Weave, framed L2CAP commands | Reuse the pinned GPL Bloom/hash algorithm; adapt formats into bounded codecs. Leave its unbounded queues, radio power changes, name-based dialing and experimental network management disabled. |
| [rquickshare](https://github.com/Martichou/rquickshare/tree/378d8ae969941bee4bf60ad34ac9cf8bb7005eb7) | FE2C scanner/advertiser and original Nearby core | Confirms the original sender-interest path is insufficient for receiver bootstrap. Preserve existing secure sessions. |
| [Google Nearby](https://github.com/google/nearby/tree/1bbe8ec1eadd0c08d01db6b634254526141068e6) | `connections/implementation/{ble_advertisement,mediums/ble/*}`, `internal/weave/{packet,base_socket,sockets/*}`, `proto/mediums/ble_frames.proto` | Public header/Bloom, medium, command, Weave negotiation/counter and socket control grammar. Preserve the newly copied schema's Apache notice. Source inspection also covers the preceding `e71e92b` history. |
| [Bada](https://github.com/kyujin-cho/Bada/tree/d8973b57944a0b0571cb731df9b2d6a83b8ac5bd) | `BleGattAdvertisementReader`, `BleGattInitialControl{Client,Server}`, `WeaveFrames`, BLE advertiser/parser tests and Samsung research corrections | GATT-only recipients require a usable route without a PSM. Third-party Samsung reports are context, never evidence for our S24+ build. No Bada application code was copied. |
| [BlueZ](https://github.com/bluez/bluez/tree/77afa9ee44ed865ada65e1047f7fe4b0a7be375e) / bluer 0.17.4 | `LEAdvertisingManager1`, `GattManager1`, characteristic offsets/notifications, discovery lease and LE CoC APIs | Register actual services/sockets before advertising; hold scoped handles; bound operations; never power, pair, change policy, or disconnect an existing unrelated ACL. |

## Delivered path

`network/quickshare/src/ble/` is a separate wrapper implementation. It does not
enable `rqs_lib/experimental`, its hotspot code, network changes, or dormant
bandwidth-upgrade machinery.

- FEF3 connectable compact header, NearbySharing Bloom membership and advertisement
  hash, with slot 0 containing the full v2/socket-v2 advertisement.
- Capability-driven dual mode: when BlueZ reports 1M secondary-channel support
  and two available instances, register the extended full advertisement first,
  then a legacy header whose extended bit reflects actual registration. A
  rejected extended instance falls back to compact/GATT. If the compact instance
  fails, remove the other instance and report registration failure.
- No BR/EDR address or instant-connection blob is copied from a phone. A dynamic
  LE PSM is announced only after its listening socket exists. GATT registration
  precedes receiver advertising. Registration is not connection evidence.
- Slot reads honor ATT offsets. The write and indication characteristics negotiate
  Weave v1 at a conservative 20-byte packet size, validate counters and fragment
  order, and bridge Nearby frames to the existing inbound session. Local indications
  wait for ATT confirmation; clients accept both notification and indication
  characteristics. StartNotify replies promptly while an owned worker handles
  the session, avoiding a CCCD/setup deadlock. Socket
  introduction and per-message acknowledgements use Google's schema.
- LE CoC accepts public Nearby bare commands and Android's u32-framed command
  envelope. Advertisement queries and data-connection readiness are bounded;
  bare data carries the Nearby stream and the Android envelope carries
  service-hash socket messages. Outbound dialing tries the advertised PSM,
  then GATT if bootstrap fails; it never scans arbitrary ports or retries a
  consented transfer over a different route.
- FEF3 scanning decodes full advertisements or resolves compact headers through
  GATT slots. A decoded full peer without a usable transport remains visible
  with Send disabled. A GATT-only peer with the two socket characteristics is
  selectable without a LAN address or PSM.
- BlueZ cache replay is excluded from fresh observations. Recipients expire after
  35 seconds without fresh evidence, including an independent helper-side expiry
  if an event is dropped. Endpoint identity correlates address rotation and
  deduplicates LAN/BLE selector rows; LAN is preferred while available, with BLE
  retained as a fallback. Correlation grants no trust.
- BLE, LAN and the connection request share the ephemeral endpoint metadata.
  Existing TCP discovery/transfers and manual consent/publication remain in place.

The data path is BLE → bounded duplex → existing Nearby/UKEY2 session → encrypted,
consent-bound transfer. Connection acceptance, key establishment, verification
and file consent remain separate protocol events. Sender completion stays
`outcome-unknown` unless independently confirmed; no durable receipt is invented.

## Lifetime and resource limits

Application-owned limits: 100 target/header/attempt entries, at most 128 property watchers and a 1024-entry
BlueZ cache admission limit per scan window, four sessions and
four queued sends (thirty-second admission deadline), five tracked ACLs (including one resolver), 32 incoming GATT
packets of at most 20 bytes, eight outgoing packets, 64 KiB duplex buffers,
512-byte advertisements, 1 MiB Nearby BLE frames and bounded fragment assembly.
Frame prefixes survive select cancellation. Bad counters, interleaved messages,
foreign service hashes, malformed controls, excessive lengths and invalid LE
PSMs fail closed before allocation/forwarding.

D-Bus and packet-output operations have five-second bounds; bootstrap waits ten
seconds; fragment assembly ten seconds; idle sessions sixty seconds; total
sessions fifteen minutes. Advertising registrations have a 120-second controller
lifetime and are renewed every thirty seconds, including after connections
consume an advertising set. Scanning uses three-second windows with seven-second
pauses and yields during sessions/resolution. No simultaneous controller support
is presumed. Visibility withdraws advertisements and gates slot reads/new writes;
existing authenticated transfers remain consent-bound.

Pending sends have explicit cancellation tokens before their secure session subscribes;
adapter failures reject queued sends. Final encrypted frames drain through the bounded
transport before normal closure. Cancellation closes sockets, cancels GATT workers, aborts/join-drains owned tasks
and disconnects tracked ACLs opened by this helper. Adapter disappearance
withdraws runtime capabilities, expires BLE rows, and retries without powering
anything on. Electron never needs root. BlueZ and bluer also own their internal
D-Bus queues; these dependency internals are not a claim of a globally bounded
system daemon or a completed dependency security audit.

## Capabilities and evidence

`hello.capabilities` reports compiled `bleScanning`, `bleAdvertising`,
`gattBootstrap`, `l2cap`, `lanListening`, `lanUpgrade` and `directWireless` flags.
The opt-in `start.bleNative` controls actual startup. `bluetooth` events separately
report runtime registration, scanning/mode, local controller support, observed /
decoded / resolved / ready counts and fixed failure stages / selected connection methods. The lab allowlists
these fields and strips identities, keys, codes, packet bodies and file paths.

`bluetooth-preflight` reads controller support without registration or scanning.
It explicitly reports `registrationTested:false`. Runtime registration is a
separate observation, and an established Weave/CoC link still is not UKEY2 or
file-transfer success.

## Not implemented / hardware uncertainties

Authenticated BLE-to-LAN upgrade, Wi-Fi Direct/hotspot, BR/EDR/RFCOMM, persistent
trust, fast/background advertisements, socket-v1 peers, handshake extra-data and
alternate undocumented Samsung dialects are not implemented by this new path.
Unsupported formats fail closed. Direct LAN transfers remain available. Start
physical BLE tests with `lab-small.txt`; the slow BLE path has a finite lifetime.

No cloud controller is present. Controller emission, MTU/notification behavior,
address privacy/rotation, simultaneous radio activity, repeated real adapter
removal, stock S24+ discovery, authentication and transfer require owner testing.
The RTL8821CE / Realtek 0BDA:B00A / BlueZ 5.87 setup is unverified here. Earlier
school-network and hotspot failures do not establish a Samsung defect.

Automated evidence includes independent Python advertisement/Bloom/Weave wire
fixtures, bounded bridge and timeout tests, bare/framed command peers, actual
helper/D-Bus failure lifecycle tests, the existing independent Python/OpenSSL
UKEY2/adversarial/file tests and LAN/Electron regressions. Neither independent
wire fixtures nor two copies of this core establish stock-device compatibility.
