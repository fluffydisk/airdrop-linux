#!/usr/bin/env bash
#
# Airdrop — Linux installer
#
# The installer is intentionally idempotent: existing data, VAPID keys,
# dependencies, and shell configuration are preserved whenever possible.
#
# Usage:
#   chmod +x install.sh
#   ./install.sh
#
# Requirements:
#   - Linux
#   - a supported package manager when dependencies are missing
#   - sudo access for system packages, Tailscale, and systemd services
#
# This script never runs as root. Run it as the user who will own the files.

set -Eeuo pipefail

# ---------- Configuration ----------

readonly MIN_NODE_MAJOR=18
readonly DUFS_VERSION="${DUFS_VERSION:-0.46.0}"
readonly NODE_VERSION="${NODE_VERSION:-24.21.0}"
readonly SHARE_DIR="$HOME/AirdropShare"
readonly PUSH_DIR="$HOME/airdrop-push"
readonly LOCAL_BIN_DIR="$HOME/.local/bin"
readonly NODE_FALLBACK_DIR="$HOME/.local/opt"
readonly REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CURRENT_USER="$(id -un)"
readonly HOME_DIR="$HOME"

TMP_NODE_DIR=""
TMP_DUFS_DIR=""
TMP_TS_SCRIPT=""
TMP_SHARE_SERVICE=""
TMP_PUSH_SERVICE=""

cleanup() {
  [[ -z "$TMP_NODE_DIR" ]] || rm -rf "$TMP_NODE_DIR"
  [[ -z "$TMP_DUFS_DIR" ]] || rm -rf "$TMP_DUFS_DIR"
  [[ -z "$TMP_TS_SCRIPT" ]] || rm -f "$TMP_TS_SCRIPT"
  [[ -z "$TMP_SHARE_SERVICE" ]] || rm -f "$TMP_SHARE_SERVICE"
  [[ -z "$TMP_PUSH_SERVICE" ]] || rm -f "$TMP_PUSH_SERVICE"
}
trap cleanup EXIT

# ---------- Output ----------

if [[ -t 1 ]]; then
  readonly C_RESET='\033[0m'
  readonly C_BOLD='\033[1m'
  readonly C_GREEN='\033[32m'
  readonly C_YELLOW='\033[33m'
  readonly C_RED='\033[31m'
  readonly C_BLUE='\033[34m'
else
  readonly C_RESET=''
  readonly C_BOLD=''
  readonly C_GREEN=''
  readonly C_YELLOW=''
  readonly C_RED=''
  readonly C_BLUE=''
fi

info()  { printf '%b==>%b %b%s%b\n' "$C_BLUE" "$C_RESET" "$C_BOLD" "$1" "$C_RESET"; }
ok()    { printf '%b✓%b %s\n' "$C_GREEN" "$C_RESET" "$1"; }
warn()  { printf '%b!%b %s\n' "$C_YELLOW" "$C_RESET" "$1"; }
fail()  { printf '%b✗ %s%b\n' "$C_RED" "$1" "$C_RESET" >&2; exit 1; }

on_error() {
  local exit_code=$?
  printf '\n%bInstaller stopped at line %s (exit code %s).%b\n' \
    "$C_RED" "${BASH_LINENO[0]:-unknown}" "$exit_code" "$C_RESET" >&2
  printf '%bRe-run the installer after fixing the reported problem.%b\n' \
    "$C_YELLOW" "$C_RESET" >&2
  exit "$exit_code"
}
trap on_error ERR

# ---------- Basic validation ----------

[[ "$(uname -s)" == "Linux" ]] || fail "Airdrop currently supports Linux only."
[[ "$(id -u)" -ne 0 ]] || fail "Do not run this installer as root. Run it as your normal user."
[[ -n "${HOME:-}" && -d "$HOME" ]] || fail "Your HOME directory is missing or invalid."

for required_cmd in bash chmod cp find grep id mkdir mktemp mv rm sed tar tr uname; do
  command -v "$required_cmd" >/dev/null 2>&1 || fail "Required command '$required_cmd' is missing."
done

# ---------- Package manager detection ----------

PKG_MANAGER=""
OS_ID=""
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
  OS_ID="${ID:-}"
