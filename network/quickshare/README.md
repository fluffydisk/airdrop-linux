# Experimental Quick Share helper

This is an opt-in development component. It is not enabled, installed or shipped
by the application's current release pipeline. Android/Samsung/Windows physical
acceptance is pending. The default helper is LAN-only. BLE receiver bootstrap
and direct wireless are absent; the upstream `experimental` feature is not enabled.
An optional separate FE2C sender-nudge experiment is described below.

The active execution record is `docs/quickshare-production-plan.md`; the stock
device procedure is `docs/quickshare-android-lab.md`. Minimum BLE bootstrap is
required before broad stable Android support; current LAN-only operation is a
development capability, not a supported Android product claim.

Runtime packagers exclude the entire `network/quickshare` and
`.cache/quickshare` trees, including untracked build outputs. They reject a helper
binary copied into another runtime directory. The complete experimental source
and its GPL license remain available in this repository's source archive.

The application remains Node/Electron. The helper owns Quick Share's native wire
protocol and communicates using version-1 JSON Lines over inherited pipes.
There is no local control HTTP server, account login or name-based auto-accept.
The Node adapter verifies the helper SHA-256 before starting it.

## Build and test

Install the Rust version in `rust-toolchain.toml`, a C compiler, pkg-config and
protobuf-compiler using your normal development environment. ARM64 also needs
the build inputs required by the vendored D-Bus dependency.

```sh
cd network/quickshare
cargo test --workspace --locked
cargo build --locked
cargo fmt --all --check
```

`hello` reports the IPC version and capabilities without starting a listener.
`start` takes an absolute private `staging` directory, `name`, and optional `port`
(default 53319). `snapshot`, `send`, `respond` and `cancel` operate on discovered
endpoints and individual transfers. EOF stops the engine. Commands are limited
to 64 KiB. Responses/events carry no persistent identity assertion. The adapter
must require fresh code comparison and consent for every incoming transfer.

Only regular file batches (1–100 files, at most 64 GiB) are supported. Reception
uses a random per-transfer private directory, exclusive no-follow file creation,
declared-size checks and a complete-file barrier. The Node adapter publishes
only completed files into the inbox and never labels Quick Share as resumable
or SHA-256-verified by an Android receiver.

Outgoing all-bytes-sent now reports `outcome-unknown`: local writes and even a
clean peer close do not prove durable receipt. Late malformed frames and payload
error/cancellation fail finalization. Stable release remains blocked until real
peer outcome handling is independently validated. Incoming `complete` remains
conditional on fresh consent and successful local verification/publication.

Development `helper.json` records the original upstream pin separately from the
modified source-tree/lock hashes, application commit/dirty state and compiler.
This is not a completed release provenance/signing or corresponding-source system.

## Licensing and provenance

`vendor/rqs_lib` is copied from **only** `core_lib/src`, `Cargo.toml` and
`build.rs` at `ignotusbucius/open-quickshare` commit
`fb9c8f9502e5313e3d788aa3498659773ef12d28`, plus its root GPLv3 license.
`upstream-files.sha256` records the original inputs before modifications.
The upstream Tauri application (whose manifest declares AGPL-3.0), Vue frontend,
settings and name-based trusted-device implementation are excluded.

The upstream repository root licenses this core under GPLv3. This component and
the new Rust wrapper are distributed as GPL-3.0-only, preserving all embedded
third-party notices (including Apache-2.0 protocol schema notices). The separate
Node adapter is original application code under the project's MIT license.
IPC separation is not treated as an exemption from copyleft requirements.

Before distributing a native-helper edition, provide complete corresponding
source and necessary build/install material for the covered components and any
combined work, dependency notices/SBOM and exact source/binary provenance.
Do not label that edition MIT-only. Existing application packages do not yet
contain the helper. No distribution-license conclusion is inferred for the
excluded AGPL frontend.

## Local core changes

- Pinned Git dependencies and disabled default wireless features.
- Safe file names, bounded manifests/sizes and unique per-transfer staging.
- No-follow/exclusive receive creation, no file writes before acceptance, and
  rejection of early final chunks before the declared byte count is received.
- No-follow source opens; on-link discovery restriction, finite probes and
  exit on a closed discovery channel.
- Bounded incoming connections with unique request IDs and inactivity timeout.
- Normal helper output contains only JSON IPC; upstream logging is unregistered.
- Constant-time MAC verification before parsing/decryption, strict CBC dimensions
  and PKCS#7 padding; RFC 4231 and NIST SP 800-38A fixtures plus malformed inputs.
- Anonymous Android mDNS metadata is discoverable without granting trust; select
  an on-link address when advertisements include multiple interfaces.
- Empty-file final frames and bounded source reads; fail a transfer if a source
  is truncated instead of looping indefinitely.
- Consent manifests cannot change paths/count/total before publication. Completed,
  cancelled and abandoned staging is removed within the owned private root;
  cleanup never follows symlinks. Terminal history rolls over at 100 records.
- Progress snapshots coalesce while disk writes run; pending work is bounded by
  transfer count instead of growing once per received progress event.

The fork is not yet a security-certified implementation. Physical interop,
independent cryptographic fixtures/fuzzing, comprehensive
crash/resource testing and stable-release packaging remain explicit gates in
`docs/cross-platform-implementation.md`. Do not enable this in stable builds.

## Application development integration

From the repository root, run `node scripts/build-quickshare.js` with Cargo/protoc
available, then `npm run prepare-desktop`. Start the development desktop with
`AIRDROP_EXPERIMENTAL_QUICK_SHARE=1`. The app uses only the hash-matched helper
from `.cache/quickshare/<arch>`; normal releases do not include that directory.
Quick Share recipients appear in the existing picker, acceptance compares a
fresh code, and helper failure preserves the Linux/browser routes. This opt-in
path is for physical acceptance work, not a supported Android release.

`tests/quickshare-protocol.cjs` additionally runs two compiled helpers in separate
network namespaces on disposable CI VMs, comparing codes and transferred hashes
in both directions. Both ends use this implementation: success is protocol
regression evidence and must never be presented as Android interoperability.

`tests/quickshare-independent.py` is a separately written Python client using
OpenSSL-backed cryptography and test-only protobuf framing, not the Rust core.
With `python3-cryptography` installed, run it with the same
`AIRDROP_TEST_QUICKSHARE_HELPER` environment variable. It verifies UKEY2/code and
directional keys, bad commitment/MAC/replay rejection, declined consent and
empty/binary Unicode reception with independent hashes. It does not validate
Android, BLE, the independent receiver role or Node publication. Its explicit
fixture consent never changes production receiving defaults.

For the owner's real Galaxy S24+, use `scripts/quickshare-android-lab.sh` and
`docs/quickshare-s24-test.md`. The optional wrapper `ble-fastinit` feature
(`node scripts/build-quickshare.js --ble-fastinit`, or lab prepare with that flag)
adds only a bounded 120-second FE2C sender advertisement after explicit runtime
request. It never powers a controller, scans or enables upstream wireless code.
BlueZ failures are classified without raw device data and preserve LAN operation.
Full FEF3/GATT/weave receiver bootstrap and authenticated LAN upgrade are pending.
Default IPC is unchanged; named metadata-free protocol diagnostics are an
explicit `protocolDiagnostics` start capability used by the lab only. They do
not create transfer/consent state and never carry keys, codes or endpoint data.
