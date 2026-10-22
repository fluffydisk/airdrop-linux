#!/usr/bin/env bash
set -euo pipefail

# Runner images use both classic and deb822 source files. Avoid the Azure
# mirror's slow downloads without changing suites, signing keys or verification.
for source in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
  [[ -f "$source" ]] || continue
  sed -i 's|https\?://azure\.archive\.ubuntu\.com/ubuntu|https://archive.ubuntu.com/ubuntu|g' "$source"
done
