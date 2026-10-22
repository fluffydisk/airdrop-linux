#!/usr/bin/env bash
# Direct SDK build commands for technical verification, not a store manifest.
set -euo pipefail
work_root=$(realpath "${1:?Usage: build-in-sdk.sh WORK_ROOT COMMAND...}")
shift
test "$#" -gt 0
repo_root=$(cd "$(dirname "$0")/.." && pwd)
sdk_build="$work_root/sdk-build"
if [[ ! -e "$sdk_build" ]]; then
  flatpak build-init \
    --sdk-extension=org.freedesktop.Sdk.Extension.rust-stable \
    --sdk-extension=org.freedesktop.Sdk.Extension.node24 \
    "$sdk_build" io.github.fluffydisk.airdrop-linux \
    org.freedesktop.Sdk org.freedesktop.Platform 26.08
fi
exec flatpak build --unshare=network \
  --filesystem="$work_root":rw --filesystem="$repo_root":ro \
  --env=PATH=/usr/lib/sdk/node24/bin:/usr/lib/sdk/rust-stable/bin:/usr/bin \
  --env=CARGO_HOME="$work_root/cargo-home" \
  --env=GITHUB_SHA="${GITHUB_SHA:-}" \
  "$sdk_build" "$@"
