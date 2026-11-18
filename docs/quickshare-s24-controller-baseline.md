# S24+ native Quick Share evidence — 2026-11-15

**Original S24+ has four independently verified receipts, including two with active audio;
full reliability and root cause remain unresolved.** Earlier S24+ attempts failed
at 0/49; A13 subsequently transferred once, and the original SM-S926B now completed
twice. Both original-phone received copies match the fixture byte-for-byte.
No push, merge, release, firmware change or automatic consent occurred.

## Environment and reproducibility

Branch `fix/quickshare-s24-post-consent-transfer`, starting commit
`23431854ecdcd264e23774b041d18e5e812ce8ad`, with the uncommitted diagnostic changes
listed below. Omarchy 4.0.6, kernel `7.2.8-9-omarchy`, BlueZ `5.87-2`, Realtek USB
`0BDA:B00A` / RTL8821C, Hyprland 0.56.2, Electron 44.7.0. Loaded firmware reports
`0x75b8f098`. The installed firmware and the current
[official upstream binary](https://gitlab.com/kernel-firmware/linux-firmware/-/raw/main/rtl_bt/rtl8821c_fw.bin)
are byte-identical: 54,636 bytes, SHA-256
`dfe7ef772d078ec09490c02190a32fcd40b3eaf3b040049d8930eb80e6d5743c`.
This excludes an observed file-version difference, not a firmware defect.

Private evidence/checkpoints are in `.cache/codex-s24-goal/`; exact helper hashes,
compiler and source-tree digest are retained in `last-helper-provenance.json` and
each prepared lab marker. The owner independently rebooted the workstation before
the latest experiment; fresh-boot results are kept separate. Earlier tests used Wi-Fi tethering; for the second-phone comparison tethering
was off and the owner reported both devices on the home LAN. No network configuration was changed.

## Confirmed boundaries

1. **Advertising has a measured controller-role restriction.** The installed
   module's disassembly matches the
   [v7.2.8 kernel gate](https://github.com/gregkh/linux/blob/v7.2.8/net/bluetooth/hci_sync.c).
   In the earlier trace one peripheral LE connection existed, connectable
   advertising was requested, bit 38 was absent, and enable returned `-22` before
   advertising-disable. Phone Bluetooth off: two registrations and one 90-second
   renewal succeeded in a bounded 130-second test. This is registration evidence,
   not RF/discovery evidence.
2. **The fresh-boot blocker is a different existing LE role/peer.** Three live
   retries recorded `le_total=1`, `le_peripheral=0`, bit 35 absent and the same
   pre-disable `-22`. An ordinary, read-only `HCIGETCONNLIST` ioctl independently
   identifies the connected **Soundcore LE central** link, alongside an S24
   BR/EDR central link. No addresses or handles are exported. Therefore turning
   off the phone alone is not a demonstrated remedy for this boot. Soundcore was
   not disconnected. The fresh-boot lab had zero successful advertisements and
   zero incoming sessions, then was stopped.
3. **Actual transfer sessions lose the LE link.** A 120-second, 128-event bounded
   kernel trace observed three successful HCI disconnect completions with reason
   **0x08**, followed by LE-role-1 disconnect confirmation and L2CAP errno **110**.
   Linux maps this reason to `ETIMEDOUT`; BlueZ identifies it as
   [connection supervision timeout](https://github.com/bluez/bluez/blob/master/doc/btmon-connections.rst).
   At channel deletion, transmit credits were 65,499 / 65,519 / 65,499, receive
   credits 216, and queued PDUs zero. This is not observed LE CoC credit
   exhaustion; it does not rule out lower controller/HCI buffering, RF, coexistence
   or peer behavior. It does not identify which controller caused the loss.
4. **The timeout is not proven to depend on accepting files.** The owner reports
   errors after waiting a few seconds at matching codes. One captured attempt
   also fails before consent. Two earlier accepted sessions wrote consent at
   16:41:28.351 and 16:41:51.938 UTC, then received socket I/O timeout at
   16:41:31.134 and 16:41:57.336. These are shorter than the application's
   60-second deadline. No authenticated file-frame or finalization success exists.

The exact missing simultaneous-state requirements are:

| Existing LE role | Connectable advertising requires |
| --- | --- |
| Central | `le_states[4] & 0x08` (bit 35) **and** `[2] & 0x08` |
| Peripheral | `le_states[4] & 0x40` (bit 38) **and** `[2] & 0x20` |

Both apply if both roles exist. Neither connectable capability was reported by
this controller. The code does not override these bits, switch to a misleading
nonconnectable receiver, disconnect unowned links, or suppress registration errors.

## Changes and commands

- Explicit `--prepare --ble-native --receive-only` lab option: incoming
  advertisements/GATT/L2CAP remain enabled; outgoing BLE scanning and GATT
  resolution are disabled. Default discovery is unchanged. The marker records the
  mode and the native helper must acknowledge it; old helpers fail closed.
  Discovery occurred in this mode, but it **has not fixed the link timeout**.
- Lab UI now distinguishes **BlueZ receiver registration** from phone discovery.
- Validated bounded probes: `scripts/quickshare-controller-state.bt` and
  `scripts/quickshare-link-timeout.bt`. Only named scalar metadata is recorded;
  no payloads, keys, codes, peer addresses, handles or CIDs are printed.
- Offline closed interpretation: `scripts/quickshare-lab/controller-state.cjs`.
  Generic BlueZ Failed never proves a role conflict. Physical fixtures and
  regressions protect this distinction and prevent phone UI claims/matching codes
  from becoming false receipt or integrity success.
- `scripts/quickshare-lab/connected-links.py` uses the standard read-only HCI
  ioctl without root on this kernel. Device identities stay in memory; output
  contains only role/type and name-match booleans. It sends no HCI command.

Useful read-only commands (no physical success implied):

```sh
/usr/bin/python3 scripts/quickshare-lab/connected-links.py
node scripts/quickshare-lab/controller-state.cjs TRACE --legacy-controller
node --test tests/quickshare-controller-state.test.js tests/quickshare-connected-links.test.js
```

For a separately coordinated physical run, prepare a new private workspace;
check actual advertising registration before notifying the owner to send. Never
start another phone transfer solely because the helper or TCP listener is ready.
The source fixture is 49 bytes, SHA-256
`b753383d7fabdf101bb7ce2c3cb6261ed9960e5212ece3bfc3b103ccfe7efbd7`.
Hash an actual received file before claiming integrity.

## Validation and session safety

- Full Node suite after the metadata-session correction: **285 passed, zero failed, zero skipped**.
- Latest physical-timeout/deep-diagnostic suite: 39/39 passed; strengthened
  phone-status assertion and read-only ioctl privacy/ABI regression also pass.
- Rust native BLE + FastInit: **60 application + 23 library tests passed**; default
  build 16 + 23 passed. A private venv supplies Python cryptography through
  `PYTHONPATH`; no system package was installed.
- Sandboxed headless lab UI/consent and native process lifecycle tests passed.
  Formatting and the independent BLE wire oracle passed. Clippy completed with
  warnings. The general desktop OS clipboard case still fails under headless
  Ozone, and two private-LAN tests were skipped; the whole desktop suite is not
  claimed green.
- No Bluetooth/NetworkManager/desktop restart, adapter or USB reset, module change,
  firewall change or headset disconnection was performed by the agent.
- Temporary rules match only the actual source-app class `airdrop-desktop` and
  dedicated auth terminal `airdrop-s24-auth`: workspace 5 silent, floating, no
  initial focus, activation focus suppressed. Existing windows are never moved.
  An early launch received focus on workspace 5 before the actual Wayland class
  was identified; it was stopped and the rule corrected. One prematurely emitted
  ready notification was immediately corrected after an assertion failed. These
  incidents prevent claiming perfect isolation/communication throughout the run.
  Later actual window assignments and existing geometries were verified. Current
  owned apps are stopped and runtime rules disabled; no persistent config edited.

## Later controlled run and source correction

On resume, the ordinary read-only inventory showed both S24 and Soundcore on
BR/EDR, with no LE connection. No action by the agent changed the headset. In
fresh lab `s24-codex-br-headset-07`, initial registration succeeded with zero LE
links. The phone then initiated a peripheral LE connection: interval 24 (30 ms),
latency 0, supervision timeout 500 (5 s). The link remained connected well beyond
that timeout without a data session. The owner still did not see the recipient;
no incoming custom GATT read, L2CAP session or file receipt was observed. Kernel
re-enable attempts then failed with the phone's peripheral LE link/bit-38 gate.

A subsequent 120-second/128-event ATT probe successfully attached to RX/TX,
fixed CID 4, peripheral LE role only. It recorded no ATT operations while the
owner reported refreshing the recipient list. This does **not** prove a corrupt
phone cache or exclude EATT, cached state, timing or other discovery paths. Both
owned applications and tracers were stopped, and temporary rules disabled.

Re-reading pinned Google Nearby source confirmed raw header support, PSM byte
order and the slot-0 UUID. No encoding change was made on speculation. A separate
concrete lifecycle error was corrected: Google's
[`kRequestAdvertisementFinish` (command 2)](https://github.com/google/nearby/blob/1bbe8ec1eadd0c08d01db6b634254526141068e6/connections/implementation/mediums/ble/ble_l2cap_packet.h)
ends metadata discovery. A clean EOF afterward now returns `AdvertisementOnly`
and closes the owned socket without manufacturing a failed 0/0 file transfer.
A following data request on the same socket is still supported; partial subsequent
prefixes/bodies remain errors. The counter is accurately named
`l2cap_advertisement_session_closed`, not file completion. Independent raw/framed
fixtures exercise the production server and assert no transfer messages. This
fix has **not** established the cause or repair of the real 0/49-byte link loss.

## Second Samsung comparison: verified receipt

At 20:26 UTC, a second native Samsung sender completed a real BLE L2CAP transfer
in receiver-only lab `.cache/s24-codex-second-samsung-08`. Original S24+ Bluetooth
was off; initial inventory contained only Soundcore BR/EDR. Owner reported home
LAN and tethering off. The owner identified the second phone as Samsung Galaxy A13; explicit
matching-code confirmation for that trial remains pending; consent acceptance is recorded by the receiver.

The receiver recorded encrypted file data, verification at 49/49, and completion.
Independent disk readback of `lab-small.txt` is byte-for-byte equal to the fixture:
49 bytes, SHA-256 `b753383d7fabdf101bb7ce2c3cb6261ed9960e5212ece3bfc3b103ccfe7efbd7`.
Receipt and timeline snapshots are saved under `.cache/codex-s24-goal/` with
`second-samsung-08` prefixes. The bounded kernel trace completed exit 0. Unlike
prior S24+ failures, this transfer ended with remote disconnect reason 19 rather
than supervision timeout 8. These observations do not establish causation or
prove that the source correction caused this different phone to succeed.

Advertising renewal after 90.24 seconds failed with a peripheral LE link present;
the controller-role restriction therefore still affects this successful sender.
The collected report deliberately retains incomplete acceptance status. Its phone
provenance is corrected to second Samsung, model awaiting owner confirmation.

## Original S24+ on home LAN: failure reproduced

The same receiver implementation and fixture were tested again in
`.cache/s24-codex-home-s24-09`, with A13 Bluetooth off, home LAN, tethering off,
and an initial inventory containing only Soundcore BR/EDR. Owner confirmed
recipient visibility and matching codes. Explicit acceptance was recorded at
20:34:20.621 UTC, followed by consent-response-written at 20:34:20.624.
At 20:34:22.886 the socket failed with timeout; transfer ended at 0/49 and the
received directory was empty. The kernel reported HCI reason 8, with no observed
host disconnect request in this capture.

S24+ parameter updates were interval 24 / latency 0, then 12 / 1, 6 / 0,
12 / 1; supervision timeout remained 500 (5 seconds). Disconnect occurred
5.248 seconds after the last update. Three controller packets remained
outstanding (`sent=3`, `le_pending=5` (historical label: **five available HCI credits**, not five pending packets)). A13's successful connection ended with
interval 12 / latency 0 and no outstanding packets. These are discriminating
observations, not proof that latency 1 is invalid or the cause of the failure.
The installed kernel source updates these fields from controller completion
events; the trace does not establish which peer initiated every update.

At 90.24 seconds, advertisement renewal also failed while the peripheral LE
link existed. Later that connection closed with remote reason 19; the next
read-only inventory contained only Soundcore BR/EDR. The owner's missing-recipient
observation overlaps failed registration, but phone-cache behavior is unproven.

## A13 follow-up: connection failure before consent

The delayed-consent control in `.cache/s24-codex-a13-delay-10` did not reach a
verification code or acceptance. The owner saw the recipient, selected it,
waited approximately 15 seconds at connecting, then saw an error; after reopening
Quick Share the recipient was absent. Linux recorded no incoming custom GATT
read, no incoming L2CAP session and no consent/protocol event. The inbox was empty.
Initial advertising registration succeeded; renewal at 90.24 seconds failed.
Read-only inventory then showed an unidentified peripheral LE link and Soundcore
BR/EDR. No kernel trace ran for this attempt: do not attribute it to HCI reason 8
or treat the 10-second consent hypothesis as tested. The existing GATT server is
retained during a bounded ATT opcode/error-only observation. The owner refreshed
the list and waited approximately 20 seconds; the recipient remained absent.
No fixed-CID-4 ATT operations were observed in that interval. This does not
exclude EATT, timing or cached state and does not establish a phone-cache bug.

## Remaining work

Original S24+ receipt/hash verification and reliable renewal under documented
supported conditions remain pending. Next controlled experiment: A13 holds the matching-code prompt for 10 seconds
before explicit acceptance, with the same receiver and fixture. This checks
whether a consent wait longer than the 5-second supervision timeout reproduces
the failure on the successful control phone; it cannot alone establish a cause
on S24+. Further packet-completion/parameter tracing can then target the
remaining transport difference. Do not infer a cache, firmware or RF root cause from these
results. No headset disconnection, adapter reset or service restart was performed.

The owner has no second USB Bluetooth controller. The next available diagnostic
route is synchronized USB Android and Linux metadata, using the existing bounded
ADB collector. Host `adb` is installed, but no phone query has been performed.
The owner connected and authorized USB debugging on the original S24+; the
single physical USB transport was verified as SM-S926B, Android 17 / SDK 37.
Standard filtered history contained no recognized events; a bounded tag inventory
found Samsung NearbyMediums / NearbySharing entries. This shows a collector
visibility limit, not absence of phone activity. Supplemental history exports
only numeric timestamps/status and fixed tag/keyword enums, with raw messages
discarded. Bluetooth manager dumps exceeded the bounded read limit and were
not exported. No phone setting was changed. A synchronized new trial remains
pending phone preparation; previous failures are not diagnosed from generic
Nearby connection messages.

## Synchronized USB trial 11 and audio observation

With authorized S24+ USB, receiver-only lab `.cache/s24-codex-usb-11` again
reached UKEY2, introduction and explicit acceptance. All four accepted attempts
recorded in the app ended at 0/49, with no received file. The bounded Linux trace
covers only the first two accepted attempts; later attempts must not inherit a
kernel diagnosis from that ended capture. A separate attempt was declined.

For the first accepted attempt: awaiting acceptance 21:24:42.160 UTC, accepted
21:24:43.623, consent-response-written 21:24:43.627, socket timeout
21:24:47.752. Linux reported HCI reason 8; the S24+ BluetoothGatt log also
reported numeric status 8 at host receipt 21:24:47.758. This is a real peer-side
corroboration of link timeout, not a fabricated payload-integrity result.
The phone clock samples placed Android ahead by approximately 269–282 ms,
with 34–47 ms sample uncertainty. The phone collector stopped at its 1,024-record
bound at 21:24:51.675; no subsequent phone-log coverage is claimed.

Linux parameter sequence again ended at interval 12 / latency 1 / timeout 500,
then timed out after 5.264 seconds (first) and 5.998 seconds (second).
Deletion showed `sent=3`, `le_pending=5` (historical label: **five available HCI credits**, not five pending packets), and now `acl_pending=0` (historical label: **zero available ACL credits**).
The owner independently reported an approximately one-second headset audio gap
near acceptance, without headset disconnection or crash. This motivates testing
shared-controller scheduling, but does not prove queue exhaustion caused either
failure, nor establish the headset as the cause. No PipeWire/WirePlumber journal
underrun/error markers were found in the sampled window; this does not refute
an audible gap. USB runtime power was active at observation with policy auto;
no power setting was changed. Kernel vendor-event warnings (0xfc19) occurred
around discovery-side failures, not proof of an acceptance-triggered cause.

The owned receiver and tracers are stopped, scoped runtime rules disabled.
Next controlled condition: owner pauses computer audio while keeping the headset
connected, with USB/home Wi-Fi unchanged. This requires owner participation;
no playback, headset, adapter or Wi-Fi state is changed automatically.

## Original S24+ succeeds twice with computer audio paused

In `.cache/s24-codex-audio-paused-12`, the owner paused video while keeping the
Soundcore connected. BlueZ MediaTransport was independently observed as idle
before and after; initial and post-transfer link inventory contained Soundcore
BR/EDR and no LE connection. No headset, Wi-Fi or system service was changed by
the agent. Source/helper implementation was unchanged from the failed USB trial.

Two explicit approvals produced completed BLE L2CAP transfers at 21:42:02.330
and 21:42:36.193 UTC. `lab-small.txt` and `lab-small (1).txt` each contain 49 bytes,
independently equal to the fixture. Both SHA-256 values are
`b753383d7fabdf101bb7ce2c3cb6261ed9960e5212ece3bfc3b103ccfe7efbd7`.
`protocol_complete=2`, `encrypted_file_frame_received=2`. Independent readback
and sanitized app snapshots are retained with `s24-audio-paused-12` prefixes.
An earlier metadata/bootstrap attempt still generated a failed 0/0 event, so this
run does not establish a perfectly clean metadata lifecycle. Explicit owner
confirmation of matching codes for these two approvals remains pending.

One 90-second renewal also succeeded: two registrations, one cleanup/renewal,
zero advertising failures at snapshot time. This documents idle audio / no-LE
conditions, not reliable renewal with a persistent peripheral LE connection.
Generic phone keywords or Nearby numeric statuses must not be interpreted as
HCI errors without a typed event; no successful-link parameter value is claimed.

The fresh receiver is intentionally retained for an A/B/A comparison: owner
resumes video, verify active MediaTransport, then one transfer through the same
receiver. A pause-correlated success is strong motivation for this test, not a
confirmed scheduling/firmware root cause or a production fix.

## Same receiver, audio resumed: failure returns

The owner resumed video without restarting the receiver, changing GATT handles,
helper, USB, Wi-Fi or headset connection. BlueZ MediaTransport was independently
active both before and after. On the same lab-12 receiver, the new accepted
attempt reached consent-response-written at 21:48:28.251 UTC, then failed at
21:48:31.712 with 0/49. The phone BluetoothGatt status was 8 at host receipt
21:48:31.686. No third received file exists; both earlier successful copies remain
unchanged. Generic cumulative fixture readback from that workspace must **not**
be used to claim the resumed-audio attempt succeeded. A separate trial-13 summary
records the failed attempt and zero new receipts.

The owner again heard an approximately one-second audio gap near acceptance.
This strengthens the within-session association with active audio, but does not
identify controller scheduling, USB transport, RF coexistence, codec load or
another implementation detail as the root cause. A bounded scalar trace of
host-to-driver queues and controller packet completions is staged. Completion
counts are gated on the kernel Number Of Completed Packets handler, excluding
cleanup dequeues; they are buffer accounting, not file delivery or radio proof.
Capture starts with existing audio packets in flight, so naive queue-minus-
completion subtraction is not an absolute outstanding-packet measurement.

## Active-audio trial 15: success and failure in one capture

The automatic readiness notification was emitted at 22:01:55.669 UTC after BPF,
USB capture, receiver registration, workspace isolation and active audio checks.
The bounded 180-second/512-event flow trace attached 10 probes and ended exit 0.
The owner reported one connecting-without-consent attempt, one completed send,
and a following accepted send failing with the familiar audio gap.

Attempt 14 completed at 22:03:34.324. The third received copy,
`lab-small (2).txt`, is independently byte-for-byte equal to the 49-byte fixture
with the same SHA-256 as both earlier copies. Attempt 15 accepted at
22:03:55.246, wrote the consent response at 22:03:55.251 and failed at
22:04:00.232, 0/49; peer BluetoothGatt status 8 was received at 22:04:00.223.
Thus **active audio is not sufficient to cause failure**; paused audio is not a
proven fix. The successful link also used final interval 12 / latency 1, which
rules out treating that parameter alone as an unconditional failure trigger.

During successful transfer, ACL completion progressed at approximately 47
packets/s alongside LE completion. Before the failed transfer, the 121.006-second
sample recorded 20 ACL packets queued / 13 completed and 8 LE packets queued /
0 completed. At samples 122.006 through 125.006, all four deltas were zero.
At 126.006, progress resumed: ACL 40 queued / 47 completed, LE 3 / 8.
The minimum joint no-progress window is four seconds. The timeout at 125.240
reported LE sent 3, LE credits remaining 5 and ACL credits remaining 0.
These counters localize a common transport/completion stall; they do not
separate USB callbacks, controller firmware/RF scheduling or a blocked host event
worker. Both old receipts and the third receipt are retained; cumulative hash
success must not disguise the final failed attempt.

The receiver was stopped to avoid further unobserved retry/audio interruptions.
Next discriminator: bounded `btusb` completion counts/status and host HCI RX /
completion-handler duration, alongside the existing flow counters. Official
[Linux v7.2.8 btusb source](https://github.com/gregkh/linux/blob/v7.2.8/drivers/bluetooth/btusb.c)
was reviewed for callback signatures. No USB buffers, packet payloads, identities
or keys are read; the trace only observes status, counts and execution duration.

## USB/callback trial 16: one more verified receipt, intermittent failure

The owner reported six manual attempts with one apparent success. The app
recorded more internal bootstrap/retry attempts; those are not six additional
user sends. A fresh receipt `lab-small.txt` is independently byte-for-byte equal
to the 49-byte fixture, with the same SHA-256. Original S24+ receipt count is now
four: two while audio was idle and two while active, across retained labs.
The bounded kernel trace attached 15 probes, ran 180 seconds and ended exit 0;
phone collection began later at 22:13:32.144, so earlier app events lack peer-log
coverage. One early ready check ran before BLE registration finished and correctly
blocked sending. Readiness was subsequently verified and a corrected notification
sent; the app also recorded an explicitly declined early request.

During failed windows around trace seconds 67–69 and 119–120, USB TX/event/bulk RX
callback progress stopped along with HCI completion progress; all USB callback
error statuses remained zero. The maximum **completed** HCI RX-work duration in
this capture was 11.626 ms and packet-completion handler duration 1.467 ms.
No multi-second block of those measured handlers was observed. This narrows the
investigation but does not exclude another host path, a deferred USB request,
an outstanding URB or device/firmware/radio behavior. Successful transfer around
165–168 seconds showed simultaneous ACL and LE completion progress.

The receiver was stopped to prevent unobserved retries and audio interruptions.
The next trace adds actual USB submission vs deferred-path counts, tracked URB
completion latency, TX-work duration and a read-only controller buffer-capability
snapshot. Its new probes have not yet been hardware-compiled/verified. No firmware,
kernel module, power-management or global Bluetooth setting has been changed.
A shared-buffer RFC for a different TP-Link USB ID was reviewed, including the
maintainer's objection to inferring pool semantics from a working workaround;
it is not evidence that this RTL8821C uses a shared pool and was not applied.

## USB submission trial 17: real device-path backpressure

The owner reported six failed tries and one headset disconnect followed by
automatic reconnection, without a crash notification. The fresh lab-17 inbox is
empty. The receiver, tracers and test windows were stopped; runtime window rules
disabled. Further hardware retries are held to protect the active workstation.

The 180-second trace attached 21 probes and ended exit 0. Actual USB submissions
matched submit-or-defer calls; submit, send and USB callback error counts were
zero. Completed URB latencies reached 0.709566, 2.133969 and 2.335419 seconds in
failed windows, with pending tracked requests during the stall. Completed HCI TX
work duration stayed below 1.447 ms. This establishes delayed USB device-path
completion, not its firmware/USB/RF root cause. The map-based pending counter is
a diagnostic gauge, not an exact controller-credit calculation.

Read-only controller fields: ACL MTU 1021 with 8 packets; LE HCI MTU 27 with 8
packets; maximum LE TX data length 251, time 2120 us. Those values alone do not
prove shared-pool semantics or justify overriding the controller's report.
Wi-Fi was independently observed at 5500 MHz; a simple 2.4-GHz cochannel explanation
is therefore unsupported. The LE-only disconnect probe did not record the
headset's disconnect reason; the owner observation must not be misreported as a
captured USB reset. The sampled kernel journal had no reset/hardware-error marker.

Headset playback currently uses AAC (`a2dp-sink`); SBC (`a2dp-sink-sbc`) is available.
A concrete next comparison is a temporary per-card AAC-to-SBC change followed by
restoring AAC. This changes the owner's audio configuration and can briefly
interrupt playback, so it is awaiting explicit approval. No profile switch,
firmware change, module reload, Bluetooth restart or adapter reset has occurred.

## SBC comparison 18 and restoration

The owner explicitly approved a temporary AAC-to-SBC comparison followed by
restoring AAC. SBC profile and active BlueZ codec 0 were independently observed;
the Soundcore stayed connected at setup. The owner reported failure before a
phone code appeared. The app recorded early bootstrap interruptions, no accepted
consent and no file. A later 49-byte offer appeared while the result was being
inspected and was cancelled by owned receiver cleanup; that cancellation is not
an independently observed post-consent hardware failure. The phone recorded
BluetoothGatt status 8 during an early failure. Thus SBC did not prevent early
connection failure, but the post-consent SBC hypothesis remains untested.

The receiver was stopped before restoring the saved profile. Both PulseAudio's
`a2dp-sink` profile and active BlueZ codec 2 (AAC) were verified afterward. The
owned phone collector and temporary rules were stopped/disabled. A bounded
restoration guard provided a fallback deadline; it completed restoration normally.
No Bluetooth service restart, adapter reset or headset disconnection was requested
or executed by the agent.

## Additional confirmed reporting fix after hardware trials

The production incoming CoC task unconditionally emitted a disconnected file event
when bootstrap failed, even before a data-channel request. This fabricated 0/0
file interruptions for discovery/metadata failures. `receive_l2cap` now retains
connection diagnostics and returns the actual error while emitting a file-session
failure only after the peer requests a data channel. Bootstrap cancellation,
timeout, malformed raw/framed input and partial input are covered; a real data
failure still produces Disconnected. Independent encrypted peer fixtures now pass
through the actual incoming task wrapper. This does not repair USB backpressure
or claim a new successful phone test of the changed binary.

## First-send failure follow-up (T21 → T22)

T21 reached UKEY2 client finish and connection response at 23:50:47.965 UTC.
The socket failed with timed-out I/O at 23:50:53.111; phone GATT status 8
was contemporaneous. Advertisement renewal began later, at 23:50:57.163,
so it cannot explain that earlier failure. No malformed-frame or authentication
rejection was recorded. The second owner send completed with exact fixture bytes.

Corrected diagnostic labels: `hdev.le_cnt` and `hdev.acl_cnt` are **available**
HCI credits. Historic logs used misleading `le_pending` / `acl_pending` names;
raw archives remain unchanged. New traces use `*_credits_available`. Zero ACL
credits means no available slots, not an empty pending queue.

T22 adds bounded HCI ACL PB-flag/length totals and per-link USB completion
latency. Only the fixed HCI header is examined; handles are masked in memory
and no payloads or identities are exported. Root code generation passed and
21 probes attached. This is diagnostic work, not a confirmed transport fix.
