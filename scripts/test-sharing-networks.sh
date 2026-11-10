#!/usr/bin/env bash
set -euo pipefail
# Requires root in a disposable Linux VM. Never run against host interfaces.
test "$(id -u)" = 0 || { echo 'Run in a disposable VM with network-namespace privileges.' >&2; exit 1; }
repo=$(cd "$(dirname "$0")/.." && pwd)
run_root=$(mktemp -d)
prefix="adsh$$"
a="$prefix-a"; b="$prefix-b"; r="$prefix-relay"
cleanup() {
  for ns in "$a" "$b" "$r"; do
    for pid in $(ip netns pids "$ns" 2>/dev/null); do kill "$pid" 2>/dev/null || true; done
    ip netns del "$ns" 2>/dev/null || true
  done
  rm -rf "$run_root"
}
trap cleanup EXIT
for ns in "$a" "$b" "$r"; do ip netns add "$ns"; ip -n "$ns" link set lo up; done
ip link add "${prefix}a" type veth peer name "${prefix}b"
ip link set "${prefix}a" netns "$a"; ip link set "${prefix}b" netns "$b"
ip -n "$a" link set "${prefix}a" name eth0; ip -n "$b" link set "${prefix}b" name eth0
ip -n "$a" address add 10.77.1.2/24 dev eth0; ip -n "$b" address add 10.77.1.3/24 dev eth0
ip -n "$a" link set eth0 up; ip -n "$b" link set eth0 up
for side in a b; do
  if test "$side" = a; then ns="$a"; subnet=3; else ns="$b"; subnet=4; fi
  ip link add "${prefix}u$side" type veth peer name "${prefix}r$side"
  ip link set "${prefix}u$side" netns "$ns"; ip link set "${prefix}r$side" netns "$r"
  ip -n "$ns" link set "${prefix}u$side" name uplink
  ip -n "$r" link set "${prefix}r$side" name "relay$side"
  ip -n "$ns" address add "10.77.$subnet.2/24" dev uplink
  ip -n "$r" address add "10.77.$subnet.1/24" dev "relay$side"
  ip -n "$ns" link set uplink up; ip -n "$r" link set "relay$side" up
done
ip netns exec "$a" env NO_PROXY='*' node "$repo/tests/sharing-network-peer.cjs" server "$run_root" > "$run_root/server.log" 2>&1 &
for attempt in $(seq 1 150); do test -f "$run_root/server.json" && break; sleep 0.1; done
test -f "$run_root/server.json" || { cat "$run_root/server.log"; exit 1; }
ip netns exec "$b" env NO_PROXY='*' node "$repo/tests/sharing-network-peer.cjs" normal "$run_root"
# Drop multicast on both peers while leaving authenticated TCP available.
for ns in "$a" "$b"; do
  ip netns exec "$ns" nft add table inet sharing_fixture
  ip netns exec "$ns" nft 'add chain inet sharing_fixture input { type filter hook input priority 0; policy accept; }'
  ip netns exec "$ns" nft add rule inet sharing_fixture input udp dport 5353 drop
done
ip netns exec "$b" env NO_PROXY='*' node "$repo/tests/sharing-network-peer.cjs" cached "$run_root"
# Deny peer TCP on the AP-facing link. The separate permitted relay remains
# reachable on each peer's uplink; it grants no direct peer route or forwarding.
ip netns exec "$a" nft add rule inet sharing_fixture input iifname eth0 meta l4proto tcp drop
ip netns exec "$r" env NO_PROXY='*' node "$repo/tests/sharing-network-peer.cjs" relay "$run_root" > "$run_root/relay.log" 2>&1 &
for attempt in $(seq 1 100); do test -f "$run_root/relay-ready" && break; sleep 0.1; done
test -f "$run_root/relay-ready"
ip netns exec "$b" env NO_PROXY='*' node "$repo/tests/sharing-network-peer.cjs" isolated "$run_root"