fi
case "$OS_ID" in
  arch|manjaro|endeavouros)
    command -v pacman >/dev/null 2>&1 && PKG_MANAGER="pacman" ;;
  alpine)
    command -v apk >/dev/null 2>&1 && PKG_MANAGER="apk" ;;
  void)
    command -v xbps-install >/dev/null 2>&1 && PKG_MANAGER="xbps" ;;
esac

if [[ -z "$PKG_MANAGER" ]]; then
  if command -v apt-get >/dev/null 2>&1; then
    PKG_MANAGER="apt"
  elif command -v dnf >/dev/null 2>&1; then
    PKG_MANAGER="dnf"
  elif command -v yum >/dev/null 2>&1; then
    PKG_MANAGER="yum"
  elif command -v zypper >/dev/null 2>&1; then
    PKG_MANAGER="zypper"
  elif command -v pacman >/dev/null 2>&1; then
    PKG_MANAGER="pacman"
  elif command -v apk >/dev/null 2>&1; then
    PKG_MANAGER="apk"
  elif command -v xbps-install >/dev/null 2>&1; then
    PKG_MANAGER="xbps"
  fi
fi

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
fi
DISTRO_NAME="${PRETTY_NAME:-${NAME:-Unknown Linux}}"

info "Detected system: $DISTRO_NAME"
info "Detected package manager: ${PKG_MANAGER:-none}"
printf 'User: %s\nShare directory: %s\nPush server directory: %s\n\n' \
  "$CURRENT_USER" "$SHARE_DIR" "$PUSH_DIR"

SUDO_AVAILABLE=false
APT_UPDATED=false
ensure_sudo() {
  if [[ "$SUDO_AVAILABLE" == true ]]; then
    return
  fi

  command -v sudo >/dev/null 2>&1 || \
    fail "sudo is required to install missing system dependencies, but it is not installed."

  # First try a non-interactive check. This works with both cached sudo
  # credentials and NOPASSWD sudoers rules (useful in containers/CI).
  if sudo -n true >/dev/null 2>&1; then
    SUDO_AVAILABLE=true
    return
  fi

  # Fall back to the normal interactive sudo authentication on real systems.
  sudo -v || fail "sudo authentication failed."
  SUDO_AVAILABLE=true
}

package_install() {
  [[ $# -gt 0 ]] || return 0
  ensure_sudo

  case "$PKG_MANAGER" in
    apt)
      if [[ "$APT_UPDATED" == false ]]; then
        sudo apt-get update
        APT_UPDATED=true
      fi
      sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
      ;;
    dnf)
      sudo dnf install -y "$@"
      ;;
    yum)
      sudo yum install -y "$@"
      ;;
    zypper)
      sudo zypper --non-interactive install --no-recommends "$@"
      ;;
    pacman)
      sudo pacman -S --needed --noconfirm "$@"
      ;;
    apk)
      sudo apk add --no-cache "$@"
      ;;
    xbps)
      sudo xbps-install -Sy "$@"
      ;;
    *)
      fail "No supported package manager is available. Install the missing dependency manually and run this installer again."
      ;;
  esac
}

# ---------- Base tools ----------

if ! command -v curl >/dev/null 2>&1; then
  info "Installing curl..."
  package_install curl
fi
command -v curl >/dev/null 2>&1 || fail "curl is still unavailable after installation."
ok "curl is available."

if ! command -v tar >/dev/null 2>&1; then
  info "Installing tar..."
  package_install tar
fi
command -v tar >/dev/null 2>&1 || fail "tar is still unavailable after installation."
ok "tar is available."

# ---------- Node.js ----------

node_major() {
  local node_command="$1"
  "$node_command" --version 2>/dev/null | sed -n 's/^v\([0-9][0-9]*\)\..*/\1/p' | head -n1
}

NODE_BIN="$(command -v node 2>/dev/null || true)"
NPM_BIN="$(command -v npm 2>/dev/null || true)"
CURRENT_NODE_MAJOR=""
if [[ -n "$NODE_BIN" ]]; then
  CURRENT_NODE_MAJOR="$(node_major "$NODE_BIN" || true)"
fi

