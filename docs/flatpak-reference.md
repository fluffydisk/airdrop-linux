# Airdrop Linux Flatpak technical reference

The [final sprint handoff](flathub-final-handoff.md) supersedes the architecture
scope and test totals below. This earlier report remains historical evidence.
The current reference is restricted to x86_64 and the validator accepts an
independently authored manifest through `--manifest`.

This work continues the existing standalone recipe. It is a working **x86_64
reference**, not a Flathub submission or a claim of Flathub readiness. Binary
Electron is retained by the maintainer's choice while source-build compliance
remains blocked. No PR, push, workflow dispatch, release or policy-exception
request was made. AI-assisted provenance remains in the reference.

## Delivered files

- `packaging/flathub-draft/`: independent manifest, generated npm/Cargo sources,
  identity/metadata/connection patches and build instructions.
- `scripts/validate-flatpak-reference.py`: repeatable build, lint, installation,
  runtime, portal-fixture and removal checks with command/exit-code evidence.
- `scripts/test-flatpak-tailnet.py`: real HTTPS transfer checks to run on a second
  authorized tailnet device; not executed in this worker.
- `.test-artifacts/flathub-reference/compliance-matrix.md` and `.json`: final
  requirement/source/solution/command/result/evidence/blocker matrix. Run-specific
  matrices and raw logs remain beside it. The review archive includes these
  otherwise ignored artifacts and all earlier `.test-artifacts/flathub/` records.

The immutable application is v1.5.0 commit
`2a66fabc4cac57381ab5c5ddbb9d5065e274cf04`. Packaging helper inputs are pinned to
`54382392a6897eda9629de7ba4a48926d0a774fd`. No guessed hashes were added.
`connection.patch`, applied after the identity patch, reproduces the reviewed
desktop changes exactly. No npm dependencies or sandbox permissions were added.

## Current results

| Requirement | Result | Evidence |
| --- | --- | --- |
| Independent source paths and pinned downloads | VERIFIED | `native-01/source-receipt.json`, source-fetch log; 1,307 expanded source entries |
| x86_64 clean offline module build | VERIFIED | `native-01/21-clean-offline-build.log`; sandboxed, no downloads/cache, Cargo locked/offline and npm offline/scripts disabled |
| Manifest, repository, AppStream and desktop validation | VERIFIED | Original manifest lint and `native-retest-03` lint/validation logs |
| Icon, real capture and existing store screenshot URL | VERIFIED | `image-validation.log`: CRCs, decompression, dimensions and actual HTTPS image bytes checked; current capture visually inspected |
| Startup, upload/download, ZIP, isolation, service stop | VERIFIED | Real installed backend and desktop checks in `native-retest-03` |
| System clipboard and shared clipboard/HTTP contents | VERIFIED | X11 installed-package test; no second-device claim |
| Unavailable workspace behavior | VERIFIED for controlled responses | Unit and installed IPC/UI tests; local work continues, cancellation/local fallback checked |
| Headless native Wayland window/sandbox/lifecycle | VERIFIED | `native-retest-03` Wayland log; no DISPLAY fallback |
| Background portal grant/denial/absence | VERIFIED for fixture scope | Real session D-Bus plus controlled portal fixture; not actual user consent |
| Unit/integration suite | VERIFIED | 89 passed, 0 failed, 0 skipped in `native-01/06-unit-and-controlled-connection-tests.log` |
| Test uninstall preserving user data | VERIFIED | Final uninstall log, exit 0 |
| Runtime/BaseApp/Node/Rust 26.08 refs | VERIFIED for availability | Ten signed remote metadata queries, separately for both architectures; installed x86_64 Node v24.21.0 runs |
| Full SDK-packaged Builder run here | BLOCKED | `sdk-attempt-01/21-clean-offline-build.log`: nested user namespace creation denied; independently reproduced in `sdk-namespace-diagnostic.log` |
| Electron source-build compliance | BLOCKED | Official build instructions require the complete Chromium/Node/tool dependency graph; worker disk is below documented Chromium minimum. No verified complete offline build or granted exception |
| Host-dependent inclusion | BLOCKED | Cross-device sharing still requires host Tailscale authentication, HTTPS and Serve; no inclusion decision/exception |
| Real two-device Tailscale use | NOT TESTED | No configured VPN, authenticated service or second device available |
| Native ARM64 build/install/execution | NOT TESTED | Worker is x86_64. Ref/archive availability and ELF checks are not native execution |
| Interactive GNOME/KDE portals and Wayland clipboard | NOT TESTED | No physical desktop/input session |

