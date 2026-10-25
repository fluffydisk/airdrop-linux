# GitHub Flatpak v1.5.0 revision r1

Historical pre-device-sharing r1 record. See [the published r2 device-sharing report](flatpak-device-sharing-r2.md) for current GitHub Flatpak behavior and evidence. Earlier logs and Flathub policy findings remain preserved.

The x86_64 bundle is published as an additional asset on the existing v1.5.0
GitHub Release. This is independent upstream distribution, not a Flathub listing.
The 23 pre-existing assets retained their IDs, sizes and update timestamps.

- [Installable bundle](https://github.com/fluffydisk/airdrop-linux/releases/download/v1.5.0/airdrop-linux-1.5.0-x86_64-reference-r1.flatpak)
- [SHA-256 file](https://github.com/fluffydisk/airdrop-linux/releases/download/v1.5.0/airdrop-linux-1.5.0-x86_64-reference-r1.flatpak.sha256)
- [Successful publication and validation run](https://github.com/fluffydisk/airdrop-linux/actions/runs/40225505728)

Bundle size: 112,688,712 bytes. SHA-256:

```text
bcea10226355215fcd22efaf8f34655f084d6dd5ee9864696f0450a1bb1cff66
```

The existing reference and local 94/94 test baseline were reused. The publication
job built the pinned recipe with the native sandboxed builder, ran package lint
and installed functional checks, exported a bundle, then installed and tested
that bundle before upload. Both the job and a separate anonymous download from
the development environment verified the published file's checksum. The job's
evidence artifact records detailed test scope, including any host-unit skips.

The local upload endpoint rejected credentials. The repository's own Actions
token performed publication instead; no user token was requested. Two earlier
SDK Builder attempts failed on runtime-directory/nested namespace restrictions;
the native build succeeded without disabling build isolation or Chromium's
sandbox. Failure records remain available in the corresponding workflow runs.

This revision includes Electron 44.9.3 and body-parser 1.20.9. Electron remains an
official prebuilt runtime. Cross-device sharing still requires host Tailscale,
tailnet HTTPS and Serve; local file/clipboard features work without it. These
limitations do not imply a Flathub policy exception. Physical desktop and actual
two-device acceptance remain separate from headless/controlled checks.

See the README for Omarchy installation and data-preserving removal instructions.
