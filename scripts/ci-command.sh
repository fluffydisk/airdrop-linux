#!/usr/bin/env bash
# Mirror test failures into check annotations when log-download hosts are unavailable.
set -uo pipefail
label=${1:?Usage: ci-command.sh LABEL COMMAND...}
shift
[[ "$label" =~ ^[A-Za-z0-9_-]+$ && $# -gt 0 ]] || exit 2
log=$(mktemp)
trap 'rm -f "$log"' EXIT
"$@" 2>&1 | tee "$log"
pipeline_status=("${PIPESTATUS[@]}")
status=${pipeline_status[0]}
if (( status == 0 && pipeline_status[1] != 0 )); then status=${pipeline_status[1]}; fi
if (( status )); then
  # GitHub annotations are size-limited. Keep the end (the actual error),
  # instead of letting long source-fetch progress truncate it off the front.
  message=$(tail -20 "$log" | tail -c 2200)
  message=${message//%/%25}
  message=${message//$'\r'/%0D}
  message=${message//$'\n'/%0A}
  printf '::error title=%s::%s\n' "$label" "$message"
fi
exit "$status"
