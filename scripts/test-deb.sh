#!/bin/sh
# Runs only in a disposable Debian/Ubuntu test container or VM.
set -eu
if [ "${AIRDROP_DISPOSABLE_TEST:-}" != yes ]; then
  echo 'Refusing package installation outside an explicitly disposable test system.' >&2
  exit 1
fi
package=${1:?DEB package path required}
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends "$package" curl binutils dbus-x11
version=$(dpkg-query -W -f='${Version}' airdrop-linux)
test "$version" = 1.5.0
/usr/bin/python3 -m py_compile /opt/airdrop/system/core.py /opt/airdrop/system/bridge.py
test "$(stat -c %U /opt/airdrop/desktop/Airdrop)" = root
id airdrop-test >/dev/null 2>&1 || useradd -m -s /bin/sh airdrop-test
runuser -u airdrop-test -- env AIRDROP_HOME=/home/airdrop-test/data AIRDROP_APP_DIR=/opt/airdrop /opt/airdrop/runtime/node /opt/airdrop/server/scripts/user-service.js --init
runuser -u airdrop-test -- env AIRDROP_HOME=/home/airdrop-test/data AIRDROP_APP_DIR=/opt/airdrop /opt/airdrop/runtime/node /opt/airdrop/server/scripts/user-service.js >/tmp/airdrop-service.log 2>&1 &
service_pid=$!
trap 'kill "$service_pid" 2>/dev/null || true' EXIT
attempt=0
until curl -fsS http://127.0.0.1:6001/push/health >/dev/null; do
  attempt=$((attempt + 1)); [ "$attempt" -lt 40 ] || { cat /tmp/airdrop-service.log; exit 1; }
  sleep 1
done
curl -fsS http://127.0.0.1:6001/ui/ >/dev/null
curl -fsS -X PUT --data 'preserved package test' 'http://127.0.0.1:6001/push/explorer/file?name=preserve.txt' >/dev/null
curl -fsS -X POST -H 'Content-Type: application/json' --data '{"name":"Nested"}' http://127.0.0.1:6001/push/explorer/directories >/dev/null
curl -fsS -X PUT --data 'nested data' 'http://127.0.0.1:6001/push/explorer/file?directory=Nested&name=test.txt' >/dev/null
sha256sum /home/airdrop-test/data/config/server.env > /tmp/credentials.sha256
kill "$service_pid" 2>/dev/null || true
wait "$service_pid" || true
trap - EXIT
apt-get remove -y airdrop-linux
sha256sum --check /tmp/credentials.sha256
test "$(cat /home/airdrop-test/data/files/preserve.txt)" = 'preserved package test'
apt-get install -y --no-install-recommends "$package"
sha256sum --check /tmp/credentials.sha256
test "$(cat /home/airdrop-test/data/files/Nested/test.txt)" = 'nested data'
echo "Package install, server, nested upload, removal and reinstall passed: $version"
