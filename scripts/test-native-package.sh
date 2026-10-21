#!/usr/bin/env bash
# Runs inside disposable distribution test containers only.
set -euo pipefail
case "${PACKAGE_FORMAT:?}" in
  apt) apt-get update; DEBIAN_FRONTEND=noninteractive apt-get install -y ./release/*amd64.deb ;;
  dnf) dnf install -y ./release/*x86_64.rpm ;;
  zypper) zypper --non-interactive install --allow-unsigned-rpm ./release/*x86_64.rpm ;;
  *) exit 1 ;;
esac
# These are local unsigned build artifacts. Published repository tests separately
# require package + metadata signatures; no repository checks are disabled here.
export NODE_PATH=/usr/lib/airdrop-linux/server/node_modules
/usr/lib/airdrop-linux/runtime/node scripts/smoke-managed.js
mkdir -p /root/.local/share/airdrop/files
printf 'preserve me\n' > /root/.local/share/airdrop/files/retain.txt
case "$PACKAGE_FORMAT" in
  apt) apt-get remove -y airdrop-linux ;;
  dnf) dnf remove -y airdrop-linux ;;
  zypper) zypper --non-interactive remove airdrop-linux ;;
esac
test "$(cat /root/.local/share/airdrop/files/retain.txt)" = 'preserve me'
test ! -e /usr/lib/airdrop-linux/runtime/node
