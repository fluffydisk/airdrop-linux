#!/usr/bin/env bash
# Headless native Wayland startup; not interactive portal/clipboard acceptance.
set -euo pipefail
if [[ "${1:-}" != --session ]]; then
  # D-Bus activation inherits the environment when its daemon starts. Creating
  # XDG_RUNTIME_DIR afterwards makes Flatpak's spawn portal look in the wrong
  # instance directory and reject Zypak's requesting PID.
  session_runtime=$(mktemp -d)
  chmod 700 "$session_runtime"
  trap 'rm -rf "$session_runtime"' EXIT
  XDG_RUNTIME_DIR="$session_runtime" WAYLAND_DISPLAY=airdrop-test-wayland AIRDROP_TEST_WAYLAND=1 \
    xvfb-run -a dbus-run-session -- bash "$0" --session
  exit "$?"
fi
compositor_pid=
cleanup() {
  if [[ -n "$compositor_pid" ]]; then
    kill "$compositor_pid" 2>/dev/null || true
    wait "$compositor_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
# The nested X11 backend supplies a virtual keyboard/pointer seat. The app
# itself has DISPLAY removed and connects exclusively through Wayland.
weston --backend=x11 --renderer=pixman --width=1280 --height=960 --socket="$WAYLAND_DISPLAY" --idle-time=0 > "$XDG_RUNTIME_DIR/weston.log" 2>&1 &
compositor_pid=$!
for ((i=0;i<100;i++)); do
  [[ ! -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]] || break
  if ! kill -0 "$compositor_pid" 2>/dev/null; then cat "$XDG_RUNTIME_DIR/weston.log"; exit 1; fi
  sleep 0.1
done
test -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY"
status=0
DEBUG=pw:browser timeout --signal=TERM --kill-after=10s 150s node scripts/smoke-sandbox-desktop.cjs flatpak > "$XDG_RUNTIME_DIR/browser.log" 2>&1 || status=$?
cat "$XDG_RUNTIME_DIR/browser.log"
if (( status )); then
  python3 - "$XDG_RUNTIME_DIR/browser.log" <<'PY'
import pathlib, sys
lines=pathlib.Path(sys.argv[1]).read_text().splitlines()
message='\n'.join(lines[-50:])[-2500:]
print('::error title=Wayland browser diagnostics::'+message.replace('%','%25').replace('\r','%0D').replace('\n','%0A'))
PY
  tail -n 8 "$XDG_RUNTIME_DIR/weston.log"
fi
exit "$status"
