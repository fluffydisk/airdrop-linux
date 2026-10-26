#!/usr/bin/env bash
set -euo pipefail

# Runner images use classic sources, deb822 sources and an external mirrorlist.
# Avoid the Azure
# mirror's slow downloads without changing suites, signing keys or verification.
for source in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources /etc/apt/apt-mirrors.txt; do
  [[ -f "$source" ]] || continue
  sed -i 's|https\?://azure\.archive\.ubuntu\.com/ubuntu|https://archive.ubuntu.com/ubuntu|g' "$source"
done
