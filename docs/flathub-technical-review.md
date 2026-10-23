# Flathub draft technical review — 2026-10-24

Scope: the standalone `packaging/flathub-draft/` recipe, evaluated technically.
The AI-authorship issue is excluded from this assessment at the maintainer's
request. No PR, workflow dispatch, release publication or remote change was made.

`ÇÖZÜLDÜ` means the stated check has evidence of success; `ENGELLENDİ` means a
known requirement or environment limit blocks completion; `DOĞRULANAMADI` means
the required execution or reviewer decision has not been established. A passed
manifest linter does not establish inclusion-policy approval.

## Electron 44.7.0: source build remains blocked

The exact Electron release commit is
`61f55c4ce540416b3e43f75f6c0f125d22e5e908`. Its
[versioned DEPS](https://github.com/electron/electron/blob/v44.7.0/DEPS) selects
Chromium `152.0.7977.130` and embedded Node `v24.21.0`, applies Electron patches,
installs locked Yarn dependencies and invokes architecture-specific sysroot and
profiling-data hooks. Chromium's own DEPS adds more repositories and tool packages.
The [versioned release GN configuration](https://github.com/electron/electron/blob/v44.7.0/build/args/release.gn)
also references profiling inputs. These must all be pinned and fetched before
compilation, or replaced with a verified SDK-based configuration.

The official [Electron source-build documentation](https://www.electronjs.org/docs/latest/development/build-instructions-gn)
describes preparing the dependency graph with gclient and building with GN/Ninja.
An Electron source tarball by itself lacks Chromium and the complete dependency
graph. electron-builder/electron-packager package applications; they do not compile
Chromium/Electron. The [Electron BaseApp recipe](https://github.com/flathub/org.electronjs.Electron2.BaseApp/blob/branch/26.08/org.electronjs.Electron2.BaseApp.yml)
provides supporting libraries and Zypak, not an Electron executable.

The earlier source-build work on `codex/flathub-identity-preparation` was inspected
read-only. It is not merged or treated as a verified Flathub recipe. Its helper
has an online preparation phase and an offline SDK compilation phase, but no
successful pair of accepted Electron target builds is established here.

One concrete preparation issue was resolved: both upstream
[sysroot pins](https://github.com/electron/electron/blob/v44.7.0/script/sysroots.json)
were downloaded using the URL construction in Chromium's versioned installer and
verified against their actual SHA-256 values:

| Target | SHA-256 | Downloaded bytes |
| --- | --- | --- |
| x86_64 bullseye | `f2e052b0cdab9b6f9bfe311c5269264d5f4e38a018bbc27ba2314b73ac8f7053` | 19,731,156 |
| aarch64 bullseye | `f4f680a60e314418f95513ac63e9942ad565005ebbd36b660b20cd605d11a664` | 18,409,056 |

This verifies sysroot availability/integrity, not a complete source build.
[Chromium documents at least 100 GB of free disk](https://chromium.googlesource.com/chromium/src/+/main/docs/linux/build_instructions.md).
This worker has 33,770,192,896 bytes of **total** disk, an 8 GiB memory limit and
two CPU cores. Full Electron/Chromium compilation was not started under that disk
limit. No speculative GN commands or unverified source-build module were added.

**ENGELLENDİ:** the manifest still uses the two checksum-pinned official Electron
binary archives. Under Flathub's
[building-from-source requirement](https://docs.flathub.org/docs/for-app-authors/requirements#building-from-source),
an end-to-end verified offline source recipe is needed, or an explicit exception
for these bundled binaries. No exception has been granted. The general Flatpak
Electron packaging tutorial is not evidence of such an exception.

## Tailscale and host dependence

The managed Flatpak path starts dufs and the Node gateway inside its sandbox.
It does not call `tailscale`, install a VPN daemon, invoke the host installer or
configure a system/user service. dufs binds to `127.0.0.1:5000`; the gateway binds
to `127.0.0.1:6001`. The desktop's local file/clipboard work and local browser UI
use those loopback services. The existing real-dufs gateway test passes without
Tailscale, alongside all 77 Node tests.

However, the supported **cross-device** sharing path requires authenticated
Tailscale on the host, tailnet HTTPS and Tailscale Serve. The sandbox does not
expose its unauthenticated gateway to the LAN. Settings merely validates/saves a
`.ts.net` URL and does not detect the host VPN's state. This distinction is now
explicit in the store description, setup link and standalone README.

Local operation without Tailscale is established; removing the host dependency
from cross-device sharing is not. Under the
[host-dependent application rule](https://docs.flathub.org/docs/for-app-authors/requirements#host-dependent-applications),
whether the useful local scope suffices, or an exception is required because
cross-device sharing is core functionality, remains a reviewer decision.
**DOĞRULANAMADI:** inclusion-policy acceptance and real remote-device Tailscale
access. No exception or remote-device success is claimed. Bundling a VPN daemon,
adding host-spawn privileges or implementing a different authenticated transport
would be a significant architecture change and has not been done here.

## Independent repository layout: resolved

**ÇÖZÜLDÜ:** all local source includes resolve inside `packaging/flathub-draft/`.
The directory was copied to an unrelated location and parsed, linted and fetched
without access to sibling packaging inputs. Its 1,306 expanded source entries
contain real pins, not placeholder hashes.

The two generated dependency lists and `application-id.patch` are now local to
the draft. Five original packaging inputs are fetched from immutable upstream
commit `54382392a6897eda9629de7ba4a48926d0a774fd` with downloaded-byte-verified
SHA-256 values. `metadata.patch` applies without fuzz and reproduces the reviewed
desktop/metainfo files. Application code, helper scripts, copied metadata and
binary payloads are not checked into the standalone submission directory.

## Runtime and architecture evidence

The signed Flathub remote contains all five required 26.08 refs on **both**
x86_64 and aarch64: Platform, SDK, Electron BaseApp, node24 and rust-stable.
BaseApp metadata explicitly selects the matching Platform/SDK architecture and
26.08 branch. The external SDK Node executable is separate from Electron's
embedded Node. The app declares Node >=18 and its 77 tests pass on Node 24.19.0.

Both Electron archives were downloaded and checked by the builder. Their ELF64
headers identify x86_64 (`e_machine=62`) and AArch64 (`e_machine=183`) respectively.
These are architecture-input checks, not proof of an ARM64 application launch.
This x86_64 worker cannot establish native aarch64 execution.

The new read-only `Validate standalone Flathub draft` workflow stages only this
directory and defines separate native x86_64/aarch64 build, repository-lint,
installation, no-Tailscale backend, X11 and Wayland checks. Its shell/YAML syntax
was checked locally. It was not dispatched; configuring a job is not a passing
job result.

## Metadata and screenshots

**ÇÖZÜLDÜ:** the metadata patch adds professional English feature/setup text,
categories, keywords and a direct Tailscale setup link. The installed identity
remains consistent across manifest, desktop file, metainfo and 512×512 PNG icon.
The patched files pass official AppStream lint and desktop-file validation.

The screenshot URL is reachable and the v1.5.0 image exactly matches the existing
1080×840 repository PNG (SHA-256
`cc2653e95ae69fc2ee4a3037680a8c84257e2b0920807e32dc704a3fd469b10a`).
Its caption now describes the visible transfer screen. It predates the current
Files/Clipboard navigation and should be refreshed with an actual installed-app
capture published at an immutable upstream URL. No fabricated image or nonexistent
replacement URL was added. Interactive portal consent and physical-input desktop
integration still require real GNOME/KDE acceptance tests.

## Evidence locations

Local logs are under `.test-artifacts/flathub/` (ignored build/test artifacts).
They contain the standalone input receipt, both architecture source-download
logs, runtime ref metadata, ELF checks, sysroot checks, metadata lint, all 77 test
results and clean-build attempts. Normal build instructions are in the
[standalone README](../packaging/flathub-draft/README.md).

The first host-builder attempt reached the completed application assembly but
failed during debug stripping because `eu-strip` was missing. That log is retained
as `clean-build-x86_64-host-tools.txt`. Official Builder attempts exposed missing
session-helper activation and the cloud worker's nonstandard Flatpak installation
root; their logs are retained separately. These attempts are not reported as
successful builds. Missing host tooling was installed in the private tool prefix;
no manifest permission, checksum, TLS or Chromium sandbox check was relaxed.
