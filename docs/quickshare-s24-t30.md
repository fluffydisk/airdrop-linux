# T30 cross-layer diagnostic infrastructure

Status: **T30/T31 yielded three verified small receipts. T31B failed before
codes and reproduced brief audio interruptions. Reliability and audio remain
unresolved; no production root-cause fix claimed.**

Compiler warnings were emitted on stdout (62 warnings,186 filtered lines);
original collector warning flag inspected only stderr. Corrected reporting now
scans both channels and separates warnings, diagnostic errors and reported loss.
No reported capture loss, app loss0; aggregate counter offsets remain unresolved.
Running gap maxima are cumulative and must not be assigned to an individual phase.

Next diagnostic addition: `gatt-read`, `gatt-write`, `gatt-notify` callback events.
`a=0` means entry; `a=1` means callback outcome. Read success `b` is returned
length; write/notify success `b=0`. Negative results identify visibility(-1),
invalid offset/length(-2), write-lock(-3), missing write ingress(-4), ingress
backpressure(-5); notify uses permit(-1), lock(-2), occupied ingress(-3).
These are local callback outcomes, not proof of radio delivery. Entry write length
is numeric only; bytes/addresses/identifiers never enter these records.
Production radio and transport behavior remains unchanged.

## Baseline and research reconciliation

Both mandatory research documents were read completely: the 201-line final
technical synthesis and the 276-line root-cause report, in Downloads. Their SHA-256
and sizes are saved in `.cache/codex-s24-goal/t30/mandatory-reports.json`. The final
synthesis is primary; claims are checked against original T29 numeric evidence.
The research ZIP was extracted safely and every manifest entry verified.

**MEASURED:** before these changes, HEAD/branch remained
`23431854ecdcd264e23774b041d18e5e812ce8ad` /
`fix/quickshare-s24-post-consent-transfer`; all 31 normalized source-snapshot
comparisons and the exported tracked patch matched T29. Original helper SHA-256:
`4bcc21886ba36a7c09b5be1628417509d27ccf918a53fcba3f1e5c43514bf424`.
The previous helper is retained privately as `t30/t29-helper-reference`; no
uncommitted work was discarded. New fingerprints are in `implementation.json`.

**MEASURED:** running kernel/headers remain 7.2.8-9-omarchy; BlueZ5.87-2,
PipeWire1.6.9, WirePlumber0.5.18; btusb/btrtl/rtw88_8821ce loaded. Current Wi-Fi
frequency5500MHz. Selected Realtek USB PM reads auto/active/2000ms, unchanged.
Installed compressed firmware was decoded in RAM:54636 bytes, SHA-256
`dfe7ef772d078ec09490c02190a32fcd40b3eaf3b040049d8930eb80e6d5743c`.
These current readings do not establish T29's unmeasured Wi-Fi/PM history.

**MEASURED:** T29 relative58.036→71.036s:609 extra AVDTP calls, unchanged audio
HCI queue/completion, USB interrupt callbacks+9 and TX callbacks+4.
**SUPPORTED INFERENCE:** shared controller/HCI forward-progress loss is a high
priority. **UNVERIFIED HYPOTHESIS:** exact firmware, selective USB event delivery,
host credit accounting/scheduling or coexistence root cause. Nine later completions
are not proof of an eight-buffer-plus-one burst or exclusion of host defects.
49 bytes is file length, not a wire-frame length. Sender transmission/timeout
and causal ordering of receiver stop vsLEreason8 remain unproved.

## Implemented observation boundaries

- `scripts/quickshare-cross-layer.bt`: selected actual HCI index; reconstructed
  Realtek driver event header, HCI ingress, later event dispatch and NCP handler
  separately; reported numeric completion counts with unknown-handle coverage;
  HCI queue/dequeue and available credits; AVDTP calls **and returns**; actual
  USB submission/return, interrupt/bulk/TX callbacks and errors; pending URB ages
  (bulk IN/OUT separately); HCI worker runtimes, ingress-to-dispatch queue delay;
  numeric command/status and LE parameter/disconnect events.
- `rqs_lib::lab_trace`: opt-in **nonblocking** Unix datagram sink. At most10,000
  attempted ordinary records over180 seconds, plus one reserved owner-stop terminal
  record reporting cumulative loss; failed sends increment loss count and never
  wait or retry. No socket path, address, payload, code, name, key or file path is
  serialized. Without explicit environment opt-in, observation stays disabled.
- Actual native Classic socket is wrapped for read/write entry/return/latency,
  EOF, flush/shutdown and pending-on-drop metadata. No extra transport operation,
  sleep, pacing, timeout change, buffer policy, pairing or radio command is added.
- Inbound origin events: state/UKEY2 transitions, consent receive/response entry
  and stream write completion, validated frame length/body read, decrypted OfflineFrame
  class, payload type and actual file-body write. Local write success is not peer
  receipt. Owner stop begin/end and session cancel/end are timestamped separately.
