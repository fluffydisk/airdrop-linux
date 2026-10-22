#!/usr/bin/env bash
# Runs on disposable native Actions VMs. No Store credential is needed here.
set -euo pipefail
[[ "$STORE_CHANNEL" == candidate || "$STORE_CHANNEL" == stable ]]
[[ "$STORE_ARCH" == amd64 || "$STORE_ARCH" == arm64 ]]
[[ "$PRODUCER_RUN" =~ ^[0-9]+$ ]]
root=$PWD
shopt -s nullglob
artifacts=(validated/*.snap)
test "${#artifacts[@]}" = 1
expected_hash=$(sha256sum "${artifacts[0]}" | cut -d ' ' -f 1)

sudo snap set system experimental.user-daemons=true
sudo loginctl enable-linger "$(id -un)"
sudo systemctl start "user@$(id -u).service"
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
systemctl --user start snapd.session-agent.socket
# Normal signed Store installation: no local-install or confinement bypass flags.
sudo snap install airdrop-linux --channel="latest/$STORE_CHANNEL"
systemctl --user daemon-reload
read -r version revision tracking < <(snap list --unicode=never airdrop-linux | awk '$1 == "airdrop-linux" {print $2, $3, $4}')
test "$version" = 1.5.0
[[ "$revision" =~ ^[0-9]+$ ]]
test "$tracking" = "latest/$STORE_CHANNEL"
sudo cmp -- "${artifacts[0]}" "/var/lib/snapd/snaps/airdrop-linux_${revision}.snap"
grep -qx 'confinement: strict' /snap/airdrop-linux/current/meta/snap.yaml
if [[ "$STORE_CHANNEL" == stable ]]; then
  test "$revision" = "$(jq -r .revision "candidate-evidence/$STORE_ARCH.json")"
  test "$expected_hash" = "$(jq -r .sha256 "candidate-evidence/$STORE_ARCH.json")"
fi
# Inspect actual Store auto-connections; do not manually grant browser-sandbox.
snap connections airdrop-linux
snap run airdrop-linux.cli --help
test -x /snap/airdrop-linux/current/lib/airdrop-linux/desktop/Airdrop
cd release-source
node scripts/smoke-sandbox.js snap
sudo snap start --users=all airdrop-linux.backend
xvfb-run -a node scripts/smoke-sandbox-desktop.cjs snap background
xvfb-run -a node scripts/smoke-sandbox-desktop.cjs snap
cd "$root"
mkdir -p snap-store-evidence
jq -n --arg arch "$STORE_ARCH" --arg revision "$revision" --arg channel "$STORE_CHANNEL" \
  --arg sha256 "$expected_hash" --arg producer_run "$PRODUCER_RUN" \
  '{arch:$arch,version:"1.5.0",revision:$revision,channel:$channel,sha256:$sha256,producer_run:$producer_run}' \
  > "snap-store-evidence/$STORE_ARCH.json"
printf 'Store %s %s: revision %s, identical tested payload; CLI, transfer, ZIP and sandboxed desktop lifecycle passed.\n' \
  "$STORE_CHANNEL" "$STORE_ARCH" "$revision" >> "$GITHUB_STEP_SUMMARY"