if [[ -z "$NODE_BIN" || -z "$NPM_BIN" || -z "$CURRENT_NODE_MAJOR" || "$CURRENT_NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]]; then
  info "Checking the system package manager for Node.js and npm..."
  case "$PKG_MANAGER" in
    apt)
      package_install nodejs npm
      ;;
    dnf|yum)
      package_install nodejs npm
      ;;
    zypper)
      package_install nodejs || true
      if ! command -v npm >/dev/null 2>&1; then
        package_install npm-default || package_install npm || true
      fi
      ;;
    pacman)
      package_install nodejs npm
      ;;
    apk)
      package_install nodejs npm
      ;;
    xbps)
      package_install nodejs npm
      ;;
    *)
      :
      ;;
  esac

  NODE_BIN="$(command -v node 2>/dev/null || true)"
  NPM_BIN="$(command -v npm 2>/dev/null || true)"
  CURRENT_NODE_MAJOR=""
  if [[ -n "$NODE_BIN" ]]; then
    CURRENT_NODE_MAJOR="$(node_major "$NODE_BIN" || true)"
  fi
fi

# If the distro ships an old/missing Node.js, install an official Node.js LTS
# binary in the user's home instead of changing system packages further.
if [[ -z "$NODE_BIN" || -z "$NPM_BIN" || -z "$CURRENT_NODE_MAJOR" || "$CURRENT_NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]]; then
  info "The system Node.js is missing or too old; installing Node.js v$NODE_VERSION locally..."

  case "$(uname -m)" in
    x86_64) NODE_ARCH="x64" ;;
    aarch64|arm64) NODE_ARCH="arm64" ;;
    ppc64le) NODE_ARCH="ppc64le" ;;
    s390x) NODE_ARCH="s390x" ;;
    *) fail "Unsupported CPU architecture for the Node.js fallback: $(uname -m). Install Node.js >= $MIN_NODE_MAJOR manually." ;;
  esac

  if [[ ! "$NODE_VERSION" =~ ^24\.[0-9]+\.[0-9]+$ ]]; then
    fail "NODE_VERSION must be a Node.js 24.x LTS version, for example 24.21.0."
  fi

  local_node_dir="$NODE_FALLBACK_DIR/node-v$NODE_VERSION-linux-$NODE_ARCH"
  if [[ ! -x "$local_node_dir/bin/node" ]]; then
    TMP_NODE_DIR="$(mktemp -d)"

    node_archive="$TMP_NODE_DIR/node.tar.xz"
    node_url="https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz"
    curl -fL --retry 3 --proto '=https' --tlsv1.2 "$node_url" -o "$node_archive" \
      || fail "Could not download Node.js from nodejs.org."
    mkdir -p "$NODE_FALLBACK_DIR"
    tar -xJf "$node_archive" -C "$NODE_FALLBACK_DIR"
    rm -rf "$TMP_NODE_DIR"
    TMP_NODE_DIR=""
  fi

  NODE_BIN="$local_node_dir/bin/node"
  NPM_BIN="$local_node_dir/bin/npm"
fi

[[ -x "$NODE_BIN" ]] || fail "Node.js executable not found at '$NODE_BIN'."
[[ -x "$NPM_BIN" ]] || fail "npm executable not found at '$NPM_BIN'."
CURRENT_NODE_MAJOR="$(node_major "$NODE_BIN")"
[[ -n "$CURRENT_NODE_MAJOR" && "$CURRENT_NODE_MAJOR" -ge "$MIN_NODE_MAJOR" ]] \
  || fail "Node.js $MIN_NODE_MAJOR or newer is required. Detected: $CURRENT_NODE_MAJOR"
ok "Node.js $($NODE_BIN --version) and npm $($NPM_BIN --version) are available."

# ---------- dufs ----------

version_number() {
  local value="$1"
  local major minor patch
  IFS='.' read -r major minor patch <<< "$value"
  printf '%d%03d%03d\n' "${major:-0}" "${minor:-0}" "${patch:-0}"
}

installed_dufs_version=""
if command -v dufs >/dev/null 2>&1; then
  installed_dufs_version="$(dufs --version 2>/dev/null | sed -n 's/.*\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p' | head -n1 || true)"
elif [[ -x "$LOCAL_BIN_DIR/dufs" ]]; then
  installed_dufs_version="$($LOCAL_BIN_DIR/dufs --version 2>/dev/null | sed -n 's/.*\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p' | head -n1 || true)"
fi

