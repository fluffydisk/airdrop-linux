# S24+ transfer and intermittent audio: T27 / T28

Status: transfer verified once through the experimental native Classic carrier;
intermittent headphone audio remains unresolved. This is not goal completion.
Measurements started November 16, 2026 UTC (November 17 local Europe/Berlin).

## Actual file verification

T27 used Galaxy S24+ native Quick Share and the receiver's real RFCOMM socket
(`bt-rfcomm`), with explicit Linux consent. The received `lab-small.txt` is exactly
49 bytes and byte-for-byte equal to the lab fixture. SHA-256:

`b753383d7fabdf101bb7ce2c3cb6261ed9960e5212ece3bfc3b103ccfe7efbd7`

The owner reported apparent phone success and intermittent approximately 100 ms
audio interruptions since opening the app, rather than the previous full-second
silence. The owner explicitly confirmed matching codes for this attempt and normal audio
after receiver closure. Codes are not included in reports. This before/after
observation supports investigating a receiver-related effect, but does not alone
establish causality or the responsible layer.

The test observer subsequently stopped the receiver because it looked for the
receipt in the pre-start session directory. Starting rotates that session ID.
The observer now reads the current session marker. This controlled stop was not
an application crash. Disk verification used the actual current session.

## Objective host timing measurements

PipeWire 1.6.9, active Bluetooth output, 512-frame / 48 kHz graph. Each phase
collected 2,000 driver cycles, approximately 21.5 seconds. Same user session;
playback was not controlled by the collector, so identical content and user
activity are not guaranteed. No transfer was requested during T28. The on-state sample began after startup
and does not cover every startup instant or a transfer/consent event.

| Phase | New driver xruns | Graph deadline misses | Longest driver interval | Longest wake delay |
| --- | ---: | ---: | ---: | ---: |
| Receiver off, baseline | 0 | 0 | 12.006 ms | 3.071 ms |
| Receiver on, native Classic + BLE advertisement + GUI | 0 | 0 | 12.025 ms | 1.733 ms |
| Receiver off, repeat | 0 | 0 | 13.321 ms | 4.273 ms |

Followers also had no new xruns or measured deadline misses. No sampled driver
interval reached 40 ms. The driver's pre-existing error count was four before
these samples and remained four; it must not be attributed to T27.

**This does not disprove audible interruptions.** Host graph timing cannot establish
Bluetooth packet delivery, decoder continuity, or acoustic headphone output.
The short observation may also miss an intermittent event. No causal attribution
to the receiver or to a specific controller defect is established by T28.

The lab GUI stayed on workspace 5 in all 42 observer samples. Rules were disabled
after closing the owned receiver. No Bluetooth service restart, adapter reset,
headphone disconnection, audio profile change or microphone capture occurred.

## Repeatable collection

With exactly one active Bluetooth output and JSON-capable `pw-profiler`:

```sh
python scripts/quickshare-lab/audio-timing.py --phase receiver-off --samples 2000 > off.json
# Start only the isolated lab receiver, retaining the same audio conditions.
python scripts/quickshare-lab/audio-timing.py --phase receiver-on --samples 2000 > on.json
# Stop the owned lab receiver.
python scripts/quickshare-lab/audio-timing.py --phase receiver-off-repeat --samples 2000 > off-repeat.json
node --test tests/quickshare-audio-timing.test.js
```

Commands collect timing metadata only. Raw node names and profiler JSON stay in
memory; the report omits identities, addresses, titles and audio content. Collection
is bounded by 65 seconds; a missing driver, subprocess failure or malformed output
produces an error, not a success report. Counter resets invalidate the xrun delta.
The reducer regression covers graph selection, error deltas, counter resets,
100 ms gaps, deadline misses, missing samples and private-field exclusion.

Private evidence: `.cache/codex-s24-goal/audio-28-{baseline,on,off-repeat}.json`,
`audio-28-aba-state.json`, and `classic-27-result.json`.

## Next discriminating test

Use a longer, controlled playback while alternating receiver off/on/off, including
an owner-marked audible event. Correlate PipeWire timing with bounded metadata-only
A2DP send, HCI completion and USB completion timing. These packet timing indicators
remain proxies; controller completion is buffer accounting, not acoustic delivery.
Kernel tracing requires interactive privilege authentication in the isolated
workspace, not a service reset.

To measure the audible symptom directly, play a known continuous test signal and
record a headphone earpiece with an independent microphone, then measure amplitude
gaps against the reference. This requires physical placement and explicit user
participation. Do not record private music, conversations or ambient sound by
default. Report duration, dropout count/minute, maximum dropout duration, test
condition and detection threshold, with an off-state control recording.

