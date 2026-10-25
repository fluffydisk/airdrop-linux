# Flathub preparation and local validation

For the current **technical reference**, its connection-status changes and exact
command/evidence matrix, use [the reference runbook](flatpak-reference.md). This
older submission-oriented audit is retained for provenance and failed attempts.

Status on **2026-10-25: x86_64 locally validated; not ready for submission**.
This is an AI-assisted technical runbook, not a submission PR description or
review response. No Flathub PR, GitHub release or remote change is authorized by
this document. A working upstream Flatpak does not establish Flathub acceptance.

The follow-up [technical review](flathub-technical-review.md) records the
standalone draft changes, Electron investigation and newer build/test attempts.
Its technical assessment excludes the AI-authorship issue at the maintainer's
request; the provenance recorded here is retained separately.

## Manifest review draft

An explicitly AI-assisted review draft is available at
[`packaging/flathub-draft/io.github.fluffydisk.airdrop-linux.yml`](../packaging/flathub-draft/io.github.fluffydisk.airdrop-linux.yml).
It is self-contained: generated dependency descriptions and patches live inside
the draft directory, while build helpers and original metadata are fetched from
an immutable upstream commit with verified checksums. Review notes identify the
Electron source-build gap, host integration and remaining acceptance tests.
Copy the whole `packaging/flathub-draft/` directory for an independent repository;
it no longer references the parent packaging directory. The release updater and distribution workflow continue to use the
existing upstream manifest. The draft is not a compliant Flathub submission.

## Application and packaging inventory

The application is Node.js/Express plus dufs, an Electron desktop companion and
a browser/PWA interface. Production npm dependencies include Express, Web Push,
Archiver and JSZip. Version 1.5.0 is recorded in the application and desktop
packages. The existing release workflow publishes stable tagged releases;
the separate Flatpak workflow can append tested bundles and request protected
repository publication. Neither pipeline submits an application to Flathub.

The existing recipe is preserved at
`packaging/io.github.fluffydisk.airdrop-linux.yml`. Its application ID maps to
the public `fluffydisk/airdrop-linux` GitHub repository. The desktop filename,
AppStream ID, icon name and Electron window identity agree with that ID.
There is no AGENTS.md in this checkout or its parent workspace.

| Input | Current approach |
| --- | --- |
| Runtime and SDK | Freedesktop 26.08, Electron2 BaseApp 26.08 |
| Node | Signed `org.freedesktop.Sdk.Extension.node24//26.08`, executable copied into `/app` |
| dufs | 0.46.0 at commit `b69946df232ceca5d24d0067f2beb6b5ed1c292c`; offline locked Cargo build |
| Application | v1.5.0 commit `2a66fabc4cac57381ab5c5ddbb9d5065e274cf04`, SHA-256 verified archive |
| Compatibility patch | Existing `flatpak/application-id.patch`, for immutable v1.5.0 only |
| Electron | Official 44.7.0 binary archives with separate x86_64/aarch64 SHA-256 pins; **source-build blocker** |
| npm and Cargo | Generated source lists under `packaging/flatpak/`; offline install/build |
| Build-only tooling | Locked Browserify; JSZip browser bundle rebuilt from JavaScript sources |
| Portal helper | `packaging/flatpak/background-portal.c` in application source; compiled with GIO |

The app installs under `/app/lib/airdrop-linux`; its launcher is
`/app/bin/airdrop-desktop`. Desktop metadata, metainfo, licenses and the
512×512 PNG icon install under `/app/share`. Zypak integrates Electron's
Chromium sandbox. Do not add `--no-sandbox` or host-spawn workarounds.

## Rules verified against official sources

The requirements and submission documentation were read online on 2026-10-24,
including documentation revision `103b03139dd2da1b1f407eb0bf966e462c682a80`.

