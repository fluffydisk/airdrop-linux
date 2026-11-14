#!/usr/bin/env bash
# Development only. No sudo, network reconfiguration or automatic uploading.
set -euo pipefail
lab_script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
lab_node=${AIRDROP_LAB_NODE:-node}
if ! command -v "$lab_node" >/dev/null 2>&1; then
  echo 'Node.js is missing. Install Node 26 from nodejs.org or your development version manager, then retry.' >&2
  exit 1
fi
exec "$lab_node" "$lab_script_dir/quickshare-android-lab.cjs" "$@"