- `scripts/quickshare-lab/cross-layer.py`: private owned-directory collector,
  closed-schema numeric records, bounded datagrams/line buffer/record count and
  duration, private socket permissions and ownership-aware socket cleanup. Collector
  receipt timestamps remain separate from producer-origin timestamps. Read-only
  anonymous connection-role counts, selected-device PM state and Wi-Fi frequency
  sampled every5s; names/addresses/SSID stay in RAM.
- `audio-timing.py`: graph-window start/end CLOCK_MONOTONIC anchors added; existing
  metadata-only graph/xrun reducer retained. No microphone or PCM recording.
- Lab supervisor forwards the trace socket only with explicit
  `AIRDROP_LAB_TRACE_SOCKET`, validated as an existing private owned socket inside
  a private non-symlink owned directory; raw arbitrary environment is not forwarded.

Kernel pointer/handle keys are RAM-only and every map is cleared before exit.
Only fixed HCI header/count fields are read, not data/encryption payloads. A
per-link packet count can include other traffic on the audio connection; the
AVDTP filter is a proxy. No event count proves RF or acoustic delivery.

## Clock and scope

Every new BPF timestamp explicitly uses `nsecs(monotonic)`. Rust uses
`clock_gettime(CLOCK_MONOTONIC)`; Python uses `monotonic_ns()`. Plain bpftrace
`nsecs` defaults to BOOTTIME according to the official documentation; it must not
be silently equated with userspace MONOTONIC after suspension.
Reference: https://bpftrace.org/docs/pre-release/stdlib#nsecs

BTF signatures from the actual loaded Bluetooth module are saved in
`t30/kernel-btf-functions.json`. Cached upstream7.2.8 source was reviewed together
with existing Omarchy backports; installed headers alone are not complete source.
`hci_sched_acl_pkt` was absent from parsed liveBTF, so there is no blind probe of
that name. Worker wake-to-run scheduling latency and exhaustive LE/scanning state
hooks remain follow-up boundaries if the current measurements leave ambiguity.
Live codegen and actual attachment are required before any hardware claim.

Example supported kernel invocation, **after signature/codegen validation**:

```sh
sudo bpftrace --mode codegen scripts/quickshare-cross-layer.bt ACTUAL_INDEX 30
sudo bpftrace -B line scripts/quickshare-cross-layer.bt ACTUAL_INDEX 30
```

Second argument is capture seconds1..180;180s hard backup bound remains. No
hardcoded hci0, kernel writes, controller reset, global scan stop or security
capability override is introduced.

Collector usage with an already private directory:

```sh
python scripts/quickshare-lab/cross-layer.py --directory PRIVATE_DIR --seconds 180
# Once collector-ready.json exists, launch only the isolated native lab:
AIRDROP_LAB_TRACE_SOCKET=/absolute/private/PRIVATE_DIR/app.sock \
  bash scripts/quickshare-android-lab.sh --start --workspace .cache/s24-codex-cross-30
```

Do not run this last example before the overhead/readiness gates and owner phone
availability. Actual GUI remains class-scoped workspace5 silent/no-initial-focus;
phone/Linux consent is manual. No automatic file request acceptance exists.

## Numeric application event interpretation

- `a/b`: event-specific numeric metadata, never IDs or verification codes.
- `read/write-enter`: requested capacity/length in `a`.
- `read/write-return`: elapsed nanoseconds in `a`; byte count in `b`, zero read
  means EOF, negative is OS errno (generic-1 if unavailable).
- `frame-header/body-read`: validated frame size; not a claim that a file body arrived.
- `payload-header`: protocol payload-type enum. `file-body-written`: actual bytes
  written by receiver; no private filename or file ID.
- `state`: current TransferState ordinal pinned by the source fingerprint:0Initial,
  1ReceivedConnectionRequest,2SentUkeyServerInit,3SentUkeyClientInit,
  4SentUkeyClientFinish,5SentPairedKeyEncryption,6ReceivedUkeyClientFinish,
  7SentConnectionResponse,8SentPairedKeyResult,9SentIntroduction,
  10ReceivedPairedKeyResult,11WaitingForUserConsent,12ReceivingFiles,
  13SendingFiles,14Disconnected,15Rejected,16Cancelled,17Finished,18Sent.
- `owner-stop`:0begin,1cleanupcomplete. Session-end:0success,-1innererror,-2deadline.
- `transport-drop`: pending read duration in `a`, pending write duration in `b`.
- `radio-stage` codes:1registered,2metadata-read label,3RFCOMMestablished,
  4RFCOMMfailed,5scan-startlabel,6scan-stoplabel;0other. Not every radio transition
  necessarily uses the generic phase path; do not infer absence from no marker.
- No public session ID is exported. This first T30 is intended for one physical
  file attempt; overlapping sessions must not be silently conflated.

## Validation and remaining gates

Completed before live tracing:

- Native Rust74 application +25 library tests pass, including independent
  encrypted peer, native Classic fixtures and the131s private-D-Bus lifecycle.
- Default Rust17 application +25 library tests pass.
- Node295/295 pass; focused diagnostic tests also exercise real bounded collector
  datagrams, socket cleanup, schema/privacy rejection, monotonic times and safe
  lab socket forwarding. Latest final run logs remain in`t30/`. The final loss-cap test additionally
  verifies that the terminal loss report survives the ordinary-record cap.