The final retest reuses the successfully compiled, unchanged build graph from
`native-01`; it does not claim a second clean compilation. Included source hashes
must match, and the parsed manifest graph must match before reuse. README or YAML
comment changes do not invalidate a binary; source/patch or graph changes do.

Native flatpak-builder 1.4.4 was used with official linter 3.0.0, pinned commit
`ffc7635f0302899c3614b0c219124c18f48bbef7`. The native helper supplies the composer's
supported `--no-partial-urls` option and exports actual generated screenshot
media with OSTree, then updates repository indexes. Nothing is uploaded and no
lint rule is suppressed. The SDK Builder failure remains a separate result.

## Repeat on a normal Linux machine

Use a disposable account with ports 5000/6001 free. The helper refuses to replace
an existing user installation. It assigns a separate in-sandbox test workspace
and never uninstalls with `--delete-data`. Screenshots and controlled tests may
temporarily use the test session's clipboard; do not run them in a working user
session whose clipboard must remain untouched.

Install Node 24, Python 3/PyYAML, project npm dependencies, Flatpak, D-Bus, Xvfb,
Weston, AppStream/compose, desktop-file-utils and the signed 26.08 runtime inputs
listed in the standalone README. For the full host unit suite, also provide dufs
0.46.0, systemd-analyze and Python GI. Missing unit prerequisites are recorded as
skips rather than a complete unit-suite verification.

From the existing application checkout:

```sh
npm ci --ignore-scripts
umask 022
python3 scripts/validate-flatpak-reference.py \
  --arch x86_64 --builder sdk --output .test-artifacts/reference-x86_64
```

Repeat with `--arch aarch64` **on an actual ARM64 worker**. Each invocation needs
a new output directory. The existing read-only reference CI matrix invokes this
helper on separate native runners; it has not been dispatched.

For a machine with native builder/linter installed, choose `--builder native`
and `--linter 'flatpak-builder-lint'`. Install native stripping/debugedit tools as
well. Do not treat success with that path as success of a failed SDK attempt.
`--state-dir DIR` may reuse verified downloads; module build cache remains off.
`--wayland-socket NAME --wayland-runtime DIR` uses an existing real compositor;
otherwise the included Weston startup helper is used.

After fixing only a test harness, retest a matching completed build with
`--from-run PREVIOUS_OUTPUT --builder native --output NEW_OUTPUT` and the same
linter/compositor options. Original build evidence is linked explicitly.

The current cloud tools use a private Flatpak installation and real session
helpers/system bus. Its machine-specific paths are outside the source recipe.
The exact resolved commands are in the matrices. No namespace, Chromium sandbox,
parental-control, TLS or checksum validation was disabled to obtain success.

## Tailscale and real-desktop handoff

Local files, ZIPs and clipboard operate through loopback services without host
Tailscale. Cross-device use requires host Tailscale installed/authenticated,
tailnet HTTPS and Tailscale Serve targeting `http://127.0.0.1:6001`, including
`/push`. Configure those on the host using the project setup instructions.
Neither the application nor the test helper installs/configures a VPN or enables
public Funnel/LAN access.

Settings checks only the saved `.ts.net` HTTPS application's health, on explicit
user action, with a five-second timeout, redirect rejection and verified TLS.
Saving an address does not mark it connected. A successful response establishes
reachability from this computer only. Failure explains the required host setup
and preserves local operation; opening the web app offers a local fallback or
explicitly trying the saved address. There is no host daemon-status detection.

