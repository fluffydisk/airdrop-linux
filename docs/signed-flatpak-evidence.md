# Signed Flatpak channel validation evidence

Production activation is gated by the existing required reviewer of the
`package-publishing` environment. This report distinguishes disposable-key tests
from actual production publication. Public installation/update checks cannot be
reported as passed before the approved Pages deployment runs them.

The application source is pinned to
`91363da43c2cd28173201f397c5b9f1ea8cde132`, application version 1.5.0, repository
revision 3. The actual r2 baseline commit is
`f7627ea19cc9cc901a96683a02a5efef8cf5cb3497ca423c80d76cfc6ab5fd75`; its original
bundle SHA-256 is
`9dcc5d18450eb1404ce1615ebf4cf55dac03eeb09958dc4c767353dfd0cfb9df`.
No tag or release asset is moved/replaced.

## Verified candidate and production gate

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
