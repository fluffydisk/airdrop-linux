#!/usr/bin/env bash
# Run only inside disposable distribution containers; no production credentials.
set -euo pipefail
umask 022
base=https://fluffydisk.github.io/airdrop-linux
case "${PACKAGE_FORMAT:?}" in
  apt)
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg gawk
    ;;
  dnf) dnf install -y ca-certificates curl gnupg2 gawk ;;
  zypper) zypper --non-interactive install ca-certificates curl gpg2 gawk ;;
  *) exit 2 ;;
esac
curl -fsSL "$base/airdrop-linux.gpg" -o /tmp/airdrop-linux.gpg
fingerprint=$(gpg --batch --with-colons --show-keys /tmp/airdrop-linux.gpg | awk -F: '$1=="fpr" {print $10;exit}')
test "$fingerprint" = 6513D70958397F60D3787A0CB93F4FC1E97CF3AE
case "$PACKAGE_FORMAT" in
  apt)
    install -Dm644 /tmp/airdrop-linux.gpg /etc/apt/keyrings/airdrop-linux.gpg
    printf 'deb [signed-by=/etc/apt/keyrings/airdrop-linux.gpg] %s/apt stable main\n' "$base" > /etc/apt/sources.list.d/airdrop-linux.list
    apt-get update
    apt-get install -y airdrop-linux
    test "$(dpkg-query -W -f='${Version}' airdrop-linux)" = 1.5.0-1
    ;;
  dnf|zypper)
    curl -fsSL "$base/airdrop-linux.asc" -o /tmp/airdrop-linux.asc
    rpm --import /tmp/airdrop-linux.asc
    if [[ "$PACKAGE_FORMAT" == dnf ]]; then repo=/etc/yum.repos.d; else repo=/etc/zypp/repos.d; fi
    mkdir -p "$repo"
    cat > "$repo/airdrop-linux.repo" <<'EOF'
[airdrop-linux]
name=Airdrop Linux
baseurl=https://fluffydisk.github.io/airdrop-linux/rpm/$basearch
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=https://fluffydisk.github.io/airdrop-linux/airdrop-linux.asc
EOF
    if [[ "$PACKAGE_FORMAT" == dnf ]]; then
      dnf install -y airdrop-linux
    else
      zypper --non-interactive --gpg-auto-import-keys refresh
      zypper --non-interactive install airdrop-linux
    fi
    test "$(rpm -q --qf '%{VERSION}-%{RELEASE}' airdrop-linux)" = 1.5.0-1
    ;;
esac
export NODE_PATH=/usr/lib/airdrop-linux/server/node_modules
export AIRDROP_SMOKE_HOME=/root/.local/share/airdrop
# Starting the backend twice also checks graceful shutdown and port reuse.
/usr/lib/airdrop-linux/runtime/node scripts/smoke-managed.js
identity_before=$(sha256sum "$AIRDROP_SMOKE_HOME/config/server.env")
/usr/lib/airdrop-linux/runtime/node scripts/smoke-managed.js
test "$(sha256sum "$AIRDROP_SMOKE_HOME/config/server.env")" = "$identity_before"
mkdir -p /root/.local/share/airdrop/files /root/.local/share/airdrop/config
printf 'preserve files\n' > /root/.local/share/airdrop/files/retain.txt
printf 'preserve preferences\n' > /root/.local/share/airdrop/config/retain.txt
case "$PACKAGE_FORMAT" in
  apt) apt-get install --reinstall -y airdrop-linux; apt-get install --only-upgrade -y airdrop-linux ;;
  dnf) dnf reinstall -y airdrop-linux; dnf upgrade -y airdrop-linux ;;
  zypper) zypper --non-interactive install --force airdrop-linux; zypper --non-interactive update airdrop-linux ;;
esac
test "$(cat /root/.local/share/airdrop/files/retain.txt)" = 'preserve files'
test "$(cat /root/.local/share/airdrop/config/retain.txt)" = 'preserve preferences'
test "$(sha256sum "$AIRDROP_SMOKE_HOME/config/server.env")" = "$identity_before"
case "$PACKAGE_FORMAT" in
  apt) apt-get remove -y airdrop-linux ;;
  dnf) dnf remove -y airdrop-linux ;;
  zypper) zypper --non-interactive remove airdrop-linux ;;
esac
test "$(cat /root/.local/share/airdrop/files/retain.txt)" = 'preserve files'
test "$(cat /root/.local/share/airdrop/config/retain.txt)" = 'preserve preferences'
test "$(sha256sum "$AIRDROP_SMOKE_HOME/config/server.env")" = "$identity_before"
test ! -e /usr/lib/airdrop-linux/runtime/node
echo 'Published repository: signed install, UI endpoint, file/ZIP transfer, backend restart, same-version reinstall/update and data-preserving removal passed.'
