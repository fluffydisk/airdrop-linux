#!/usr/bin/env bash
# Prepare and verify npm source caches, not a Flatpak submission manifest.
set -euo pipefail
umask 022
source_root=$(cd "$(dirname "$0")/.." && pwd)
output=${1:?Usage: prepare-offline-npm.sh NEW_OUTPUT_DIRECTORY}
[[ ! -e "$output" ]] || { echo 'Output directory must be new' >&2; exit 1; }
mkdir -p "$output"
output=$(realpath "$output")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
for component in server desktop; do
  if [[ "$component" == server ]]; then source_dir=$source_root; else source_dir=$source_root/desktop; fi
  mkdir -p "$work/$component" "$output/$component"
  cp "$source_dir/package.json" "$source_dir/package-lock.json" "$work/$component/"
  cp "$source_dir/package.json" "$source_dir/package-lock.json" "$output/$component/"
  (
    cd "$work/$component"
    npm ci --ignore-scripts --omit=dev --no-audit --no-fund --cache "$output/npm-cache"
    rm -rf node_modules
    # A fresh install must work offline even with an unusable registry URL.
    npm ci --offline --ignore-scripts --omit=dev --no-audit --no-fund \
      --fetch-retries=0 --registry=http://127.0.0.1:9 --cache "$output/npm-cache"
    node -e 'for(const name of Object.keys(require("./package.json").dependencies||{}))require(name); console.log("Offline production dependencies load successfully")'
  )
done
(cd "$output" && sha256sum server/package-lock.json desktop/package-lock.json > LOCKFILE-SHA256SUMS)
printf 'Offline npm cache verified at %s\n' "$output"
echo 'Electron, Node and dufs source builds are separate requirements; this cache is not a complete offline Flatpak build.'
