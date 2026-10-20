#!/usr/bin/env bash
# Stand-alone installer: download one verified native bundle, never build Electron.
set -Eeuo pipefail
usage() { printf 'Usage: bash install-prebuilt.sh [--version X.Y.Z]\nDownloads the stable Linux bundle and installs Airdrop without local compilation.\nRun as your normal user; system setup may request sudo and Tailscale login.\n'; }
release_version=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --version) [[ $# -ge 2 ]] || { usage >&2; exit 2; }; release_version="${2#v}"; shift 2 ;;
    *) usage >&2; exit 2 ;;
  esac
done
[[ "$(uname -s)" == Linux && "$(id -u)" -ne 0 ]] || { printf 'Run on Linux as a normal user.\n' >&2; exit 1; }
case "$(uname -m)" in x86_64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) printf 'Prebuilt downloads support x64 and arm64 only.\n' >&2; exit 1 ;; esac
for command in curl tar sha256sum awk mktemp rm mkdir; do
  command -v "$command" >/dev/null || { printf 'Required tool missing: %s\n' "$command" >&2; exit 1; }
done
repo='https://github.com/fluffydisk/airdrop-linux'
if [[ -z "$release_version" ]]; then
  latest_url="$(curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 20 --max-time 60 --output /dev/null --write-out '%{url_effective}' "$repo/releases/latest")"
  [[ "$latest_url" == "$repo/releases/tag/"* ]] || { printf 'No stable release is available.\n' >&2; exit 1; }
  release_version="${latest_url##*/}"; release_version="${release_version#v}"
fi
[[ "$release_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { printf 'Invalid stable version.\n' >&2; exit 2; }
base="$repo/releases/download/v$release_version"
bundle="airdrop-bundle-linux-$arch-$release_version.tar.gz"
work="$(mktemp -d)"; trap 'rm -rf -- "$work"' EXIT
printf 'Downloading Airdrop %s (%s), no local build required...\n' "$release_version" "$arch"
fetch() { curl --fail --silent --show-error --location --retry 3 --proto '=https' --proto-redir '=https' --connect-timeout 20 --max-time 900 "$base/$1" --output "$work/$1"; }
fetch SHA256SUMS
expected="$(awk -v name="$bundle" '$2 == name && $1 ~ /^[a-f0-9]+$/ && length($1) == 64 { print $1 }' "$work/SHA256SUMS")"
[[ "$expected" =~ ^[a-f0-9]{64}$ ]] || { printf 'Release checksum is missing or ambiguous.\n' >&2; exit 1; }
fetch "$bundle"
printf '%s  %s\n' "$expected" "$work/$bundle" | sha256sum --check --status || { printf 'Bundle checksum mismatch. Nothing installed.\n' >&2; exit 1; }
# No links, absolute paths, parent traversal, or special files in install bundles.
tar -tzf "$work/$bundle" > "$work/entries"
awk 'BEGIN { valid=1 } { n=split($0,p,"/"); if(p[1]!="airdrop")valid=0; for(i=1;i<=n;i++)if(p[i]==".."||p[i]==".")valid=0; if(index($0,"\\"))valid=0 } END { exit !valid }' "$work/entries" || { printf 'Unsafe bundle paths.\n' >&2; exit 1; }
tar -tvzf "$work/$bundle" | awk 'substr($0,1,1)!="-" && substr($0,1,1)!="d" { bad=1 } END { exit bad }' || { printf 'Unsupported bundle entries.\n' >&2; exit 1; }
mkdir "$work/extracted"
tar -xzf "$work/$bundle" --no-same-owner --no-same-permissions -C "$work/extracted"
source_root="$work/extracted/airdrop"
[[ -f "$source_root/install.sh" && -d "$source_root/prebuilt/app/desktop" ]] || { printf 'Incomplete release bundle.\n' >&2; exit 1; }
export AIRDROP_PREBUILT_DIR="$source_root/prebuilt"
bash "$source_root/install.sh"
