# Native installer 1.5.1 update verification

Published release: https://github.com/fluffydisk/airdrop-linux/releases/tag/v1.5.1
Immutable tag/payload source: `854bad6b368c0e5e951fa363e21428797e65e716`.
Existing v1.5.0 and its 27 assets were retained unchanged by this publication.
The independent signed Flatpak repository is a separate update channel.

- Local unit suite: 120 passed, no skips (evidence/native-1.5.1/unit.log).
- Native x64 and ARM64 builds, DEB installation and Electron tests passed in
  https://github.com/fluffydisk/airdrop-linux/actions/runs/40753724150 .
- Draft verification and publication/public verification passed in
  https://github.com/fluffydisk/airdrop-linux/actions/runs/40755915549 .
- Real published v1.5.0 ZIP bytes were upgraded to real v1.5.1 ZIP bytes in an
  isolated x64 installation. Both architecture ZIP checksums were verified.
- Updated backend HTTP upload/download and ZIP passed after activation. Health
  during activation checks version and verifies maintenance denies writes.
- Shared file, config and desktop/node-state retention fixtures survived;
  the updater kept a complete 1.5.0 application backup.
- Service-management callbacks were controlled; physical desktop restart,
  authorization dialogs and an authenticated Tailscale account were not tested.
- Independent public-feed checks from the cloud returned `available`, target
  `1.5.1`, for installed `1.5.0` on x64 and ARM64. The updater library is byte
  identical to v1.5.0 (`b791a63671e79472b026390c04a5efb8237d2ac7` Git blob).

SHA-256 of the actual update ZIPs:

```
30ffc803b750e55ae9f0a4375ff4503594cad55ea15428150cae07d38f64d827  airdrop-linux-x64-1.5.1.zip
e331f42a9ac0fb28ea38a355190b70830ef21b8b605718940859bb8b579290c2  airdrop-linux-arm64-1.5.1.zip
```

Original failure logs are retained: the draft REST-by-tag endpoint returned 404
(drafts require authenticated listing/ID lookup), and a transfer assertion inside
activation encountered the expected maintenance guard. The test now verifies
that guard and performs actual transfers after activation. An initial version
file transfer mismatch was corrected before the immutable version tag was made.
No published release asset or existing tag was overwritten to recover these runs.

Normal script installations: Settings > Check for updates > Update. Follow the
application restart/authorization instructions. APT/RPM installations use their
package manager; publishing these GitHub assets does not by itself update signed
APT/RPM repository metadata. Existing package repositories remain separate and
protected by their existing production-signing environment.
