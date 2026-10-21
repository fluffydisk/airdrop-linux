#!/usr/bin/env bash
# Runs inside disposable distribution test containers only.
set -euo pipefail
case "${PACKAGE_ARCH:-x64}" in
  x64) deb_arch=amd64; rpm_arch=x86_64 ;;
  arm64) deb_arch=arm64; rpm_arch=aarch64 ;;
  *) exit 1 ;;
esac
case "${PACKAGE_FORMAT:?}" in
  apt) apt-get update; DEBIAN_FRONTEND=noninteractive apt-get install -y ./release/*_"$deb_arch".deb ;;
  dnf) dnf install -y ./release/*."$rpm_arch".rpm ;;
  zypper) zypper --non-interactive install --allow-unsigned-rpm ./release/*."$rpm_arch".rpm ;;
  pacman) pacman -U --noconfirm ./release/airdrop-linux-bin-*.pkg.tar.zst ;;
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
  pacman) pacman -R --noconfirm airdrop-linux-bin ;;
esac
test "$(cat /root/.local/share/airdrop/files/retain.txt)" = 'preserve me'
test ! -e /usr/lib/airdrop-linux/runtime/node
