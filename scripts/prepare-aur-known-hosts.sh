#!/usr/bin/env bash
# AUR publishes this Ed25519 fingerprint over HTTPS at https://aur.archlinux.org/.
# Checked 2026-10-22. A scan alone is never a trust decision.
set -euo pipefail
destination=${1:?Usage: prepare-aur-known-hosts.sh OUTPUT}
umask 077
if [[ -n "${AUR_KNOWN_HOSTS:-}" ]]; then
  printf '%s\n' "$AUR_KNOWN_HOSTS" > "$destination"
else
  ssh-keyscan -T 15 -t ed25519 aur.archlinux.org > "$destination"
  fingerprint=$(ssh-keygen -lf "$destination" -E sha256 | awk '{print $2}' | LC_ALL=C sort -u)
  if [[ "$fingerprint" != 'SHA256:RFzBCUItH9LZS0cKB5UE6ceAYhBD5C8GeOBip8Z11+4' ]]; then
    echo '::error::AUR SSH host key does not match the pinned official Ed25519 fingerprint'
    rm -f "$destination"
    exit 1
  fi
fi
echo 'AUR SSH known_hosts prepared; strict host-key checking remains enabled.'