NEED_DUFS=true
if [[ -n "$installed_dufs_version" ]]; then
  if (( $(version_number "$installed_dufs_version") >= $(version_number "$DUFS_VERSION") )); then
    NEED_DUFS=false
    DUFS_BIN="$(command -v dufs 2>/dev/null || printf '%s/dufs' "$LOCAL_BIN_DIR")"
    ok "dufs $installed_dufs_version is available."
  fi
fi

if [[ "$NEED_DUFS" == true ]]; then
  info "Installing dufs v$DUFS_VERSION..."

  case "$(uname -m)" in
    x86_64) DUFS_TARGET="x86_64-unknown-linux-musl" ;;
    aarch64|arm64) DUFS_TARGET="aarch64-unknown-linux-musl" ;;
    armv7l) DUFS_TARGET="armv7-unknown-linux-musleabihf" ;;
    armv6l) DUFS_TARGET="arm-unknown-linux-musleabihf" ;;
    *) fail "Unsupported CPU architecture for the dufs release binary: $(uname -m)." ;;
  esac

  TMP_DUFS_DIR="$(mktemp -d)"

  dufs_archive="$TMP_DUFS_DIR/dufs.tar.gz"
  dufs_url="https://github.com/sigoden/dufs/releases/download/v$DUFS_VERSION/dufs-v$DUFS_VERSION-$DUFS_TARGET.tar.gz"
  curl -fL --retry 3 --proto '=https' --tlsv1.2 "$dufs_url" -o "$dufs_archive" \
    || fail "Could not download the dufs release binary from GitHub."
  tar -xzf "$dufs_archive" -C "$TMP_DUFS_DIR"

  DUFS_SOURCE="$(find "$TMP_DUFS_DIR" -type f -name dufs -perm -u+x -print -quit)"
  [[ -n "$DUFS_SOURCE" ]] || fail "The downloaded dufs archive does not contain an executable named 'dufs'."

  mkdir -p "$LOCAL_BIN_DIR"
  install -m 0755 "$DUFS_SOURCE" "$LOCAL_BIN_DIR/dufs"
  rm -rf "$TMP_DUFS_DIR"
  TMP_DUFS_DIR=""
  DUFS_BIN="$LOCAL_BIN_DIR/dufs"

  installed_dufs_version="$($DUFS_BIN --version 2>/dev/null | sed -n 's/.*\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p' | head -n1 || true)"
  [[ "$installed_dufs_version" == "$DUFS_VERSION" ]] || fail "dufs was installed, but its version could not be verified."
  ok "dufs $installed_dufs_version installed at $DUFS_BIN."
fi

# ---------- Clipboard support based on the current session ----------

CLIPBOARD_MODE="none"
if [[ "${XDG_SESSION_TYPE:-}" == "wayland" || -n "${WAYLAND_DISPLAY:-}" ]]; then
  CLIPBOARD_MODE="wayland"
elif [[ "${XDG_SESSION_TYPE:-}" == "x11" || -n "${DISPLAY:-}" ]]; then
  CLIPBOARD_MODE="x11"
fi

case "$CLIPBOARD_MODE" in
  wayland)
    if ! command -v wl-copy >/dev/null 2>&1 || ! command -v wl-paste >/dev/null 2>&1; then
      info "Wayland detected; installing wl-clipboard..."
      package_install wl-clipboard
    fi
    if command -v wl-copy >/dev/null 2>&1 && command -v wl-paste >/dev/null 2>&1; then
      ok "Wayland clipboard support is available."
    else
      warn "Wayland was detected, but wl-clipboard could not be installed. Clipboard helpers will remain unavailable."
    fi
    ;;
  x11)
    if ! command -v xclip >/dev/null 2>&1 && ! command -v xsel >/dev/null 2>&1; then
      info "X11 detected; installing a clipboard utility..."
      package_install xclip || package_install xsel
    fi
    if command -v xclip >/dev/null 2>&1 || command -v xsel >/dev/null 2>&1; then
      ok "X11 clipboard support is available."
    else
      warn "X11 was detected, but no clipboard utility could be installed. Clipboard helpers will remain unavailable."
    fi
    ;;
  none)
    warn "No graphical Wayland/X11 session detected; clipboard packages will not be installed."
    ;;
esac

# ---------- Tailscale ----------

if command -v tailscale >/dev/null 2>&1; then
  ok "Tailscale is already installed."