- New library tests cover full-sink nonblocking loss, fixed-schema/privacy and
  unchanged backpressure/byte/EOF/shutdown behavior. No mock is physical success.
- An initial library-only Cargo invocation lacked existing Tokio test-util feature
  unification; corrected workspace commands pass. No unrelated dependency patch.
- Formatting/whitespace checked. No new firmware/kernel/driver change installed.

**Pending:** user authenticates the isolated workspace5 sudo terminal. Then the
bounded preflight compiles probes and, only if compilation and active graph
baseline succeed, runs a30s no-phone trace with before/during PipeWire sampling
and tracer process resource measurement. Do not treat process CPU alone as total
BPF kernel overhead. Inspect output loss, attachment errors, graph deadlines,
packet-flow consistency and duration before declaring the infrastructure ready.
The phone test has not been requested or performed yet.

After the gate passes: prepare/recheck final source fingerprint, private trace
sink and kernel start, actual app telemetry start, active AAC and workspace5;
notify owner for one49-byte S24+ send and private matching-code check/acceptance.
Stop only owned receiver on sustained severe audio no-progress or transfer
failure; retain a bounded metadata postroll for recovery. No reset is a recovery
promise. T30 needs a new measurement; unchanged T29 retry is not useful.

## Interpretation, recovery and rollback

The reducer emits **signatures, not diagnoses**. No NCP at ingress leaves
controller/selective USB/reassembly hypotheses open. Raw event without dispatch
suggests an intervening host boundary. Handler without ACL dequeue may simply be
LE/unknown/disconnected-handle traffic. Independent per-CPU samples are not atomic
transactions. Capture resets, losses or missing samples invalidate exact claims.

Rollback of observations: unset `AIRDROP_LAB_TRACE_SOCKET` and
`AIRDROP_S24_LAB_TRACE_SOCKET`, stop only owned collector/tracer/session. No system
configuration was changed. To revert source, remove only T30-added observation
hunks/new files relative to the saved T29 baseline; **do not git reset/clean** the
existing dirty tree. Disabling telemetry does not change native protocol policy.

Existing owner-bound advertisement Timeout0 and retry behavior are unchanged.
Classic remains opt-in; small-SDU, TX-completion and FastInit experiments are off
in the prepared T30 baseline. No solution candidate is promoted as fixed.
Goal remains incomplete until repeated real files and preserved audio meet the
owner's acceptance target, including ten consecutive small transfers.

## T31B follow-up measurement

Owner confirmed normal audio also during T31 third connection failure. Healthy
audio is measured/reported for these runs; no audio root-cause fix is established.
Additional metadata uses existing hci_event_packet probe and installed hci.h
layouts: HCI Disconnection Complete status/reason and LE legacy/enhanced
Connection Complete status/role. Failed connection role is255 (unknown). Header
length checks precede fixed-offset reads; no handle/address/payload is exported.
These raw events cross-check l2cap_disconn_cfm rather than assuming the kernel
callback alone identifies an originating controller event. Live compilation
and baseline graph gates remain mandatory. Receiver deadline now warns at30s
remaining to prevent a late manual request from being mistaken for a failure.

## T31B result and T33 diagnostic follow-up

T31B owner reports4–5 brief audio cuts and no verification codes. Zero receipts
and zero RFCOMM arrivals. Metadata GATT read returned62bytes in14.09us. Later
GATT fallback accepted notification setup and49writes, decoded819-byte
ConnectionRequest, then did not reach authentication. Four raw disconnects
carry status0/reason8. Maximum observed audio HCI queue/completion gaps were
1757.624/1827.887ms. Three1s intervals show rawNCP, dispatch, accounting and USB
interrupt counters flat while AVDTP calls advance47 each and ACLcredits stay0.
These intervals precede the GATT protocol fallback. Detailed private sanitized
record: `.cache/codex-s24-goal/t31b/result.json`. No acoustic recording.

T33 adds timestamped >=100ms progress gaps (kind1 audio queue,2 audio completion,
3 rawNCP arrival); a gap is reported at resumption, not its beginning, and is
not automatically an audible dropout. Interrupt URB pending count/age and
submission/error counters distinguish tracked pending requests from missing
tracking, without claiming zero sparse samples prove a resubmit defect.
`command_send` now means command arrival at btusb_send_frame, with numeric
command_return status, replacing the zero-hit hci_send_cmd probe. Actual loaded
btusb FUNC/FUNC_PROTO was independently inspected and agrees with7.2.8 source.
BRconnection request/completion metadata exports only type/status, failed
completion type255 unknown. No peer address/handle/packet contents.

T33 adds one return probe (26total), requires fresh root codegen/live baseline
validation before a new physical run, and makes no production radio change.
Seven focused tests and full Node298 passed. USB controller/firmware versus
event delivery/resubmit/PM cause remains unproven. Root validation is pending
manual sudo in the workspace5 terminal; it does not launch the receiver.
