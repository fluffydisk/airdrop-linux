# Source-build and sandbox test infrastructure

These tools run in Codex Cloud and GitHub Actions. They do not create a Flathub
submission, change published release assets, move a tag, deploy Pages or use
production signing/store secrets. They are AI-assisted application build tools;
their provenance must not be omitted in a future human-led Flathub review.

## Pinned inputs

`packaging/source-runtimes.json` records Node 26.12.0's source archive SHA-256,
dufs 0.46.0's exact Git revision/archive/Cargo.lock hashes and Rust toolchain,
and Electron 44.7.0's exact Electron/Chromium/embedded-Node/depot_tools revisions.
The application's server/desktop lockfiles and `packaging/source-tools/package-lock.json`
pin npm inputs. The last lockfile contains build-only Browserify dependencies.

Preparation downloads and verifies source archives, vendors Cargo dependencies,
fetches Chromium's dependency graph and primes build-tool caches. Electron's
tool caches live under the preparation directory. Compilation runs with only
loopback, as the original unprivileged runner user. SDK builds use Flatpak's
network namespace; the host baseline launcher also enables no-new-privileges.
Node/Cargo/Yarn do not
receive an online fallback during their offline build/install phase.

Node and dufs are compiled natively on x86_64 and ARM64. Electron's ARM64 target
is cross-compiled on x86_64 because Chromium's pinned host-tool packages do not
include gperf for an ARM64 Linux host. The consumer workflow verifies ELF target
architecture and executes Electron's version check on the actual target runner.

The Electron source job checks disk and memory before fetching: its pinned
Chromium documentation requires at least 100 GB of free disk and 8 GB of RAM,
with more than 16 GB recommended. The implementation uses GiB for a conservative
capacity check. It removes only unused Android/.NET/Haskell SDKs on disposable
GitHub-hosted runners, never on a personal/cloud workstation. The workflow accepts
a configured larger GitHub-hosted runner label and a compiler job count; it does
not provision or purchase a runner.

## Workflows

1. **Source runtime builds** prepares and compiles Node and dufs for both
   architectures. Every successful output includes the original source hash,
   source-lock hash, architecture, version check, network-interface record and
   binary SHA-256. New builds also record compiler version and parallel job count.
2. **Source runtime builds in Flatpak SDK** compiles both native runtimes inside
   Freedesktop SDK 26.08 with signed Rust/node24 extensions, matching the test
   application's runtime ABI. Prefer these outputs for source application tests.
   The Rust pin controls online Cargo vendoring and host builds; SDK builds use
   the extension compiler and record its actual version and SDK commit.
3. **Electron source builds** accepts target `x64`, `arm64` or `both`. It fetches
   the exact source graph, generates the local build without remote execution,
   and compiles Electron inside the network-isolated SDK. Its artifact contains
   source-graph provenance and a checksum-verified tar archive preserving modes.
4. **Source-built application sandbox checks** accepts the native source-run ID
   and Electron run IDs for each architecture. It verifies artifact origin,
   version/source-lock/checksum/architecture records, prepares locked npm caches,
   and assembles the application's JS/HTML/CSS and source-built runtimes offline
   inside the same SDK. It rebuilds the browser ZIP library from JSZip's `lib/`
   sources, retaining input hashes and licenses. Unused Bare-runtime native
   addons are excluded; any unexpected npm native binary fails the assembly.
   It then checks backend upload/download/ZIP operations and installs a private
   Flatpak runtime fixture for desktop/clipboard/lifecycle/Wayland tests.
5. **Focused Flatpak runtime checks** can reuse a package validation run only if
   its installed application code matches the current checkout. This lets test
   harness changes be debugged without recompiling an unchanged application.

Use GitHub's Actions UI, or the already-authenticated CLI in the cloud environment:

```sh
gh workflow run source-sdk-runtimes.yml --ref main
gh workflow run electron-source-builds.yml --ref main -f target=both
# Substitute the successful producing run IDs below:
gh workflow run source-payload-checks.yml --ref main \
  -f native_run=NATIVE_RUN_ID \
  -f electron_x64_run=ELECTRON_X64_RUN_ID \
  -f electron_arm64_run=ELECTRON_ARM64_RUN_ID
```

No source build is considered verified just because its workflow was dispatched
or its preparation step passed. Both native runtime jobs, both Electron target
outputs and both source-application sandbox jobs must pass. A capacity failure,
download error, missing input, changed checksum, stale lock, wrong architecture,
missing isolated-build record or runtime launch failure is an error. Source
artifacts expire after three days; rerun the producer if an input has expired.

## What the runtime fixture does and does not prove

The source-application sandbox job deliberately uses the existing AI-assisted,
local-only runtime fixture. It tests that the compiled application works inside
Flatpak; it is not a human-authored Flathub source-build manifest. Production
channel generation does not emit a Flatpak manifest. Do not submit the local
fixture or copy it into a proposed submission.

The human-authored recipe must independently declare its source/dependency inputs
and supported SDK/runtime choices, and must itself pass Flathub's offline builder
and linter. Online preparation commands are not permitted in a Flatpak build
phase. Passing a host source build plus a sandbox runtime test does not certify
that a future SDK-based manifest builds successfully or meets store acceptance.

X11 tests exercise an actual clipboard round trip. The Wayland harness uses a
software Weston compositor nested in a virtual X server to provide a virtual
keyboard/pointer seat. The app has DISPLAY removed and explicitly selects
Wayland, so the app cannot silently switch to X11. Interactive portal consent,
physical-input Wayland clipboard use and host Tailscale access remain separate
desktop acceptance checks; fixture responses do not establish those outcomes.

See [technical readiness](flathub-readiness.md) and the
[human maintainer learning path](flathub-first-steps.md).
