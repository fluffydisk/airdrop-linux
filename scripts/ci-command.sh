#!/usr/bin/env bash
# Mirror test failures into check annotations when log-download hosts are unavailable.
set -uo pipefail
label=${1:?Usage: ci-command.sh LABEL COMMAND...}
shift
[[ "$label" =~ ^[A-Za-z0-9_-]+$ && $# -gt 0 ]] || exit 2
log=$(mktemp)
trap 'rm -f "$log"' EXIT
status=0
"$@" > "$log" 2>&1 || status=$?
cat "$log"
if (( status )); then
  message=$(tail -40 "$log")
  message=${message//%/%25}
  message=${message//$'\r'/%0D}
  message=${message//$'\n'/%0A}
  printf '::error title=%s::%s\n' "$label" "$message"
fi
exit "$status"
