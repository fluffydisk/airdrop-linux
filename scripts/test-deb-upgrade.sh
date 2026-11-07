#!/usr/bin/env bash
# Only run on the disposable GitHub runner, before installing the candidate.
set -euo pipefail
: "${RUNNER_TEMP:?This acceptance test requires a disposable CI runner}"
previous=1.6.8
architecture=$(dpkg --print-architecture)
work=$(mktemp -d "$RUNNER_TEMP/airdrop-deb-upgrade.XXXXXX")
asset="airdrop-linux_${previous}-1_${architecture}.deb"
gh release download "v$previous" --repo fluffydisk/airdrop-linux --pattern "$asset" --pattern SHA256SUMS --dir "$work"
(cd "$work" && awk -v asset="$asset" '$2 == asset {print}' SHA256SUMS > selected.sha256 && test -s selected.sha256 && sha256sum --check selected.sha256)
sudo apt-get install -y "$work/$asset"
test "$(dpkg-query -W -f='${Version}' airdrop-linux)" = "$previous-1"
export AIRDROP_UPGRADE_ROOT="$work/user-data"
export AIRDROP_EXPECT_VERSION="$previous"
xvfb-run -a dbus-run-session -- node scripts/test-installed-upgrade.cjs
sudo apt-get install -y ./release/*_"$architecture".deb
export AIRDROP_EXPECT_VERSION=$(node -p 'require("./package.json").version')
test "$(dpkg-query -W -f='${Version}' airdrop-linux)" = "$AIRDROP_EXPECT_VERSION-1"
xvfb-run -a dbus-run-session -- node scripts/test-installed-upgrade.cjs
printf 'Verified installed DEB upgrade: %s -> %s (%s), same retained user data and sandboxed desktop\n' "$previous" "$AIRDROP_EXPECT_VERSION" "$architecture"
