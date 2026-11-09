# 1.8 implementation and acceptance record

Baseline: main `553406a36117fe64b244fcfadcd2b37180d91e9d`, public stable v1.7.0, open draft PR #1 unrelated to this work. Existing workspace, guest QR, provider, path-validation, update and package workflows were inspected before changes.

Selected sequence: add a native identity/discovery module; persist file-transfer-only trust separately from temporary browser/guest grants; implement a durable receiver journal and direct per-file send/accept workflow; expose this in the current desktop; validate recovery and existing features; release 1.8 through existing checks/signing/publication infrastructure. Preserve the existing architecture and mobile QR fallback. No proprietary AirDrop compatibility or native browser discovery is claimed.

Acceptance criteria: real multicast discovery between independent instances; pairing with code comparison; saved identity/trust and changed-port recovery; targeted direct send with receiver accept/decline; no file published before final hash verification; verified-chunk retry across sender/receiver restart; cancellation; duplicate/Unicode/empty and >100 MiB files; bounded concurrency; explicit permission/revocation; retained workspace/CLI/browser functionality; source-matched release validation.

Implemented modules: `lib/nearby.js` owns DNS-SD hints, identity-pinned mutual TLS, scoped trust, liveness, transport requests and outgoing journals. `lib/peer-store.js` owns receiver manifests, durable chunks, resume verification and atomic whole-file publication. Desktop IPC keeps file selection authorization and renderer sandboxing. Existing Devices/ShareGateway/provider code stays intact. Native/CLI ZIP creation uses archiver streams through validated descriptors.

Local evidence (Node 26.12.0, umask 022): full pre-release Node suite 166/166 before four additional coverage cases; expanded nearby/UI tests 10/10; Chromium workspace 1/1; mobile viewport acceptance 1/1 (both iPhone and Android profiles); existing Electron workspace 1 passed, 1 tray case skipped because no StatusNotifier watcher; new sandboxed Electron nearby E2E 1/1. Full final counts and CI/publication links are recorded in the final release report. Disk-space shortage uses injected statfs results, not an actual full physical disk.

Large-file integration measurement: 105,906,185 bytes, 1,906 ms on the same cloud host, including full verification. This is not a physical-network benchmark or a claimed speed improvement.

Deferred: IPv6-only/native mobile discovery; folder manifests (existing folder workspace/download retained); clipboard autosync; cross-network native peer transport switching; physical iOS/Android and physical Wi-Fi/hardware testing. Existing browser QR pairing remains session-scoped and separate from native trusted devices.
