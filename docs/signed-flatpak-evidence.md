# Signed Flatpak channel validation evidence

The signed application repository is **LIVE and verified over public HTTPS**.
This report distinguishes production tests from disposable-key tests and retains
the earlier failures. Updating the corrected Pages bootstrap copy still requires
the existing protected deployment review; the immutable fixed installer linked
in the installation guide is usable now.

The application source is pinned to
`91363da43c2cd28173201f397c5b9f1ea8cde132`, application version 1.5.0, repository
revision 3. The actual r2 baseline commit is
`f7627ea19cc9cc901a96683a02a5efef8cf5cb3497ca423c80d76cfc6ab5fd75`; its original
bundle SHA-256 is
`9dcc5d18450eb1404ce1615ebf4cf55dac03eeb09958dc4c767353dfd0cfb9df`.
No tag or release asset is moved/replaced.

## Live production verification

Owner-approved [publication 40415276558](https://github.com/fluffydisk/airdrop-linux/actions/runs/40415276558)
successfully signed and deployed the repository. Its production job recovered
from a real HTTP 503 on the second verified pull attempt, then passed full
repository lint and the Pages size guard: **887,823,649 bytes**. The overall run
was red because its first client check discovered the GPG diagnostic decoding bug
below, not because deployment failed.

Production head:
`d4d7c59d7caa9819b6db2425d9204f4be3e18e45d5c714030dcedd93f903cfe9`.
Signed r2 baseline:
`f7627ea19cc9cc901a96683a02a5efef8cf5cb3497ca423c80d76cfc6ab5fd75`.
The signed receipt and the full public-client log are retained in
[`live-production-receipt.json`](evidence/signed-flatpak/live-production-receipt.json),
[`live-publication-summary.log`](evidence/signed-flatpak/live-publication-summary.log)
and [`public-https-acceptance-actions.log`](evidence/signed-flatpak/public-https-acceptance-actions.log).

[Public acceptance run 40419140503](https://github.com/fluffydisk/airdrop-linux/actions/runs/40419140503)
**PASSED**, using a disposable Ubuntu 24.04 account and the real public URLs:

| Public requirement | Result | Actual evidence |
| --- | --- | --- |
| Production primary key, receipt, summary and commit signatures | VERIFIED | Pinned `6513D70958397F60D3787A0CB93F4FC1E97CF3AE`; installer verifies signatures before changing the app |
| Clean HTTPS app installation | VERIFIED | New account/store, actual production commit installed |
| Public `.flatpakref` installation | VERIFIED | Native Flatpak CLI independently installed the public reference and reported production head; `public-flatpakref-install.log` |
| Standard forward `flatpak update` | VERIFIED | Real signed r2 baseline prepared explicitly in the disposable account, ordinary forward update returns to production head |
| Original standalone r2 migration | VERIFIED | Public release bundle SHA-256 checked, origin migrated, exactly one app installed |
| Files/config/node-state retention | VERIFIED | Exact fixture-file hashes unchanged across update/migration; no authenticated account claim |
| Backend, upload/download, ZIP, clipboard, service lifecycle | VERIFIED | Real installed public application; payload and archive contents checked |
| Wizard, LAN pairing, copied address, decoded QR | VERIFIED | Real browser/session and authenticated transfers on one runner; not two physical devices |
| Embedded Tailscale login bootstrap | VERIFIED | Actual public package helper returned a real HTTPS login URL (redacted); account login/HTTPS tailnet transfer NOT TESTED |
| X11 startup and clipboard | VERIFIED | Xvfb, real sandboxed Electron 44.9.3, context isolation and Chromium sandbox retained |
| Native Wayland startup | VERIFIED | Weston session, app uses Wayland with DISPLAY removed; physical clipboard/portal consent NOT TESTED |
| Uninstallation | VERIFIED | App removed after the real public acceptance checks |
| APT/RPM repositories and release provenance | VERIFIED | Both APT architectures, both RPM signatures and original release payloads checked successfully |

Cloud independently passed public HTTPS installation, ordinary update, original
r2 migration, backend, Electron/X11, LAN/QR and clipboard checks using the cached
signed runtimes. Supplemental Cloud fixtures initially had a stopped private
system D-Bus and an XDG runtime outside the test container's bind mount; restoring
the original owned test environment resolved them. Those failures are retained
as `cloud-test-*-failure.log`. The private Cloud Weston extraction lacked its
loader/module paths; those initialization failures are retained separately.
The successful native Wayland result above is the clean Ubuntu Actions result.
`live-sandbox-permissions.log` records the real installed public package's
permissions; the deployment did not add permissions or disable Chromium's sandbox.

## Corrected bootstrap copy and CI environment

The first production client failed decoding the non-ASCII UID of the real
signing key: `UnicodeDecodeError` on GPG's C-locale diagnostics. Commit `bb5e690`
decodes diagnostics with escaped invalid bytes while preserving subprocess exit
status and all GPG verification checks. Real GPG valid/tampered signature tests
and undecodable success/failure diagnostics are covered. The private Cloud GPG
build emitted UTF8 for the fixture UID; the original Actions traceback records
the actual production failure. See `public-installer-key-uid-failure.log` and
`installer-encoding-regression.log`.

The corrected installer is available at immutable commit
`bb5e6903562476702cbc4b8b70296a75643b6b2b`, SHA-256
`9a9791cc4d8e97d6a609839f875c023cecb8e82334cf8fd23de8c322dd7525d3`.
The installation guide uses that verified GitHub source while its Pages copy is
refreshed. [Publication 40419422199](https://github.com/fluffydisk/airdrop-linux/actions/runs/40419422199)
has prepared its inputs and is **waiting for the existing `package-publishing`
required reviewer, `fluffydisk`**. It preserves the current signed app head and
updates the signed bootstrap/site. Modern-channel public checks now also run
after such native-only/preservation deployments, rather than using the legacy
bundle-only verifier.

Two earlier clean public-check runs were cancelled **before application tests**
because the runner's external `/etc/apt/apt-mirrors.txt` still selected the slow
Azure mirror. The existing mirror helper handled source files but not that
external list. Commit `0912a38` fixes the list while retaining suites, priorities,
keys and other mirrors; an actual disposable-container fixture proved those
properties. The successful public run used the corrected helper. Exact slow
download/cancellation evidence is retained in `public-ci-slow-mirror.log`.

Earlier checkpoints below are historical and do not override the live results.

## Latest production transport retry

Owner-approved production run 40409895329 attempt 1 **passed the restored
repository's full fsck**, protected-key import, and native signing. It then
received **HTTP 503 from the existing public Pages repository** while mirroring
its previous signed commit. No Pages artifact was uploaded/deployed. The exact
traceback is retained in [`production-transient-503.log`](evidence/signed-flatpak/production-transient-503.log).
The automatically requested rerun required fresh environment review as well;
that obsolete waiting attempt was cancelled before requesting the corrected run.

Commit `9e3adfce490d581e32b6264b87855f7eff129d18` adds a three-attempt budget and
short backoff for explicit transient HTTP 429/500/502/503/504 responses. Verified
pulls resume their already downloaded objects in the same staging repository.
GPG, checksum, certificate, corruption, authorization and unknown errors remain
fatal; no verification flag or native package input is changed. Metadata fetches
also distinguish optional 404 from real failures rather than silently falling
back to an older repository during a service outage.

`python3 scripts/test-flatpak-network-retry.py` runs a real locally hosted,
GPG-signed repository with controlled HTTP failures. It proves successful retry
and authenticated payload delivery after a 503, exactly three attempts for a
persistent 503, and immediate rejection of an invalid summary signature. Real
metadata HTTP requests also verify 503 recovery, optional 404, and fatal,
non-retried 403. See [`network-retry-regression.log`](evidence/signed-flatpak/network-retry-regression.log).
This is network fault injection against real OSTree/GPG, not a physical-device
or production-availability claim.

The first fault fixture emitted an HTML error body larger than the tiny commit's
expected size; it was changed to a zero-length 503 body. The next test exposed
libostree's `While fetching ...: Server returned HTTP 503` diagnostic prefix;
both supported diagnostic forms are now matched. These earlier failed test
attempts remain in `network-retry-fixture-size-failure.log` and
`network-retry-prefix-failure.log`; the final test passes.

- [Updated real artifact/native/Flatpak signing rehearsal](https://github.com/fluffydisk/airdrop-linux/actions/runs/40414899261): **PASSED**, complete site
  **887,802,880 bytes**. Exact verification lines are retained in
  [`network-resilient-rehearsal-summary.log`](evidence/signed-flatpak/network-resilient-rehearsal-summary.log).
- [Corrected production publication](https://github.com/fluffydisk/airdrop-linux/actions/runs/40415276558): preparation passed; **waiting for the existing
  `package-publishing` required reviewer `fluffydisk`**. The previously approved
  run's review did not carry over; no protection was changed. The already tested
  immutable application candidate from run 40408382425 is reused; only the
  publication transport changed.

Public installation and r2 update remain blocked until this production job is
approved and deployed. The post-deployment public HTTPS verification workflow is
configured to run automatically. Earlier checkpoints below are historical.

## Production retry: artifact layout failure (2026-10-26)

The owner approved run 40246905953. Protected-key import and APT/RPM signing both
passed. Its Flatpak step then failed **before signing the candidate**, because
the prepare job's second `upload-artifact` transfer retained files but omitted
empty directories. Actual error: `Listing refs: opendir(refs/remotes): No such
file or directory`. The exact Actions traceback is retained in
[`production-artifact-layout-failure.log`](evidence/signed-flatpak/production-artifact-layout-failure.log).
The failed run did not upload/deploy a Pages artifact; existing public packages
and release assets were unaffected.

Commit `912a577c2a87bfd09ea7e63d0f7058d6f662a7a8` restores only OSTree's empty
structural directories before the mandatory full fsck. It does not alter objects,
refs, configuration, summaries, signing identity or sandbox permissions. A real
OSTree/ZIP regression test reproduces the missing-directory failure, asserts
every file byte and commit remains unchanged after restoration, checks the
application fixture payload, and confirms a deliberately corrupt commit still
fails fsck. Run locally: `python3 scripts/test-flatpak-artifact-layout.py`.
The current Cloud application regression run also passed **104/104, zero skips**.

Current reruns:

- [Exact two-hop artifact/signing rehearsal using the previously verified application](https://github.com/fluffydisk/airdrop-linux/actions/runs/40408447669): **PASSED**.
  The real downloaded artifact now passes full fsck and produces the complete
  signed native/Flatpak Pages tree; no production keys or deployment used.
- [Clean candidate build, regression and signing/update tests](https://github.com/fluffydisk/airdrop-linux/actions/runs/40408382425): **PASSED**, including all 17
  signed installation/update/migration/trust checks and the full installed-app
  smoke tests. Complete combined Pages tree: **887,805,634 bytes**; official signed
  repository lint passed. Selected exact log lines are retained in
  [`fixed-candidate-summary.log`](evidence/signed-flatpak/fixed-candidate-summary.log).
- [Corrected protected production publication](https://github.com/fluffydisk/airdrop-linux/actions/runs/40409895329)
  was requested automatically only after the clean candidate passed. It uses the
  new candidate run 40408382425. Preparation passed; production signing is
  **WAITING for the existing `package-publishing` required reviewer, `fluffydisk`**.
  GitHub's `pending_deployments` API confirms this gate. Open the corrected run
  and select **Review deployments → package-publishing → Approve and deploy**.
  No protection was altered or approval performed on the owner's behalf.

At this retry checkpoint the modern public receipt still returns HTTP 404.
Clean public HTTPS installation and public r2-to-current update are therefore
**NOT TESTED / BLOCKED by production review**, not counted among the successful
disposable-repository tests. The existing public APT/RPM paths still return 200;
all 27 v1.5.0 release assets, including the original r2 bundle, remain present.
The post-deployment workflow automatically performs the required public tests
after approval; its result must be inspected before calling the channel live.
See [`production-retry-checkpoint.json`](evidence/signed-flatpak/production-retry-checkpoint.json)
for the exact run IDs and gate evidence.

The original checkpoint below is retained as historical evidence, not a claim
that the failed production run is still waiting for approval. Public HTTPS
installation/update must pass after a successful corrected deployment before
activation can be called complete.

## Original verified candidate and production gate

- [Successful clean build and signing/update tests, run 40245958434](https://github.com/fluffydisk/airdrop-linux/actions/runs/40245958434), workflow commit
  `7615fea6f53ee9ae5a784e1759d1f562120bf1f8`.
- [Tested unsigned candidate artifact](https://github.com/fluffydisk/airdrop-linux/actions/runs/40245958434/artifacts/12619380105).
- [Complete validation artifact](https://github.com/fluffydisk/airdrop-linux/actions/runs/40245958434/artifacts/12618209885), also retained in
  [the committed evidence directory](evidence/signed-flatpak/).
- [Existing package validation, run 40245958485](https://github.com/fluffydisk/airdrop-linux/actions/runs/40245958485):
  all 19 jobs passed, including native x64/ARM64 APT/RPM and disposable distro
  installations. Its legacy Flatpak jobs do not verify the new ARM update channel;
  the new channel and its public verifier advertise x86_64 only.
- [Production signing/deployment run 40246905953](https://github.com/fluffydisk/airdrop-linux/actions/runs/40246905953)
  successfully prepared the verified inputs and is **waiting for the existing
  `package-publishing` required reviewer, `fluffydisk`**. This was confirmed by
  GitHub's `pending_deployments` API. Open that run, choose **Review deployments →
  package-publishing → Approve and deploy** to authorize production signing.
  No environment protection or production key was changed.

The old waiting pre-channel publication request was cancelled only after its
source was confirmed to lack the modern channel configuration; it must not deploy
an older Flatpak over r2. Current protected review requests are never approved by
the automation. At this checkpoint the new signed receipt is not yet public.
Existing public descriptors still point to the **legacy**, pre-r2 application.

The tested signing/update keys were disposable CI keys, **not** the protected
production key. The production job will use the existing authorized fingerprint
`6513D70958397F60D3787A0CB93F4FC1E97CF3AE` after review. A missing protected key or
public fingerprint variable fails explicitly; actual availability cannot be
confirmed before the environment releases its secrets.

## Requirement-to-evidence matrix

Paths below are relative to [the evidence directory](evidence/signed-flatpak/).
Commands are also recorded verbatim in `validated/results.json`. The reused
validator intentionally retains its separate Flathub policy blockers; those are
not prerequisites for this independent GitHub distribution.

| Requirement | Status | Actual execution and evidence | Remaining limit |
| --- | --- | --- | --- |
| Immutable source and verified dependencies | VERIFIED | `prepare-flatpak-channel.py --source 91363da43c2cd28173201f397c5b9f1ea8cde132 --revision 3`; `prepared/preparation.json`, `validated/source-receipt.json`, `validated/source-inventory.json` | Electron is the checksum-pinned official binary, not a source-built Electron claim |
| Clean offline x86_64 build | VERIFIED | `flatpak-builder --sandbox --disable-download --disable-cache --force-clean --jobs=2 --default-branch=stable`; `validated/21-clean-offline-build.log` | Sources/runtimes fetched and verified before the network-isolated build |
| Regression suite | VERIFIED | Cloud `npm test`: 104 passed, zero skipped; `local-unit-tests.log` | GitHub build's suite: 103 passed, 1 skipped because host `dufs` is absent; actual packaged dufs is tested separately |
| Manifest, repository, AppStream, desktop and images | VERIFIED | Official Builder lint, `appstreamcli`, `desktop-file-validate`, image checks; `validated/18-*`, `25-*`–`28-*`, `37-*` | Successful lint is not Flathub reviewer approval |
| Signed repository and actual application install | VERIFIED | `test-signed-flatpak.py --system-cases`; `signed-tests.log`, `signed-tests/results.json` (17 checks) | Disposable keys/local HTTP isolate the cryptographic mechanism from production review |
| Standard forward update | VERIFIED | Real signed r2 install, promote new revision, ordinary `flatpak update --user --noninteractive ID//stable`; `signed-tests.log` | New commit and `/app/share/airdrop-linux/distribution.json` revision 3 both asserted; same app version 1.5.0 |
| Original standalone r2 migration | VERIFIED | Actual SHA-verified public bundle, origin changed to signed remote, one installed app; `signed-tests.log` | Both `--user` and real default `--system` cases; test-only sudo adapter for disposable system setup, never for launching the app |
| Data, shared files and node-state retention | VERIFIED | Exact file hashes across update/migration/uninstall/reinstall; `signed-tests/results.json`, `validated/32-*` | Credential/state sentinels are fixtures, not an authenticated real Tailscale account |
| Ambiguous scope and remote trust | VERIFIED | Duplicate user/system apps, wrong scope, wrong URL, disabled verification and added foreign key all rejected; `signed-tests/results.json` | Existing remote trust is not silently replaced; named system installations require manual handling |
| Invalid signatures and downgrade prevention | VERIFIED | Correctly generated wrong-key summary and commit signatures both rejected; signed revision 2 refused; `signed-tests.log` | No signature bypass used by the installer |
| Backend, files, ZIP, clipboard and lifecycle | VERIFIED | Actual signed installed package, HTTP upload/download and decoded ZIP assertions; `signed-tests/backend.log`, `signed-tests/desktop.log` | Physical devices were not used |
| Wizard, LAN URL, QR, pairing and fallback | VERIFIED | Actual browser, decoded QR, capability/session authentication, LAN file/ZIP exchange; `signed-tests/desktop.log` | Client/server on one disposable runner; not a phone/tablet network test |
| Embedded Tailscale bootstrap | VERIFIED | Actual installed source-built tsnet helper returns a real browser-login URL (redacted); `signed-tests/desktop.log` | Login completion, tailnet transfer and HTTPS certificate issuance NOT TESTED without account/device |
| X11, Wayland and sandbox | VERIFIED | Xvfb desktop/clipboard, native headless Weston startup, host-home denial, loopback listeners, unchanged sandbox; `validated/31-*`, `35-*`, `36-*`, `38-*` | Interactive desktop portal consent and Wayland clipboard NOT TESTED |
| Existing APT/RPM publication | VERIFIED | Actual v1.5.0 native assets rebuilt/signed/verified with disposable key; Flatpak addition asserts all native-file hashes unchanged; `native-signing.log`, `complete-tree.log` | Public production regression check awaits deployment |
| Pages quota and signed final repository lint | VERIFIED | Complete native + Flatpak site **887,811,972 bytes**, below 1,000,000,000; official signed repository lint exits 0; `ci-summary.log`, successful build step | Native ARM URLs preserved; modern Flatpak only x86_64; current/previous payload retention |
| Atomic combined publication | BLOCKED | Existing single Pages publisher, upload/deploy artifact and concurrency group implemented; run 40246905953 prepared inputs | Required owner environment review; no alternative unprotected publisher created |
| Authorized production signatures | BLOCKED | Protected signing job queued, exact existing key pinned in installer/descriptors | Await owner review and actual protected-key operation |
| Public HTTPS install/update/r2 migration | NOT TESTED | `flatpak-channel-public-check.yml` automatically follows successful production deployment; `test-public-flatpak-channel.py` | New production receipt/objects do not exist yet; cannot claim public end-to-end success |

Headless portal services logged FUSE/document-mount, PipeWire and accessibility
warnings. These did not prevent package startup or tested operations. They are
retained in the raw logs; interactive file-picker/consent behavior is not asserted
from those headless tests. Flatpak's r2 import also emitted GLib/OSTree diagnostics
while returning success; subsequent fsck, signature verification, installation
and payload checks passed. No failed mandatory check is counted as successful.

## Reproduce and complete activation

On a disposable Ubuntu 24.04 GitHub runner, execute the steps in
[the candidate workflow](../.github/workflows/flatpak-update-repository.yml).
It installs the signed 26.08 SDK/BaseApp/Node/Rust extensions, creates the recipe,
fetches sources, builds offline, runs package tests, then tests real signing and
updates. Do not run the destructive test setup on a personal installation:
`AIRDROP_TEST_DISPOSABLE=1` is required.

After the production review, the publisher automatically runs
[the public check](../.github/workflows/flatpak-channel-public-check.yml):
HTTPS key/summary/commit verification, clean installation, controlled previous
signed revision, standard forward update, original r2 migration, signed app
startup/LAN/QR/file/ZIP/clipboard checks and existing public APT/RPM verification.
Its `public-signed-flatpak-evidence` artifact is the required final public proof.
If it fails, inspect that exact log; do not declare the channel verified merely
because Pages accepted an artifact. It can also be dispatched independently:

```sh
gh workflow run flatpak-channel-public-check.yml --ref main
```

For normal installation/migration, use [the checksum-pinned installer and scope
commands](signed-flatpak-updates.md#fresh-installation-and-r2-migration). The
installer verifies the minimum revision and all signatures before changing the
app, so attempting it before activation fails safely.

Official mechanisms used:

- [Flatpak hosting and GPG signing](https://docs.flatpak.org/en/latest/hosting-a-repository.html)
- [Flatpak command reference](https://docs.flatpak.org/en/latest/flatpak-command-reference.html)
- [GitHub Pages size limit](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Required deployment review](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/reviewing-deployments)

## Earlier failures retained

Earlier failed attempts remain in Actions and local evidence: the first run
successfully built and updated the app, then detected an already-exited CLI
sandbox still visible in `flatpak ps`; the installer now waits briefly without
killing processes. The wrong-key summary test initially omitted OSTree's required
`--update` option, and its error-message assertion initially required a `GPG`
prefix although libostree returned a real `Can't check signature` rejection.
See [exact CI failure excerpts](evidence/signed-flatpak/previous-failures.log)
with their original Actions links. These test issues were corrected without
disabling verification. The cloud
browser's proxy accommodation is the same exact-local-endpoint test-only setting
already documented in the r2 report. No simulated test is called a physical
second-device test.
