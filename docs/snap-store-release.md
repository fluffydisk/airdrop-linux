# Snap v1.5.0 Store acceptance and promotion

The `snap-store` mode of `store-submissions.yml` reuses the exact `.snap` files
from the reviewed v1.5.0 candidate producer. It does not rebuild or replace
release assets. Both producer build/test jobs must have succeeded. An upload
failure caused by Store review does not invalidate those tests, but Store
acceptance cannot pass until both exact artifacts are released to candidate.
The producer commit is pinned to the PR #9 tree, subsequently
squash-merged into main; accepting a different release requires reviewing and
updating this explicit provenance gate.

Dispatch with `tag=v1.5.0`, `channel=snap-store`, and the locally validated candidate
producer's run ID. `promote_stable=false` performs candidate acceptance only;
`promote_stable=true` also releases the verified revisions after both native
architecture checks pass, then independently installs and tests stable.

Each native Ubuntu 24.04 amd64/ARM64 VM:

1. Enables snapd's user-daemon support and initializes the normal user's session.
2. Installs `airdrop-linux` from the requested Store channel using normal Store
   assertions and confinement. No `--dangerous`, `--devmode`, or `--classic` is
   used for the application; no interface is manually connected.
3. Requires version 1.5.0, the requested tracking channel, strict confinement,
   and byte-for-byte identity with the locally tested producer artifact.
4. Exercises CLI help, backend readiness, UI HTTP endpoint, upload/download and
   ZIP contents, then sandbox-enabled foreground/background desktop lifecycle
   and managed-update behavior. The tests come from the immutable v1.5.0 tag,
   matching that release's application identity.
5. Retains a JSON record containing architecture, Store revision, SHA-256,
   producer run and channel only after all application tests pass.

Stable promotion reads both successful candidate records and releases those
exact revisions. Stable installation must also match the candidate revision and
hash. Tests have no Store credentials; only the release job receives the scoped
`snap-publishing` secret. Concurrent promotions of this tag are serialized.

The first Store upload may require review of the declared browser sandbox
interface. A pending review is a publication blocker: do not disable Chromium's
sandbox, relax confinement, manually grant interfaces in Store acceptance tests,
or claim Store installation succeeded before this gate passes.