else
  info "Installing Tailscale..."
  case "$PKG_MANAGER" in
    pacman)
      package_install tailscale
      ;;
    apt|dnf|yum|zypper)
      TMP_TS_SCRIPT="$(mktemp)"
      curl -fL --retry 3 --proto '=https' --tlsv1.2 \
        https://tailscale.com/install.sh -o "$TMP_TS_SCRIPT" \
        || fail "Could not download the official Tailscale installer."
      sudo sh "$TMP_TS_SCRIPT"
      rm -f "$TMP_TS_SCRIPT"
      TMP_TS_SCRIPT=""
      ;;
    apk|xbps)
      package_install tailscale || fail "Your package manager could not install Tailscale automatically. Follow the official Tailscale Linux installation guide for your distribution."
      ;;
    *)
      fail "Tailscale is missing and your distribution is not supported by the automatic installer. Install Tailscale manually, then run this installer again."
      ;;
  esac
fi

command -v tailscale >/dev/null 2>&1 || fail "Tailscale is still unavailable after installation."
ok "Tailscale is available."

if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]] && command -v tailscaled >/dev/null 2>&1; then
  ensure_sudo
  sudo systemctl enable --now tailscaled >/dev/null 2>&1 || \
    warn "tailscaled could not be started automatically. Tailscale can be started manually later."
fi

# ---------- Tailscale authentication and Serve ----------

TAILSCALE_READY=false
TAILSCALE_URL=""

configure_tailscale() {
  # Docker/CI test environments are non-interactive and cannot complete a
  # browser-based Tailscale login. Do not block the installer there.
  if [[ ! -t 0 || ! -t 1 ]]; then
    warn "Skipping interactive Tailscale setup because this installer is running non-interactively."
    warn "Run ./install.sh again from a normal terminal to finish Tailscale setup."
    return 0
  fi

  ensure_sudo

  # Allow the installing user to manage Tailscale without sudo afterwards.
  sudo tailscale set --operator="$CURRENT_USER" >/dev/null 2>&1 || \
    warn "Could not set '$CURRENT_USER' as the Tailscale operator. The installer will use sudo for Tailscale commands."

  if ! tailscale status >/dev/null 2>&1; then
    info "This machine is not authenticated with Tailscale yet."
    printf '%bTailscale will provide a login URL. Complete the login in your browser, then return here.%b\n' \
      "$C_YELLOW" "$C_RESET"
    sudo tailscale up || {
      warn "Tailscale authentication did not complete. Airdrop is installed, but remote access is not configured yet."
      return 0
    }
  fi

  if ! tailscale status >/dev/null 2>&1; then
    warn "Tailscale is installed but this machine is not authenticated. Remote access setup was skipped."
    return 0
  fi

  TAILSCALE_READY=true
  ok "This machine is connected to Tailscale."

  # These mounts are intentionally idempotent. Re-running install.sh updates
  # the Airdrop routes instead of creating another copy of the configuration.
  if ! sudo tailscale serve --bg --set-path / http://127.0.0.1:5000; then
    warn "Could not configure Tailscale Serve for the Airdrop file server."
    warn "Make sure HTTPS certificates are enabled for this tailnet, then re-run ./install.sh."
    TAILSCALE_READY=false
    return 0
  fi

  if ! sudo tailscale serve --bg --set-path /push http://127.0.0.1:6001; then
    warn "Could not configure Tailscale Serve for the Airdrop push server."
    warn "Make sure HTTPS certificates are enabled for this tailnet, then re-run ./install.sh."
    TAILSCALE_READY=false
    return 0
  fi

  local serve_status
  serve_status="$(sudo tailscale serve status 2>/dev/null || true)"
  TAILSCALE_URL="$(printf '%s\n' "$serve_status" | sed -n 's#^\(https://[^[:space:]]*\).*#\1#p' | head -n1 | sed 's#/$##')"
  if [[ -n "$TAILSCALE_URL" ]]; then
    ok "Tailscale Serve is configured: $TAILSCALE_URL"
  else
    warn "Tailscale Serve is running, but its HTTPS hostname could not be detected automatically."
  fi
}

# ---------- Install application files ----------

info "Installing Airdrop files..."
mkdir -p "$SHARE_DIR/ui" "$PUSH_DIR" "$LOCAL_BIN_DIR"

