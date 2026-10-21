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

The official `org.flatpak.Builder` linter runs against both the generated
production manifest and the built OSTree repository. Reports, tool version and
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
   The human packaging maintainer must select supported SDK extensions, pin app
   sources, generate npm/Cargo dependency sources from lockfiles, and build and
   test offline. Bundled runtime exceptions require explicit reviewer agreement.
2. **Application ID:** `io.github.fluffydisk.Airdrop` is internally consistent but
   maps to `https://github.com/fluffydisk/Airdrop`, whereas the actual project is
   `fluffydisk/airdrop-linux`. Flathub's code-hosting ID rule requires a reachable
   matching repository or an explicit exception. A maintainer must choose a
   matching ID (for example `io.github.fluffydisk.airdrop-linux`) and update all
   desktop, icon, data-path and test references, or obtain the exception. This
   report does not silently change the ID requested for the project.
3. **Generative AI policy:** the existing manifest/generator and portions of this
   packaging work were generated or assisted by an AI agent. Flathub currently
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
   background-permission consent and denial, Wayland clipboard/session behavior,
   and host Tailscale HTTPS access require additional acceptance testing. The
   headless X11 and D-Bus fixture results do not certify these interactions.
5. **Release visibility:** v1.5.0 remains a draft. Production manifest release
   URLs cannot be fetched anonymously until the release is deliberately
   published. Local-source CI builds validate runtime behavior without making
   that release public. No publication is authorized by this readiness check.

The final reviewer decides inclusion, including desktop usefulness, development
history, host-dependency requirements, licensing, screenshots and metadata quality.
The app has a full desktop file/clipboard UI rather than being tray-only, but this
does not guarantee acceptance.

## Sources

Checked against the official documentation during this cloud task:

* [GitHub fine-grained PAT limitations](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens-limitations)
* [Flathub requirements](https://docs.flathub.org/docs/for-app-authors/requirements/),
  especially application ID, offline/source builds and generative AI policy
* [Flathub submission procedure](https://docs.flathub.org/docs/for-app-authors/submission/)
* [Official metadata guidelines](https://docs.flathub.org/docs/for-app-authors/metainfo-guidelines/)
