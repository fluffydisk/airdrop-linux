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
status=0
DEBUG=pw:browser node scripts/smoke-sandbox-desktop.cjs flatpak > "$XDG_RUNTIME_DIR/browser.log" 2>&1 || status=$?
cat "$XDG_RUNTIME_DIR/browser.log"
if (( status )); then
  python3 - "$XDG_RUNTIME_DIR/browser.log" <<'PY'
import pathlib, sys
lines=pathlib.Path(sys.argv[1]).read_text().splitlines()
selected=[line for line in lines if any(word in line.lower() for word in ['error', 'failed', 'wayland', 'ozone', '[err]', 'listening', '<launching>'])]
message='\n'.join(selected[-80:] or lines[-80:])[-40000:]
print('::error title=Wayland browser diagnostics::'+message.replace('%','%25').replace('\r','%0D').replace('\n','%0A'))
PY
  tail -n 8 "$XDG_RUNTIME_DIR/weston.log"
fi
exit "$status"
