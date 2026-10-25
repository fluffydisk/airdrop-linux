# Flathub draft technical review — 2026-10-25

This is the preserved audit before the connection-status reference update.
[The current reference report](flatpak-reference.md) records the later patch,
repeatable validation helper and new successful/failed attempts. Results below
remain historical evidence and are not silently replaced.

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
The actual installed sandbox reports Node v24.21.0, app 1.5.0, dufs 0.46.0 and
x64 architecture; no Tailscale CLI or daemon socket is present there.

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
Files/Clipboard navigation. A real X11 capture of the installed package is now
prepared at `assets/airdrop-flatpak-desktop.png` (79,225 bytes). It has not been
published, so the reachable immutable old URL is retained until the maintainer
authorizes publication and an actual replacement URL can be pinned. No fabricated
image or nonexistent replacement URL was added. Interactive portal consent and
physical-input desktop integration still require real GNOME/KDE acceptance tests.

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

## Final results, 2026-10-25

**Today, excluding AI authorship, the draft is not technically ready for Flathub
submission.** The Electron source-build requirement is unresolved. Native ARM64
execution and real desktop/Tailscale acceptance remain unverified; host-dependent
inclusion has no reviewer decision or exception. Local x86_64 build, lint and
headless execution now succeed. The matrix below supersedes the initial blocked
build/install results in the submission runbook.

| Requested check | Classification | Evidence and remaining scope |
| --- | --- | --- |
| Electron 44.7.0 offline source build | **ENGELLENDİ** | Exact DEPS/GN/sysroots investigated; both sysroot checksums verified. Full build not started because the worker's total disk is below Chromium's documented minimum. Both manifest Electron archives remain binaries; a verified complete offline recipe or explicit Flathub exception is required. |
| Tailscale necessity and host-dependent inclusion | **DOĞRULANAMADI** | Real installed local backend/desktop works without a sandbox Tailscale CLI/socket. Cross-device sharing still requires host authentication, HTTPS and Serve. Policy approval and real second-device tests are absent. |
| 26.08 Platform/SDK, Electron BaseApp, Node 24 | **ÇÖZÜLDÜ** for x86_64; **DOĞRULANAMADI** for ARM64 execution | Ten signed refs exist across both architectures (`runtime-refs.json`). Native x86_64 build/start succeeds; installed Node v24.21.0/dufs 0.46.0 execute (`installed-versions.json`). |
| Independent submission source paths | **ÇÖZÜLDÜ** | Self-contained copied directory expands to 1,306 real source entries, with all local paths confined to that directory (`standalone-inputs.json`). Both architecture download-only checks succeeded. |
| Manifest lint, clean build, repository lint, installation/start | **ÇÖZÜLDÜ** on x86_64 with native tools; **ENGELLENDİ** for the full SDK Builder attempt here | Official linter 3.0.0 manifest/AppStream/repo checks return 0. Native flatpak-builder 1.4.4 clean offline build, installation, backend, X11 and native Wayland startup return 0. SDK-packaged Builder separately fails `Unable to allocate instance id`; hosted workflow has not run. |
| Separate architecture support | **ÇÖZÜLDÜ** for tested x86_64 scope; **DOĞRULANAMADI** for native aarch64 | Both source archives/checksums and ELF machine types checked. No native ARM64 build/install/start was run. Separate native CI jobs are prepared, not dispatched. |
| Metadata, desktop integration, screenshots | **ÇÖZÜLDÜ** for metadata validation, X11/headless Wayland startup and real screenshot capture; **DOĞRULANAMADI** for interactive acceptance | Installed metadata byte-matches reviewed files and passes official lint/desktop validation. X11 clipboard, app ID, Chromium sandbox and quit lifecycle pass. Current real screenshot is local; old valid immutable store URL remains. Physical-seat clipboard and GNOME/KDE file/background portal consent are untested. |

### Successful local checks

Logs and companion exit status files are in `.test-artifacts/flathub/`:

