#!/usr/bin/env bash
# Optional per-user GUI installation; the main installer must be run first.
set -Eeuo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${1:-}" == '--help' ]]; then
  printf 'Usage: ./install-desktop.sh [--prebuilt ABSOLUTE_DIRECTORY]\nBuilds and installs the optional Linux Electron application for this user.\n'
  exit 0
fi
[[ "$(uname -s)" == Linux && "$(id -u)" -ne 0 ]] || { printf 'Run as a normal Linux user.\n' >&2; exit 1; }
prebuilt_source=''
if [[ "${1:-}" == '--prebuilt' && $# == 2 && "$2" == /* ]]; then
  prebuilt_source="$2"
elif [[ $# != 0 ]]; then
  printf 'Use --prebuilt with an absolute packaged desktop directory.\n' >&2; exit 2
fi
command -v node >/dev/null || { printf 'Node.js is required in PATH.\n' >&2; exit 1; }
if [[ -z "$prebuilt_source" ]]; then
  command -v npm >/dev/null || { printf 'npm is required to build from source.\n' >&2; exit 1; }
  node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 12)) { console.error("GUI build requires Node.js 22.12 or later"); process.exit(1); }'
fi
airdrop_root="$(node -e 'console.log(require(process.argv[1]).getPaths().root)' "$repo_dir/lib/paths.js")"
[[ -f "$airdrop_root/config/server.env" && -d "$airdrop_root/app/ui" ]] || { printf 'Run ./install.sh first to install or migrate the unified layout.\n' >&2; exit 1; }
node -e 'const {getPaths}=require(process.argv[1]);const {checkDesktopClosed}=require(process.argv[2]);Promise.all([checkDesktopClosed(getPaths().desktopData),checkDesktopClosed(getPaths().legacyDesktopData)]).catch(e=>{console.error(e.message);process.exitCode=1})' "$repo_dir/lib/paths.js" "$repo_dir/scripts/migrate-layout.js"
if [[ -n "$prebuilt_source" ]]; then
  source_dir="$prebuilt_source"
  node "$repo_dir/scripts/validate-prebuilt.js" "$(dirname "$(dirname "$source_dir")")"
else
node "$repo_dir/scripts/prepare-desktop.js"
(
  cd "$repo_dir/desktop"
  npm ci --no-audit --no-fund
  npm run package
)
arch="$(node -p process.arch)"
source_dir="$repo_dir/desktop/out/Airdrop-linux-$arch"
[[ -x "$source_dir/Airdrop" ]] || { printf 'GUI build failed.\n' >&2; exit 1; }
fi
target_dir="$airdrop_root/app/desktop"
mkdir -p "$target_dir" "$HOME/.local/bin" "$HOME/.local/share/applications"
cp -a "$source_dir/." "$target_dir/"
# Ubuntu 24.04+ restricts Chromium's unprivileged user-namespace sandbox.
# Grant access to this executable only; keep Electron's sandbox enabled.
if [[ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || true)" == 1 ]]; then
  parser="$(command -v apparmor_parser || true)"
  [[ -n "$parser" ]] || parser=/usr/sbin/apparmor_parser
  [[ -x "$parser" ]] || { printf 'AppArmor restricts user namespaces but apparmor_parser is missing. Install the apparmor package and retry.\n' >&2; exit 1; }
  profile_tmp="$(mktemp)"
  trap 'rm -f "$profile_tmp"' EXIT
  node "$repo_dir/scripts/desktop-apparmor.js" "$target_dir/Airdrop" > "$profile_tmp"
  # Validate before installing policy. No elevated command runs the GUI itself.
  "$parser" --skip-kernel-load --skip-cache "$profile_tmp"
  printf 'Configuring AppArmor sandbox access for Airdrop (requires sudo).\n'
  sudo install -o root -g root -m 0644 "$profile_tmp" "/etc/apparmor.d/airdrop-desktop-$(id -u)"
  sudo "$parser" --replace "/etc/apparmor.d/airdrop-desktop-$(id -u)"
  rm -f "$profile_tmp"
  trap - EXIT
fi
# Shell quote absolute paths, including homes containing spaces or apostrophes.
runtime_node="$(command -v node)"
printf '#!/usr/bin/env bash\nexport AIRDROP_HOME=%q\n' "$airdrop_root" > "$HOME/.local/bin/airdrop-desktop"
printf 'if [[ -f "$AIRDROP_HOME/state/updates/transaction.json" || -f "$AIRDROP_HOME/state/update-lock.json" ]]; then\n  %q "$AIRDROP_HOME/state/updates/runner/updater.js" --recover "$AIRDROP_HOME" || exit $?\nfi\nexec %q "$@"\n' "$runtime_node" "$target_dir/Airdrop" >> "$HOME/.local/bin/airdrop-desktop"
chmod 0755 "$HOME/.local/bin/airdrop-desktop"
launcher_cmd="$(printf '%s' "$HOME/.local/bin/airdrop-desktop" | sed 's/\\/\\\\/g; s/"/\\"/g; s/`/\\`/g; s/\$/\\$/g; s/%/%%/g')"
cat > "$HOME/.local/share/applications/airdrop.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Airdrop
Comment=Local file sharing and ZIP transfers
Exec="$launcher_cmd"
Terminal=false
Categories=Network;Utility;
Icon=$target_dir/resources/app/core/ui/icon-192.png
DESKTOP
printf 'Installed. Launch Airdrop from your application menu or run airdrop-desktop.\n'
