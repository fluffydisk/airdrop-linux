#!/usr/bin/env bash
# Runs only in the disposable official Arch base-devel validation container.
set -euo pipefail
pacman -Syu --noconfirm --needed sudo nodejs
useradd --create-home builder
printf 'builder ALL=(root) NOPASSWD: /usr/bin/pacman\n' > /etc/sudoers.d/airdrop-builder
chmod 0440 /etc/sudoers.d/airdrop-builder
mkdir -p /tmp/airdrop-aur-build
cp release/local-submissions/aur/PKGBUILD /tmp/airdrop-aur-build/
cp release/local-submissions/aur/.SRCINFO /tmp/airdrop-aur-build/expected.SRCINFO
chown -R builder:builder /tmp/airdrop-aur-build
runuser -u builder -- bash <<'BUILD'
set -euo pipefail
cd /tmp/airdrop-aur-build
makepkg --syncdeps --noconfirm
makepkg --printsrcinfo > actual.SRCINFO
# SRCINFO field ordering is immaterial; every field and value must match.
diff -u <(sed '/^[[:space:]]*$/d;s/^[[:space:]]*//' expected.SRCINFO | LC_ALL=C sort) <(sed '/^[[:space:]]*$/d;s/^[[:space:]]*//' actual.SRCINFO | LC_ALL=C sort)
BUILD
cp /tmp/airdrop-aur-build/airdrop-linux-bin-*.pkg.tar.zst release/
PACKAGE_FORMAT=pacman bash scripts/test-native-package.sh