| Evidence | Result |
| --- | --- |
| `clean-build-x86_64-final.txt` / `.status` | Exit 0; fresh module builds with `--sandbox --disable-download --disable-cache --force-clean`; Cargo locked/offline, npm offline with scripts disabled. This assembles the declared binary Electron input, not a source-built Electron. |
| `repo-lint-x86_64-final.txt`, `manifest-lint-final.txt`, `appstream-lint-final.txt`, `final-lint-checks.status` | All exit 0 using official linter 3.0.0, commit `ffc7635f0302899c3614b0c219124c18f48bbef7`. Installed AppStream/desktop validation also succeeds. |
| `install-x86_64-final.txt` / `.status` | Exit 0, actual user installation from the built OSTree repository. |
| `backend-x86_64-final.txt` / `.status` | Exit 0; host-home canary denied, private XDG data, safe port-conflict behavior, HTTP upload/download, ZIP content and shutdown verified. |
| `desktop-x86_64-correct-installations.txt` / `.status` | Exit 0; real X11 Electron window ready, clipboard round trip, app ID/class, managed updates, `sandbox=true`, no `--no-sandbox`, quit stops backend. Actual capture copied unchanged to `assets/airdrop-flatpak-desktop.png`. |
| `wayland-startup-x86_64.txt` / `.status` | Exit 0; real Weston headless/pixman compositor, `DISPLAY` absent, native Wayland window ready, sandbox/update/quit assertions. No physical seat, interactive clipboard or portal assertion. |
| `unit-tests-serial.txt` / `.status` | Exit 0; 77 passed, 0 failed, 0 skipped. |
| `installed-permissions.txt`, `installed-versions.json` | No home/host filesystem, system-bus or host-execution grant; Node v24.21.0, x64, app 1.5.0, dufs 0.46.0, no sandbox Tailscale CLI/socket. |

The legacy native composer initially emitted relative screenshot URLs; current
repo lint rejects those. Its supported `--no-partial-urls` option was used to
regenerate the catalog with absolute mirror URLs. Actual generated screenshot
media was committed with OSTree under `screenshots/x86_64` and
`flatpak build-update-repo` regenerated the indexes; repo lint then passed. No
XML was hand-edited, media uploaded or lint exception added. This extra export
step is specific to the old local builder. The preferred modern
`org.flatpak.Builder` workflow must still be run on normal native runners.

### Failures retained and practical limits

- `clean-build-official-x86_64.txt` / `.status`: SDK-packaged Builder reaches the
  first module, then exits 1 with `Unable to allocate instance id`. Earlier
  missing-tool/session-service/custom-installation-root attempts remain separately
  logged. The successful native build does not turn these failed attempts into
  successes.
- `repo-lint-x86_64.txt` and `repo-lint-x86_64-unmirrored.txt`: original catalog/
  missing mirrored media failures. The subsequent genuine media export and final
  lint are separate evidence.
- `desktop-x86_64-timeout.txt` and the earlier desktop attempt logs: Flatpak spawn
  portal activation/custom installation paths initially prevented renderer
  startup. Genuine session helpers/portal and a private empty system installation
  were configured in the validation environment; test launches explicitly use
  the user installation. No mock portal or sandbox bypass was used.
- `unit-tests-port-conflict.txt`: a mistakenly parallel desktop/unit run collided
  on port 5000. All 77 tests subsequently passed sequentially; the failure is kept.
- `wayland-screenshot-timeout.txt`: the optional Playwright screenshot timed out
  on a compositor without a physical seat, after application readiness. The
  separate no-screenshot Wayland startup/lifecycle check passed. No Wayland
  screenshot success or interactive acceptance is claimed.
- External HTTPS requests in the proxied worker showed certificate errors: the
  worker's extra CA path is not available inside the application sandbox. TLS
  verification was retained. Local HTTP functionality is verified; outbound
  push/update HTTPS and real Tailscale access are not certified by these tests.

The previously requested other-LLM branch was not found among local/remote refs.
After the maintainer said to leave branches alone, no branch was merged, deleted
or closed. All changes remain local on `work`; no PR, push, release or workflow
dispatch was made. The application runtime implementation was not changed.
The private test application was uninstalled without deleting user data; the
owned validation container/compositor was stopped. Built repositories, source
receipts and successful/failed logs remain available for review.
