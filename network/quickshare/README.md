# Experimental Quick Share helper

This is an opt-in development component. It is not enabled, installed or shipped
by the application's current release pipeline. Android/Samsung/Windows physical
acceptance is pending. BLE and direct wireless are absent from the helper build;
the upstream `experimental` Cargo feature is not enabled.

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