- [Requirements](https://docs.flathub.org/docs/for-app-authors/requirements):
  code-hosting IDs must match a controlled repository; use the latest hosted
  runtime, checksum/commit-pinned sources and offline dependency inputs. All
  source-available bundled components must build from source unless Flathub
  explicitly grants an exception. None is assumed for Electron.
- [Generative AI policy](https://docs.flathub.org/docs/for-app-authors/requirements#generative-ai-policy):
  AI-assisted manifests are prohibited. Human review or rewriting generated
  material does not establish independent authorship. A human maintainer must
  independently author the actual submission manifest. Other known generated
  material and its approximate extent must be disclosed. Agents must not open
  submission PRs or generate their commit messages, descriptions or review text.
- [Runtime policy](https://docs.flathub.org/docs/for-app-authors/runtimes):
  Freedesktop branches receive two years of support. Verify current branches
  again before submission. The 26.08 Platform, Electron BaseApp, node24 and Rust
  extensions were found in the signed Flathub remote during this audit.
- [Metadata guidance](https://docs.flathub.org/docs/for-app-authors/metainfo-guidelines):
  ship desktop, icon and validated AppStream metadata upstream; describe actual
  functionality and all required post-install setup.
- [Sandbox permissions](https://docs.flatpak.org/en/latest/sandbox-permissions.html):
  prefer portals and application-specific XDG storage over static filesystem or
  bus access.
- [Submission procedure](https://docs.flathub.org/docs/for-app-authors/submission)
  and [upstream submission repository](https://github.com/flathub/flathub):
  local build, installation and lint precede a human-created PR against `new-pr`.

Host-dependent applications with complicated setup are evaluated case by case.
Local file management works without Tailscale, but cross-device use needs host
Tailscale and HTTPS setup. This remains a material inclusion concern, not an
approved exception. Application naming/icon distinction and development history
also remain reviewer decisions; this work does not certify trademark clearance.

## Sandbox and host integration

| Permission | Technical reason |
| --- | --- |
| `--share=network` | Loopback backend on ports 5000/6001, transfers and outbound Web Push |
| `--socket=wayland` | Native Wayland desktop |
| `--socket=fallback-x11` | X11 sessions, with Wayland preferred when available |
| `--share=ipc` | X11 shared-memory integration |
| `--device=dri` | Graphics acceleration |
| `--talk-name=org.kde.StatusNotifierWatcher` | Optional system tray registration |
| `GTK_USE_PORTAL=1` | Prefer desktop file chooser integration; not an access grant |

No whole-host/home filesystem access, system bus, unrestricted session bus,
Tailscale daemon socket, host execution or systemd management is requested.
Portals are available through Flatpak's default D-Bus policy without an extra
`--talk-name=org.freedesktop.portal.Desktop` grant. Verify actual exported
permissions with `flatpak info --show-permissions` after building.

The managed launcher starts dufs and the gateway inside the sandbox. Both bind
to loopback, which is shared with the host when network access is granted.
Existing services using ports 5000/6001 cause an explicit startup failure; do
not run a native installation's backend alongside this package. User data is
under `~/.var/app/io.github.fluffydisk.airdrop-linux/data/airdrop` by default.
Native and old-ID data are not silently imported or removed.

File selection/export/open uses Electron dialogs and desktop portals. Closing
the window keeps the backend alive only with background permission; denial or
missing portal stops sharing on window close. Explicit quit stops both child
services. In-app binary updates are disabled for managed Flatpak installations;
updates come through the Flatpak remote.

The desktop does **not** detect host Tailscale daemon status or run the native
installer's first-run wizard. Initial local workspace initialization is automatic.
Settings validates and saves an HTTPS `.ts.net` URL; saving it does not prove
VPN connectivity. No host status detection is claimed. On the host, install
and authenticate Tailscale, enable tailnet HTTPS and follow the existing
[Tailscale setup](../README.md#3-tailscale-and-https). Serve the gateway on
`http://127.0.0.1:6001`, preserving `/push`. Never expose these unauthenticated
loopback services publicly or enable Tailscale Funnel as part of this setup.
Without Tailscale the local desktop/web app remains usable; remote-device access
is unavailable. Notifications and sharing stop with the bundled backend.

## Local checks and clean build

Run from the repository root on a Linux desktop that supports Flatpak user
namespaces. Python 3 with PyYAML is needed by the existing release updater and
the new input checker; install tooling separately from application dependencies.

```sh
python3 -m venv /tmp/airdrop-flatpak-check
/tmp/airdrop-flatpak-check/bin/pip install PyYAML==6.0.3
/tmp/airdrop-flatpak-check/bin/python scripts/check-flatpak-inputs.py
desktop-file-validate packaging/io.github.fluffydisk.airdrop-linux.desktop
appstreamcli validate --no-net packaging/io.github.fluffydisk.airdrop-linux.metainfo.xml
npm ci --ignore-scripts
(umask 022; npm test)
```

The input checker validates all local includes, remote hash pins, matching IDs,
version provenance, supported Electron architecture inputs, build-tool npm cache
coverage and the reviewed permission set. During release preparation it also
checks the **downloaded release's** production npm lockfiles, rather than assuming
the current checkout is the source being packaged. It is not the official linter.

Install signed build tools and runtime inputs:

```sh
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user --noninteractive flathub org.flatpak.Builder \
  org.freedesktop.Platform//26.08 org.freedesktop.Sdk//26.08 \
  org.electronjs.Electron2.BaseApp//26.08 \
  org.freedesktop.Sdk.Extension.node24//26.08 \
  org.freedesktop.Sdk.Extension.rust-stable//26.08
flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest \
  packaging/io.github.fluffydisk.airdrop-linux.yml
flatpak run --command=flatpak-builder-lint org.flatpak.Builder appstream \
  packaging/io.github.fluffydisk.airdrop-linux.metainfo.xml
flatpak run --command=flatpak-builder org.flatpak.Builder --download-only \
  --disable-rofiles-fuse fetch-build packaging/io.github.fluffydisk.airdrop-linux.yml
flatpak run --command=flathub-build org.flatpak.Builder --disable-download \
  --disable-rofiles-fuse --jobs=2 --default-branch=stable --repo=flatpak-repo \
  packaging/io.github.fluffydisk.airdrop-linux.yml
flatpak run --command=flatpak-builder-lint org.flatpak.Builder repo flatpak-repo
flatpak install --user --noninteractive ./flatpak-repo io.github.fluffydisk.airdrop-linux
flatpak info --user --show-permissions io.github.fluffydisk.airdrop-linux
flatpak run io.github.fluffydisk.airdrop-linux
```

Use a new build directory/repository and builder state for a clean acceptance
build. Downloading declared sources is the online preparation phase. The build
must succeed with downloads disabled and module network access isolated. The
assembler additionally checks that only the loopback interface exists; npm uses
`--offline --ignore-scripts` with an unusable registry, Cargo uses `--offline
--locked`. Do not relax isolation to work around a failure.

After installation, existing smoke checks are:

```sh
dbus-run-session -- node scripts/smoke-sandbox.js flatpak
xvfb-run -a dbus-run-session -- node scripts/smoke-sandbox-desktop.cjs flatpak
dbus-run-session -- bash scripts/test-flatpak-wayland.sh
flatpak uninstall --user io.github.fluffydisk.airdrop-linux
```

They use disposable application data but need free backend ports. Keep normal
user data when uninstalling. Repeat native builds on x86_64 and aarch64; the
existing workflow already has both runner architectures. Do not substitute
cross-architecture source availability for successful installation/runtime tests.

## Initial checks, 2026-10-24

These are the initial checks, separate from historical Actions evidence. The
2026-10-25 follow-up in [the technical review](flathub-technical-review.md#final-results-2026-10-25)
supersedes the build, installation, repository-lint and headless-desktop failures
below. Those earlier failures are retained for traceability. No remote workflow
was dispatched.

| Check | Result |
| --- | --- |
| Manifest parsing | Passed with PyYAML 6.0.3 and `flatpak-builder --show-manifest` 1.4.4 |
| Expanded build graph | Unchanged by YAML formatting; compared parsed builder output before/after |
| Input consistency | Passed: 1,305 source entries and all three production/build-tool npm locks, using the pinned extracted application source |
| Negative input checks | Missing source, invalid hash, host-filesystem permission and stale npm cache were rejected in temporary copies |
| Official manifest lint | Passed, linter 3.0.0 from official source commit `ffc7635f0302899c3614b0c219124c18f48bbef7` |
| Official AppStream lint | Passed using the same linter |
| AppStream / desktop validation | Passed with AppStream 1.0.5 and desktop-file-validate |
| Source fetching | Builder `--download-only` passed for both x86_64 and aarch64, including both checksum-pinned Electron archives |
| Runtime availability | Platform, SDK, Electron BaseApp, node24 and rust-stable 26.08 refs found for both architectures |
| Offline npm installation | Passed for pinned server, desktop and local Browserify lockfiles using declared builder downloads, `npm ci --offline --omit=dev --ignore-scripts`, an unusable registry and a network namespace with only `lo`; direct production dependencies loaded |
| Existing Node tests | **77 passed, 0 failed, 0 skipped** on Node 24.19.0 with dufs 0.46.0 and umask 022 |
| Portal helper | Compiled with `-Wall -Wextra -Werror`; real session D-Bus fixture grant, denial, returned request path and missing portal passed |
| Release helper / CI syntax | Shell syntax, embedded Python syntax and workflow YAML parsed; end-to-end release regeneration and hosted CI were not run |
| Clean Flatpak build | **Blocked** before compilation: SDK unavailable after build-environment setup failure |
| Installation and sandbox GUI | **Not completed**; no tested bundle was produced |
| Repository lint | **Not run**; no completed OSTree application repository |
| Interactive portals, Tailscale, X11/Wayland | **Not tested on an installed Flatpak**; source/fixture checks do not replace desktop acceptance |
| Native aarch64 execution | **Not tested** on this x86_64 worker |

In that initial attempt, tools were installed in a private directory outside the repository. The signed
Freedesktop Platform installed, but installing the Electron BaseApp failed with
`Could not connect: No such file or directory` while querying parental controls:
this cloud worker has no system D-Bus socket. Retrying under a session bus did not
resolve it. The subsequent clean, download-disabled builder attempt reported
`Unable to find sdk org.freedesktop.Sdk version 26.08`. No system-bus checks,
parental controls, TLS verification or sandbox protections were disabled to
continue. The official linter was therefore run directly from its pinned source
with host tooling, rather than claiming a successful `org.flatpak.Builder` run.
The follow-up used a real isolated system D-Bus service and private signed tools
to complete the native x86_64 build/install/lint and headless startup checks.
The SDK-packaged Builder attempt still failed; its separate result is recorded
in the technical review. Native ARM64 and interactive desktop checks remain open.

## Metadata and desktop acceptance

Metadata and desktop entry are in `packaging/`, the installed 512×512 icon comes
from `ui/icon-512.png`, and the existing screenshot is
`assets/airdrop-desktop.png` (1080×840). AppStream uses its immutable v1.5.0 URL.
That screenshot predates the current Files/Clipboard navigation. A real installed
Flatpak X11 capture is now prepared at `assets/airdrop-flatpak-desktop.png`; it
has not been published. The existing reachable immutable metadata URL is retained
until publication is authorized and a real replacement URL can be pinned.
No synthetic image was created. The project license is
MIT; the metainfo metadata license is CC0-1.0. Dependency licenses are installed.

On real GNOME and KDE sessions, verify file selection outside the sandbox,
multi-file upload, ZIP download/export, external file opening, portal cancel and
denial, background permission grant/denial, close versus explicit quit, tray
absence, and X11/Wayland clipboard behavior. Test a fresh data directory with
Tailscale absent, then authenticated host Tailscale and a real second device.
Fixture portal responses or headless compositor startup do not establish these
interactive behaviors. Check that the launcher does not invoke the host installer
or promise automatic VPN configuration.

## Updating and eventual human submission

The existing `.github/workflows/flatpak-distribution.yml` performs both native
architecture builds, lint, installation and smoke tests. Input validation now
runs before expensive SDK setup; application/runtime source changes also trigger
the PR workflow. Lint remains a distribution gate. The release pipeline and its
protected publication jobs remain in place. No new publishing workflow is added.

For a published stable version, `scripts/prepare-flatpak-release.sh vVERSION`
uses `GH_REPO=fluffydisk/airdrop-linux` and the pinned official
`flatpak-builder-tools` checkout specified in that workflow. It resolves the tag
to an immutable commit, checks version agreement, regenerates lockfile-derived
source lists, refreshes Electron/dufs pins, updates provenance and release metadata,
and validates the downloaded source lockfiles. This is a local online preparation
operation; do not publish its results without normal review. Update runtime/SDK
and extension branches together and verify availability on both architectures.

Before submission, complete the Electron source-build solution, independently
author the human manifest and resolve host-dependency/metadata acceptance. Ship
the metadata and helper in a tagged upstream release so they can be fetched as
application sources. Submission repositories must not contain application code,
bundled binaries or copied metadata already shipped upstream. The manifest goes
at the submission repository root, named after the app ID; relative dependency
source-list paths must remain valid. Generated dependency lists and any necessary
patches accompany it. Do not merely copy this AI-assisted upstream recipe.

A human then follows the official `new-pr` procedure using the GitHub web
interface, handles the required provenance disclosure and review conversation,
and supplies successful build/lint plus desktop acceptance evidence. No PR text
or commit message is supplied here. After inclusion, updates go to the app's own
Flathub repository, not a fresh initial-submission PR. Flathub's builders handle
store distribution; upstream GitHub bundles do not publish a Flathub listing.