cp -a "$REPO_DIR/ui/." "$SHARE_DIR/ui/"
cp -a "$REPO_DIR/push-server.js" "$REPO_DIR/package.json" "$PUSH_DIR/"
[[ -f "$REPO_DIR/package-lock.json" ]] && cp -a "$REPO_DIR/package-lock.json" "$PUSH_DIR/"

ok "Application files installed."

# ---------- npm dependencies ----------

info "Installing npm dependencies..."
(
  cd "$PUSH_DIR"
  "$NPM_BIN" install --omit=dev --no-audit --no-fund
)
[[ -x "$PUSH_DIR/node_modules/.bin/web-push" ]] || fail "npm dependencies were installed, but web-push is missing."
ok "npm dependencies installed."

# ---------- VAPID keys ----------

ENV_FILE="$PUSH_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  if grep -q '^VAPID_PUBLIC_KEY=[^[:space:]]' "$ENV_FILE" && grep -q '^VAPID_PRIVATE_KEY=[^[:space:]]' "$ENV_FILE"; then
    chmod 600 "$ENV_FILE"
    ok "Existing VAPID credentials preserved."
  else
    fail "$ENV_FILE exists but does not contain a valid VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY. Fix it manually instead of overwriting it."
  fi
else
  info "Generating a new VAPID key pair..."
  VAPID_JSON="$(cd "$PUSH_DIR" && "$NODE_BIN" -e 'const wp=require("web-push"); process.stdout.write(JSON.stringify(wp.generateVAPIDKeys()));')"
  VAPID_PUBLIC="$(printf '%s' "$VAPID_JSON" | sed -n 's/.*"publicKey":"\([^"]*\)".*/\1/p')"
  VAPID_PRIVATE="$(printf '%s' "$VAPID_JSON" | sed -n 's/.*"privateKey":"\([^"]*\)".*/\1/p')"
  [[ -n "$VAPID_PUBLIC" && -n "$VAPID_PRIVATE" ]] || fail "Could not generate a VAPID key pair."

  VAPID_CONTACT_EMAIL="${VAPID_CONTACT_EMAIL:-mailto:example@example.com}"
  if [[ "$VAPID_CONTACT_EMAIL" != mailto:* && "$VAPID_CONTACT_EMAIL" != https://* ]]; then
    VAPID_CONTACT_EMAIL="mailto:$VAPID_CONTACT_EMAIL"
  fi
  cat > "$ENV_FILE" <<ENV
VAPID_PUBLIC_KEY=$VAPID_PUBLIC
VAPID_PRIVATE_KEY=$VAPID_PRIVATE
VAPID_CONTACT_EMAIL=$VAPID_CONTACT_EMAIL
WATCH_DIR=$SHARE_DIR
PORT=6001
ENV
  chmod 600 "$ENV_FILE"
  ok "A new VAPID key pair was generated and stored in $ENV_FILE."
fi

# ---------- Systemd services ----------

SYSTEMD_AVAILABLE=false
if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
  SYSTEMD_AVAILABLE=true
fi

if [[ "$SYSTEMD_AVAILABLE" == true ]]; then
  info "Installing systemd services..."
  ensure_sudo

  push_node_bin="$NODE_BIN"
  push_dufs_bin="$DUFS_BIN"

  TMP_SHARE_SERVICE="$(mktemp)"
  TMP_PUSH_SERVICE="$(mktemp)"

  cat > "$TMP_SHARE_SERVICE" <<SERVICE
[Unit]
Description=Airdrop file server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$SHARE_DIR
ExecStart=$push_dufs_bin $SHARE_DIR --bind 127.0.0.1 --port 5000 --allow-all --render-try-index
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
SERVICE

  cat > "$TMP_PUSH_SERVICE" <<SERVICE
[Unit]
Description=Airdrop push notification server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$PUSH_DIR
Environment=NODE_ENV=production
EnvironmentFile=$ENV_FILE
ExecStart=$push_node_bin $PUSH_DIR/push-server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$PUSH_DIR $SHARE_DIR

[Install]
WantedBy=multi-user.target
SERVICE

  sudo install -m 0644 "$TMP_SHARE_SERVICE" /etc/systemd/system/airdropshare.service
  sudo install -m 0644 "$TMP_PUSH_SERVICE" /etc/systemd/system/airdrop-push.service
  rm -f "$TMP_SHARE_SERVICE" "$TMP_PUSH_SERVICE"
  TMP_SHARE_SERVICE=""
  TMP_PUSH_SERVICE=""

  sudo systemctl daemon-reload
  sudo systemctl enable airdropshare.service airdrop-push.service >/dev/null
  sudo systemctl restart airdropshare.service
  sudo systemctl restart airdrop-push.service

  if ! sudo systemctl is-active --quiet airdropshare.service; then
    sudo systemctl --no-pager --full status airdropshare.service || true
    fail "airdropshare.service failed to start."
  fi
  if ! sudo systemctl is-active --quiet airdrop-push.service; then
    sudo systemctl --no-pager --full status airdrop-push.service || true
    fail "airdrop-push.service failed to start."
  fi
  ok "Airdrop systemd services are enabled and running."
else
  warn "systemd is not available in this environment; services were not created."
  warn "The application files are installed, but you must run dufs and the Node.js server using your platform's service manager."
fi

configure_tailscale

# ---------- CLI helper commands ----------

info "Installing terminal helper commands..."

cat > "$LOCAL_BIN_DIR/airdrop" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

SHARE_DIR="${HOME}/AirdropShare"

if [[ $# -ne 1 ]]; then
  printf 'Usage: airdrop <file>\n' >&2
  exit 2
fi

src="$1"
[[ -f "$src" ]] || { printf 'Error: file not found: %s\n' "$src" >&2; exit 1; }
[[ -d "$SHARE_DIR" ]] || { printf 'Error: AirdropShare does not exist: %s\n' "$SHARE_DIR" >&2; exit 1; }

base="$(basename -- "$src")"
if [[ "$base" == *.* && "$base" != .* ]]; then
  stem="${base%.*}"
  ext=".${base##*.}"
else
  stem="$base"
  ext=""
fi

dest="$SHARE_DIR/$base"
counter=1
while [[ -e "$dest" ]]; do
  dest="$SHARE_DIR/${stem} (${counter})${ext}"
  counter=$((counter + 1))
done

cp -- "$src" "$dest"
printf 'Copied to AirdropShare: %s\n' "$(basename -- "$dest")"
SCRIPT

cat > "$LOCAL_BIN_DIR/copy-clipboard" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

CLIP_FILE="${HOME}/AirdropShare/.clipboard.txt"

[[ -f "$CLIP_FILE" ]] || { printf 'Error: the shared clipboard is empty or has not been created yet.\n' >&2; exit 1; }

if [[ "${XDG_SESSION_TYPE:-}" == "wayland" || -n "${WAYLAND_DISPLAY:-}" ]]; then
  command -v wl-copy >/dev/null 2>&1 || { printf 'Error: wl-copy is not installed.\n' >&2; exit 1; }
  wl-copy < "$CLIP_FILE"
elif [[ "${XDG_SESSION_TYPE:-}" == "x11" || -n "${DISPLAY:-}" ]]; then
  if command -v xclip >/dev/null 2>&1; then
    xclip -selection clipboard -i < "$CLIP_FILE"
  elif command -v xsel >/dev/null 2>&1; then
    xsel --clipboard --input < "$CLIP_FILE"
  else
    printf 'Error: no X11 clipboard utility is installed.\n' >&2
    exit 1
  fi
else
  printf 'Error: no Wayland or X11 session was detected.\n' >&2
  exit 1
fi

printf 'Shared clipboard copied to the local clipboard.\n'
SCRIPT

cat > "$LOCAL_BIN_DIR/paste-clipboard" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

CLIP_FILE="${HOME}/AirdropShare/.clipboard.txt"
mkdir -p "$(dirname "$CLIP_FILE")"

tmp_file="$(mktemp)"
cleanup() { rm -f "$tmp_file"; }
trap cleanup EXIT

if [[ "${XDG_SESSION_TYPE:-}" == "wayland" || -n "${WAYLAND_DISPLAY:-}" ]]; then
  command -v wl-paste >/dev/null 2>&1 || { printf 'Error: wl-paste is not installed.\n' >&2; exit 1; }
  wl-paste > "$tmp_file"
elif [[ "${XDG_SESSION_TYPE:-}" == "x11" || -n "${DISPLAY:-}" ]]; then
  if command -v xclip >/dev/null 2>&1; then
    xclip -selection clipboard -o > "$tmp_file"
  elif command -v xsel >/dev/null 2>&1; then
    xsel --clipboard --output > "$tmp_file"
  else
    printf 'Error: no X11 clipboard utility is installed.\n' >&2
    exit 1
  fi
else
  printf 'Error: no Wayland or X11 session was detected.\n' >&2
  exit 1
fi

mv -- "$tmp_file" "$CLIP_FILE"
printf 'Local clipboard sent to AirdropShare.\n'
SCRIPT

chmod 0755 "$LOCAL_BIN_DIR/airdrop" "$LOCAL_BIN_DIR/copy-clipboard" "$LOCAL_BIN_DIR/paste-clipboard"

# Make the local command directory available in new shells without touching
# an existing custom PATH definition more than once.
PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
case ":${PATH}:" in
  *":$HOME/.local/bin:"*) ;;
  *)
    SHELL_NAME="$(basename "${SHELL:-bash}")"
    case "$SHELL_NAME" in
      zsh) SHELL_RC="$HOME/.zshrc" ;;
      fish) SHELL_RC="" ;;
      *) SHELL_RC="$HOME/.bashrc" ;;
    esac
    if [[ -n "$SHELL_RC" ]]; then
      touch "$SHELL_RC"
      if ! grep -Fqx "$PATH_LINE" "$SHELL_RC"; then
        printf '\n# Airdrop local commands\n%s\n' "$PATH_LINE" >> "$SHELL_RC"
      fi
    elif command -v fish >/dev/null 2>&1; then
      fish -c 'fish_add_path --path "$HOME/.local/bin"' >/dev/null 2>&1 || true
    fi
    export PATH="$LOCAL_BIN_DIR:$PATH"
    ;;
esac

ok "Terminal helpers installed in $LOCAL_BIN_DIR."

# ---------- Final diagnostics ----------

info "Running local health checks..."
"$NODE_BIN" --check "$PUSH_DIR/push-server.js"
"$DUFS_BIN" --version >/dev/null 2>&1 || fail "dufs health check failed."
[[ -f "$SHARE_DIR/ui/index.html" ]] || fail "UI files are missing."
[[ -f "$SHARE_DIR/ui/sw.js" ]] || fail "Service worker is missing."
[[ -f "$PUSH_DIR/.env" ]] || fail ".env file is missing."

if [[ "$SYSTEMD_AVAILABLE" == true ]]; then
  sudo systemctl is-active --quiet airdropshare.service || fail "airdropshare.service is not active."
  sudo systemctl is-active --quiet airdrop-push.service || fail "airdrop-push.service is not active."
fi

printf '\n%bAirdrop installation completed successfully.%b\n' "$C_GREEN$C_BOLD" "$C_RESET"
printf '\n%bDevice setup:%b\n' "$C_BOLD" "$C_RESET"
if [[ "$TAILSCALE_READY" == true ]]; then
  if [[ -n "$TAILSCALE_URL" ]]; then
    printf '1. Open this Airdrop URL on your other devices:\n'
    printf '   %s/ui/\n' "$TAILSCALE_URL"
  else
    printf '1. Open the Tailscale Serve HTTPS hostname and add /ui/ to the URL.\n'
  fi
  printf '2. Install Tailscale on each device and sign in to the same tailnet.\n'
  printf '3. Open the Airdrop URL in Safari/Chrome and install the PWA.\n'
  printf '4. Allow notifications when prompted.\n'
else
  printf '1. Authenticate this machine with Tailscale, then run ./install.sh again.\n'
  printf '2. The installer will configure Tailscale Serve automatically.\n'
fi
printf '\n%bInstalled paths:%b\n' "$C_BOLD" "$C_RESET"
printf '  Share: %s\n' "$SHARE_DIR"
printf '  Push server: %s\n' "$PUSH_DIR"
printf '  CLI helpers: %s\n' "$LOCAL_BIN_DIR"
printf '  dufs: %s\n' "$DUFS_BIN"
printf '  Node.js: %s\n' "$NODE_BIN"
printf '\n%bThe installer is safe to run again: existing .env/VAPID credentials are preserved.%b\n' "$C_YELLOW" "$C_RESET"