Sources: [PipeWire pw-top](https://docs.pipewire.org/page_man_pw-top_1.html),
[PipeWire pw-profiler](https://docs.pipewire.org/page_man_pw-profiler_1.html).

Automated verification after this tool: 291/291 Node tests passed with a 30-second
per-test bound. The initial unbounded full run hung in unchanged devices tests;
the owned child was stopped, an isolated bounded run passed 10/10, then the full
bounded rerun passed. No unrelated application change was made for that flake.
A real 100-cycle metadata collector smoke check also passed.

A 30-second 750 Hz mono reference with gentle endpoint ramps is prepared locally
(`.cache/codex-s24-goal/audio-reference-28.wav`), but has not been played. Acoustic
recording is awaiting owner participation; no microphone was accessed.

## T29: actual transfer with metadata-only audio tracing

The owner requested another real transfer without recording audio. Native receiver
`Airdrop S24 T29` used the same prepared Classic carrier. Music/AAC transport was
sampled active throughout the receiver run. A 180-second metadata-only kernel
trace attached 26 probes and exited normally. AVDTP sends (PSM 25, length >=100)
identify the audio connection in memory; subsequent HCI queue/completion events
are correlated to it without exporting addresses, handles or pointers. These are
packet-flow measurements, not acoustic recordings.

Actual desktop events, November 16 UTC:

- 23:53:24.127: receiver ready, unique application class on workspace 5.
- 23:54:03.026: real `bt-rfcomm` connection.
- 23:54:03.534: 49-byte offer awaiting acceptance.
- 23:54:06.605: accepted, receiving.
- 23:54:11.785: interrupted at **0/49 bytes**; no successful file receipt.
- 23:54:13.814: bounded observer stopped the owned receiver after failure.

The owner independently reported approximately ten seconds of silence during the
failed transfer, plus recurrent brief interruptions while the receiver ran.

| Observation window | Maximum AVDTP send gap | Maximum audio HCI queue gap | Maximum audio HCI completion gap |
| --- | ---: | ---: | ---: |
| Initial off control, trace seconds 1–10 | 22.489 ms | 22.630 ms | 38.090 ms |
| Receiver open, before manual send, seconds 22–50 | 24.099 ms | 50.103 ms | 67.058 ms |
| Failed transfer, seconds 53–74 | 23.726 ms | **13,923.086 ms** | **13,923.087 ms** |
| Recovered/off, seconds 76–115 | 23.069 ms | 23.072 ms | 48.125 ms |

Windows are kernel-relative and deliberately avoid uncertain phase boundaries;
absolute desktop event times are separate. There are 179 valid audio-flow rows
in the bounded capture. Compiler-warning source excerpts are excluded by requiring
an actual numeric `ms=` record prefix.

This is objective evidence of a long Bluetooth audio transport stall concurrent
with the failed transfer and the owner's audible-silence report. During that
window AVDTP generation continued without a >=40 ms gap, while HCI audio queue
and controller completion stopped for 13.92 seconds. Smaller queue/completion
gaps also occurred with the receiver open. **Those smaller gaps cannot individually
be counted as audible dropouts:** controller completion notifications may be
batched and headphone buffering/actual radio delivery are not observed.

The same trace records an LE disconnection with reason 8 at relative 70.990 s and
zero available ACL credits. Both USB send/submission error totals and USB callback
error totals were zero. This localizes a visible stall below steady AVDTP
production, but does not distinguish controller firmware, radio coexistence,
credit/accounting behavior or every host scheduling cause. In particular, switching
the file carrier to Classic did not eliminate the failure while an LE discovery
connection was present. Do not promote Classic as a proven reliability fix.

PipeWire remained deceptively clean: baseline 1,000 cycles, two rolling 4,000-cycle
windows (including consent/failure), and off-repeat 1,000 cycles all had zero new
driver/follower xruns and zero measured deadline misses. Maximum driver intervals
were 11.822 / 11.644 / 13.035 / 11.050 ms respectively. A clean PipeWire graph alone
therefore cannot establish uninterrupted Bluetooth headphone delivery here.

After the measured off-repeat, the still-running bounded trace later saw AVDTP
production gaps up to 2.005 s (starting around relative second 142). Playback
conditions were no longer guarded then, and the PipeWire collector had completed.
These late gaps are retained in evidence but are not attributed to the receiver.

All 49 receiver window samples were on workspace 5. The dedicated sudo terminal
also stayed on workspace 5; initial launch did not change the active workspace.
Both owned GUI windows are now closed and scoped runtime rules disabled. No
microphone/audio capture, reset, service restart, forced disconnect, profile
change or automatic consent occurred. Initial trace compilation failed before
radio testing due a BTF duplicate-name resolution issue; actual module BTF and
matching installed headers verified `l2cap_conn.hcon` at offset 0 before the
corrected explicit prefix compiled and ran.

Evidence: `.cache/codex-s24-goal/audio-29-result.json`, `audio-29-kernel.log`,
`audio-29-{baseline,window-0,window-1,off-repeat}.json`, `audio-29-state.json`.
No application implementation changed during T29. The previous 291-test result
still applies; this experiment's new validation is real probe compilation,
attachment, bounded runtime completion and the physical failed transfer.

**Outcome: failed transfer and independently observed long audio transport stall;
reported short audible cuts remain only partially characterized. Goal incomplete.**