On an authorized **second device**, against a disposable workspace:

```sh
python3 scripts/test-flatpak-tailnet.py \
  --url https://YOUR-DEVICE.YOUR-TAILNET.ts.net \
  --output tailnet-second-device.json
```

The helper verifies HTTPS health, upload/download bytes, ZIP contents and shared
clipboard bytes. It uses default verified TLS/environment proxy handling,
rejects redirects, removes its unique fixture and restores the previous shared
clipboard only if no concurrent client changed it. Record the installed app's
host identity and the distinct client identity alongside its report. The script
alone cannot establish physical device topology. Test daemon disconnect/reconnect
and verify the desktop message/local fallback manually; do not manufacture a
success using a controlled endpoint.

On actual GNOME and KDE sessions, record OS/architecture, session type and portal
backend/version, then check file selection outside the sandbox, cancel/deny,
export/open, background grant/deny, close versus explicit quit, tray absence and
Wayland clipboard in both directions with another native application. Capture
real screenshots and outcomes. Fixture/headless results do not complete this list.

## Electron policy and preserved failures

Official [source-build requirements](https://docs.flathub.org/docs/for-app-authors/requirements#building-from-source)
cover bundled source-available dependencies. Their exception wording is case by
case for well-known vendors, for example unavailable offline tooling; this is no
automatic Electron exception and limited worker disk is no approval. The
[Electron build instructions](https://www.electronjs.org/docs/latest/development/build-instructions-gn)
require gclient preparation and GN/Ninja compilation; BaseApp is supporting
libraries/Zypak, not an Electron executable. The exact dependency/sysroot research
and verified downloads remain in the earlier technical review. Current official
document snapshots and worker capacity are recorded under `policy/`.

The [host-dependent application rule](https://docs.flathub.org/docs/for-app-authors/requirements#host-dependent-applications)
also requires case-by-case evaluation for core host-dependent functionality.
No request was sent and no exception is assumed. Metadata describes this setup.

All earlier logs remain in `.test-artifacts/flathub/`. New failed SDK execution
remains in `sdk-attempt-01`. The first new X11 attempt failed because the test
used unavailable global `require` in Electron's evaluation context; the next
failed because its dialog stub omitted the parent-window argument. Both logs
remain in `native-01` and `native-retest-02`. Corrected installed tests passed in
`native-retest-03`. Earlier Wayland screenshot timeout, port collisions, media
lint failures and worker TLS errors remain historical evidence, not successes.

## Independent-manifest comparison checklist

- [ ] Same immutable application/helper inputs and real checksums; intentional version differences documented.
- [ ] Includes/patches resolve inside an independent copy; generated dependency descriptions match actual locks.
- [ ] Electron binary provenance explicit, or a complete verified offline source build supplied; no assumed exception.
- [ ] Matching supported Platform/SDK/BaseApp/extensions exist for each claimed architecture.
- [ ] Fresh module build works without downloads/network/cache; no host payload is silently copied in.
- [ ] Manifest and resulting repository pass official lint without suppression; actual media is exported.
- [ ] Installed desktop ID, window identity, AppStream ID, icon and executable agree.
- [ ] Metadata explains host setup; screenshots are real and URLs exist at immutable revisions.
- [ ] Permissions remain reviewed/minimal; no host/home, host-spawn, VPN socket or broad D-Bus grant.
- [ ] Real installed uploads, downloads, ZIP and clipboard contents match expected bytes.
- [ ] Missing/failed remote connectivity remains distinguishable from local readiness.
- [ ] Port conflicts fail safely; close/background/quit behavior and backend termination are tested.
- [ ] X11, headless Wayland, real desktop portals and two-device tests retain distinct evidence scopes.
- [ ] Native ARM64 results exist before claiming ARM64 support; source downloads alone do not count.
- [ ] Removal preserves user data; failed attempts/skips are kept with exact commands and tool versions.
- [ ] Every requirement has VERIFIED, BLOCKED or NOT TESTED status; technical reference success is not labelled Flathub readiness.
