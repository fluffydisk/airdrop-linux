#!/usr/bin/env bash
# Headless native Wayland startup; not interactive portal/clipboard acceptance.
set -euo pipefail
export XDG_RUNTIME_DIR
XDG_RUNTIME_DIR=$(mktemp -d)
chmod 700 "$XDG_RUNTIME_DIR"
export WAYLAND_DISPLAY=airdrop-test-wayland
export AIRDROP_TEST_WAYLAND=1
compositor_pid=
cleanup() {
  if [[ -n "$compositor_pid" ]]; then
    kill "$compositor_pid" 2>/dev/null || true
    wait "$compositor_pid" 2>/dev/null || true
  fi
  rm -rf "$XDG_RUNTIME_DIR"
}
trap cleanup EXIT
weston --backend=headless --renderer=pixman --socket="$WAYLAND_DISPLAY" --idle-time=0 > "$XDG_RUNTIME_DIR/weston.log" 2>&1 &
compositor_pid=$!
for ((i=0;i<100;i++)); do
  [[ ! -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]] || break
  if ! kill -0 "$compositor_pid" 2>/dev/null; then cat "$XDG_RUNTIME_DIR/weston.log"; exit 1; fi
  sleep 0.1
done
test -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY"
node scripts/smoke-sandbox-desktop.cjs flatpak
