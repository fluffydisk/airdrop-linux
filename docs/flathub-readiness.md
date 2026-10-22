# Flathub technical readiness

This document records preparation, not a submission or approval. Do not publish a
release or open a Flathub submission PR as part of these checks. All development
and testing runs in Codex Cloud and GitHub Actions.

## Access verification

The `flathub-check` channel of **Prepare and submit store packages** uses the
`flathub-publishing` environment. `GH_TOKEN` receives the environment secret
`FLATHUB_TOKEN`; `FLATHUB_FORK` receives the environment variable of that name.
Secret values are never printed or downloaded into the cloud workspace.

The check verifies the fork's parent, reads upstream `new-pr`, creates the missing
`new-pr` base branch in the fork if necessary, and pushes/deletes a temporary
branch pointing at that existing base commit. It does not push application files,
create a submission branch, or attempt an upstream PR. It fails if temporary-branch
cleanup fails. GitHub Actions job summaries record the outcome.

A fine-grained PAT limited to `fluffydisk/flathub` can authorize writes there. It
does not grant Pull requests write permission on `flathub/flathub`: reading a
public upstream repository does not grant write permission. Keep the narrow token;
there is no reason to replace it with a broader token for the checks. The eventual
submission must be opened manually through GitHub's web interface.

## Runtime and lint checks

**Package validation** builds and installs a real Flatpak on x86_64 and ARM64. It
tests the Node/dufs backend, HTTP file upload/download, ZIP contents, host-home
isolation, application-specific XDG data, conflicting backend startup, Electron
startup with Chromium sandbox enabled, clipboard round trip, managed-update
behavior and backend shutdown on exit. Background portal grant/denial/absence
are also exercised against a real D-Bus fixture in the native jobs. These fixture
tests do not replace interactive portal consent testing with a desktop portal.

Builds use the official `org.flatpak.Builder` `flathub-build` wrapper, including
its sandboxed build and screenshot-mirroring options. Screenshot media stays in
the temporary OSTree repository; no media is uploaded to Flathub by CI.

The official `org.flatpak.Builder` linter runs against both the AI-assisted local
runtime fixture and the built OSTree repository. No production/submission
manifest is generated. Reports, tool version and
exit codes are uploaded as `flathub-lint-x64` / `flathub-lint-arm64` artifacts.
Lint errors are reported as acceptance blockers, not silently treated as passing
lint. The runtime test and lint-readiness results are intentionally separate:
successfully running a Flatpak does not establish Flathub acceptance.

The manifest uses matching desktop/metadata/icon identifiers, a checksum-pinned
512-pixel icon, Freedesktop/Electron BaseApp 25.08, Wayland/fallback-X11 and portals
without granting the entire home directory. Screenshot metadata now uses the
immutable v1.5.0 tag. Tailscale stays on the host; local sharing operates without a
VPN daemon in the sandbox.

## Acceptance blockers

1. **Source build:** the existing manifest unpacks the prebuilt
   `airdrop-flatpak-*.tar.gz` payload, including Electron, Node, dufs and installed
   npm modules. Pinning a binary payload's SHA-256 is not a source build. Flathub
   requires source-available application components and bundled runtime
   dependencies to build from source, with dependencies available offline.
   A compliant source-build recipe has not been completed or certified here.
   The inline C portal helper must also become a separately fetched source file
   under Flathub's prohibition on embedding application/dependency source code in
   a manifest.
   The human packaging maintainer must select supported SDK extensions, pin app
   sources, generate npm/Cargo dependency sources from lockfiles, and build and
   test offline. Bundled runtime exceptions require explicit reviewer agreement.
2. **Application ID preparation:** the source now uses
   `io.github.fluffydisk.airdrop-linux`, mapping exactly to the reachable
   `https://github.com/fluffydisk/airdrop-linux`. It has four components and the
   hyphen occurs only in the last component, as required. Desktop, AppStream,
   icons, package paths, update/removal commands and test references agree.
   Managed Electron launches explicitly set the desktop filename and Chromium
   class before ready so Wayland app identity and desktop grouping can match.
   The new Flatpak ID receives a separate `~/.var/app/` namespace. Existing
   native and old-ID sandbox data are not imported or deleted; migration remains
   user initiated. Future native upgrades replace package-owned desktop files;
   manually pinned dock favorites may need to be re-added under the new ID.
   Published v1.5.0 assets and its tag are unchanged; a future source release is
   needed to publish this identity. Runtime/Wayland CI must pass on both arches.
3. **Generative AI policy:** the existing manifest/generator and portions of this
   packaging work were generated or assisted by an AI agent. Production channel
   generation now emits no Flatpak manifest and removes stale generated JSON
   recipes from its output directory. The --local fixture remains test-only.
   Flathub currently
   prohibits AI-generated or AI-assisted manifests, requires disclosure of other
   known generated material, and prohibits agents from opening or automating
   submission PRs and generating their submission/review text. Human review of an
   AI-generated manifest is not evidence that it meets that restriction. A human
   maintainer must independently author the submission manifest and handle the
   submission and review conversation. Do not submit this generated manifest as
   compliant or omit the provenance disclosure. Automatic Flathub PR creation has
   been removed from the workflow; selecting its old `flathub` channel fails with
   a message directing maintainers here.
4. **Desktop acceptance:** interactive file selection/export/open portals,
   background-permission consent and denial, interactive Wayland clipboard behavior,
   and host Tailscale HTTPS access require additional acceptance testing. The
   headless X11 and D-Bus fixture results do not certify these interactions.
   CI additionally attempts native Wayland startup under headless Weston with no
   DISPLAY fallback. That compositor has no physical input seat and does not
   establish interactive clipboard or portal consent acceptance.
5. **Release visibility:** v1.5.0 is publicly available and APT/RPM repositories
   are published. This does not publish an app on Flathub. The source changes
   described here are newer than that immutable release and need a future source
   release before submission. No store submission is performed by these checks.

The final reviewer decides inclusion, including desktop usefulness, development
history, host-dependency requirements, licensing, screenshots and metadata quality.
The app has a full desktop file/clipboard UI rather than being tray-only, but this
does not guarantee acceptance.

## Sources

Checked against the official documentation during this cloud task:

Requirements documentation revision: `b1f0539de6aed7aa26e097ede5de936510ab1df0`
(rechecked 2026-10-22).

* [GitHub fine-grained PAT limitations](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens-limitations)
* [Flathub requirements](https://docs.flathub.org/docs/for-app-authors/requirements/),
  especially application ID, offline/source builds and generative AI policy
* [Flathub submission procedure](https://docs.flathub.org/docs/for-app-authors/submission/)
* [Official metadata guidelines](https://docs.flathub.org/docs/for-app-authors/metainfo-guidelines/)
