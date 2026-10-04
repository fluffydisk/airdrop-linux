#!/usr/bin/env bash
#
# Airdrop installer distro test suite
#
# Runs install.sh inside clean Docker containers across multiple Linux
# distributions. The project is copied into each container instead of being
# bind-mounted, so container chown/chmod operations can never alter host files.
#
# Usage:
#   ./tests/test-distros.sh
#   ./tests/test-distros.sh --keep-failed
#   ./tests/test-distros.sh --only ubuntu,debian
#
# Notes:
#   - This validates package-manager/dependency/install logic.
#   - Docker containers do not provide a normal desktop session or systemd,
#     so Wayland/X11 clipboard and real systemd service startup are not fully
#     exercised here.

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
readonly INSTALLER="$PROJECT_DIR/install.sh"
readonly LOG_ROOT="${TMPDIR:-/tmp}/airdrop-distro-tests-$(date +%Y%m%d-%H%M%S)"
readonly TEST_USER="airdrop-test"
readonly TEST_HOME="/home/$TEST_USER"

KEEP_FAILED=false
ONLY_FILTER=""
ACTIVE_CONTAINER=""

# name|docker image|bootstrap family
DISTROS=(
  "ubuntu|ubuntu:24.04|apt"
  "debian|debian:13-slim|apt"
  "fedora|fedora:latest|dnf"
  "rocky|rockylinux:10|dnf"
  "opensuse|opensuse/tumbleweed:latest|zypper"
  "arch|archlinux:latest|pacman"
  "alpine|alpine:latest|apk"
  "void|voidlinux/voidlinux:latest|xbps"
)

RESULT_NAMES=()
RESULT_STATUSES=()
RESULT_DETAILS=()

usage() {
  cat <<USAGE
Usage: $0 [options]

Options:
  --keep-failed        Keep failed Docker containers for debugging.
  --only a,b,c        Test only the named distro IDs.
  -h, --help           Show this help.

Distro IDs:
  ubuntu debian fedora rocky opensuse arch alpine void
USAGE
}

log() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

fail_note() {
  printf 'ERROR: %s\n' "$*" >&2
}

record_result() {
  RESULT_NAMES+=("$1")
  RESULT_STATUSES+=("$2")
  RESULT_DETAILS+=("$3")
}

selected_distro() {
  local name="$1"
  [[ -z "$ONLY_FILTER" ]] && return 0
  local item
  IFS=',' read -ra items <<< "$ONLY_FILTER"
  for item in "${items[@]}"; do
    [[ "$item" == "$name" ]] && return 0
  done
  return 1
}

cleanup_container() {
  if [[ -n "$ACTIVE_CONTAINER" ]]; then
    if [[ "$KEEP_FAILED" == true && "${1:-}" == "failed" ]]; then
      log "Keeping failed container $ACTIVE_CONTAINER for debugging."
    else
      docker rm -f "$ACTIVE_CONTAINER" >/dev/null 2>&1 || true
      ACTIVE_CONTAINER=""
    fi
  fi
}

cleanup_all() {
  cleanup_container
}
trap 'cleanup_all' EXIT INT TERM

check_host_requirements() {
  [[ -f "$INSTALLER" ]] || { fail_note "install.sh not found at $INSTALLER"; exit 1; }
  [[ -x "$INSTALLER" ]] || chmod +x "$INSTALLER"
  command -v docker >/dev/null 2>&1 || { fail_note "Docker is not installed or not in PATH."; exit 1; }
  docker info >/dev/null 2>&1 || {
    fail_note "Docker daemon is not reachable. Try: sudo docker info";
    exit 1;
  }
  command -v sha256sum >/dev/null 2>&1 || { fail_note "sha256sum is required on the host."; exit 1; }
  command -v timeout >/dev/null 2>&1 || { fail_note "timeout is required on the host (usually from coreutils)."; exit 1; }
}

bootstrap_container() {
  local cid="$1"
  local family="$2"

  case "$family" in
    apt)
      docker exec "$cid" sh -c 'export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y --no-install-recommends bash sudo ca-certificates curl tar xz-utils' >/dev/null
      ;;
    dnf)
      docker exec "$cid" sh -c 'dnf -y install bash sudo ca-certificates curl tar xz' >/dev/null
      ;;
    zypper)
      docker exec "$cid" sh -c 'zypper --non-interactive refresh && zypper --non-interactive install --no-recommends bash sudo ca-certificates curl tar xz' >/dev/null
      ;;
    pacman)
      docker exec "$cid" bash -lc 'pacman -Sy --noconfirm bash sudo ca-certificates curl tar xz' >/dev/null
      ;;
    apk)
      docker exec "$cid" sh -c 'apk add --no-cache bash sudo ca-certificates curl tar xz shadow' >/dev/null
      ;;
    xbps)
      docker exec "$cid" sh -c 'xbps-install -Sy bash sudo ca-certificates curl tar xz' >/dev/null
      ;;
    *)
      return 1
      ;;
  esac

  docker exec "$cid" bash -lc '
    set -e
    if command -v useradd >/dev/null 2>&1; then
      useradd -m -s /bin/bash "'"$TEST_USER"'"
    else
      adduser -D -s /bin/bash "'"$TEST_USER"'"
    fi
    mkdir -p /etc/sudoers.d
    printf "%s ALL=(ALL) NOPASSWD:ALL\\n" "'"$TEST_USER"'" > /etc/sudoers.d/airdrop-test
    chmod 0440 /etc/sudoers.d/airdrop-test
    chmod 0755 /home/'"$TEST_USER"'
    sudo -n true
    id "'"$TEST_USER"'"
  ' >/dev/null
}

postcheck_container() {
  local cid="$1"
  docker exec -u "$TEST_USER" -e HOME="$TEST_HOME" -w /airdrop "$cid" bash -lc '
    set -Eeuo pipefail

    command -v node >/dev/null 2>&1 || {
      # The installer may intentionally use a per-user Node fallback. Find it.
      node="$(find "$HOME/.local/opt" -type f -path "*/bin/node" -print -quit 2>/dev/null || true)"
      [[ -n "$node" ]] || { echo "POSTCHECK: Node.js executable not found" >&2; exit 1; }
    }

    [[ -d "$HOME/AirdropShare/ui" ]] || { echo "POSTCHECK: AirdropShare/ui missing" >&2; exit 1; }
    [[ -f "$HOME/airdrop-push/push-server.js" ]] || { echo "POSTCHECK: push-server.js missing" >&2; exit 1; }
    [[ -f "$HOME/airdrop-push/package.json" ]] || { echo "POSTCHECK: package.json missing" >&2; exit 1; }
    [[ -x "$HOME/airdrop-push/node_modules/.bin/web-push" ]] || { echo "POSTCHECK: web-push missing" >&2; exit 1; }
    [[ -f "$HOME/airdrop-push/.env" ]] || { echo "POSTCHECK: .env missing" >&2; exit 1; }
    grep -q "^VAPID_PUBLIC_KEY=[^[:space:]]" "$HOME/airdrop-push/.env" || { echo "POSTCHECK: VAPID_PUBLIC_KEY missing" >&2; exit 1; }
    grep -q "^VAPID_PRIVATE_KEY=[^[:space:]]" "$HOME/airdrop-push/.env" || { echo "POSTCHECK: VAPID_PRIVATE_KEY missing" >&2; exit 1; }
    [[ "$(stat -c %a "$HOME/airdrop-push/.env" 2>/dev/null || stat -f %Lp "$HOME/airdrop-push/.env")" == "600" ]] || { echo "POSTCHECK: .env permissions are not 600" >&2; exit 1; }

    [[ -x "$HOME/.local/bin/airdrop" ]] || { echo "POSTCHECK: airdrop helper missing" >&2; exit 1; }
    [[ -x "$HOME/.local/bin/copy-clipboard" ]] || { echo "POSTCHECK: copy-clipboard helper missing" >&2; exit 1; }
    [[ -x "$HOME/.local/bin/paste-clipboard" ]] || { echo "POSTCHECK: paste-clipboard helper missing" >&2; exit 1; }

    dufs="$HOME/.local/bin/dufs"
    [[ -x "$dufs" ]] || dufs="$(command -v dufs || true)"
    [[ -n "$dufs" && -x "$dufs" ]] || { echo "POSTCHECK: dufs missing" >&2; exit 1; }
    "$dufs" --version >/dev/null 2>&1 || { echo "POSTCHECK: dufs does not execute" >&2; exit 1; }

    node_cmd="${node:-$(command -v node)}"
    node_major="$($node_cmd --version | sed -n "s/^v\\([0-9][0-9]*\\)\\..*/\\1/p")"
    [[ -n "$node_major" && "$node_major" -ge 18 ]] || { echo "POSTCHECK: Node.js < 18" >&2; exit 1; }

    "$node_cmd" --check "$HOME/airdrop-push/push-server.js"
    echo "POSTCHECK: PASS"
  '
}

run_one() {
  local name="$1"
  local image="$2"
  local family="$3"
  local safe_name="${name//[^a-zA-Z0-9_.-]/-}"
  local log_file="$LOG_ROOT/${safe_name}.log"
  local cid=""
  local env_hash_before=""
  local env_hash_after=""
  local run_rc=0

  mkdir -p "$LOG_ROOT"
  : > "$log_file"

  log "===== $name ($image) ====="
  log "Pulling image..."
  if ! docker pull "$image" >>"$log_file" 2>&1; then
    record_result "$name" "IMAGE_PULL_FAIL" "$log_file"
    fail_note "$name: image pull failed. See $log_file"
    return
  fi

  cid="$(docker run -d "$image" sh -c 'while :; do sleep 3600; done' 2>>"$log_file" || true)"
  if [[ -z "$cid" ]]; then
    record_result "$name" "CONTAINER_FAIL" "$log_file"
    fail_note "$name: could not create container. See $log_file"
    return
  fi
  ACTIVE_CONTAINER="$cid"

  {
    echo "Container: $cid"
    echo "Distro image: $image"
    echo "Bootstrap family: $family"
    echo
  } >>"$log_file"

  log "Bootstrapping test user and base tools..."
  if ! bootstrap_container "$cid" "$family" >>"$log_file" 2>&1; then
    record_result "$name" "BOOTSTRAP_FAIL" "$log_file"
    fail_note "$name: bootstrap failed. See $log_file"
    cleanup_container failed
    return
  fi

  log "Copying project into the container..."
  if ! docker exec "$cid" mkdir -p /airdrop >>"$log_file" 2>&1 || ! docker cp "$PROJECT_DIR/." "$cid:/airdrop/" >>"$log_file" 2>&1; then
    record_result "$name" "COPY_FAIL" "$log_file"
    fail_note "$name: project copy failed. See $log_file"
    cleanup_container failed
    return
  fi

  log "Running install.sh (pass 1)..."
  set +e
  timeout --signal=TERM --kill-after=30s 25m \
    docker exec -u "$TEST_USER" -e HOME="$TEST_HOME" -e USER="$TEST_USER" -w /airdrop \
    "$cid" bash -lc './install.sh' >>"$log_file" 2>&1
  run_rc=$?
  set -e
  printf '\nPASS 1 EXIT CODE: %s\n' "$run_rc" >>"$log_file"
  if (( run_rc != 0 )); then
    record_result "$name" "INSTALL_FAIL" "$log_file"
    fail_note "$name: install.sh pass 1 failed (exit $run_rc)."
    tail -n 35 "$log_file" >&2 || true
    cleanup_container failed
    return
  fi

  log "Checking first installation..."
  if ! postcheck_container "$cid" >>"$log_file" 2>&1; then
    record_result "$name" "POSTCHECK_FAIL" "$log_file"
    fail_note "$name: first post-check failed. See $log_file"
    cleanup_container failed
    return
  fi

  env_hash_before="$(docker exec -u "$TEST_USER" -e HOME="$TEST_HOME" "$cid" sha256sum "$TEST_HOME/airdrop-push/.env" | awk '{print $1}')"
  printf 'ENV HASH BEFORE: %s\n' "$env_hash_before" >>"$log_file"

  log "Running install.sh (pass 2 / idempotence)..."
  set +e
  timeout --signal=TERM --kill-after=30s 25m \
    docker exec -u "$TEST_USER" -e HOME="$TEST_HOME" -e USER="$TEST_USER" -w /airdrop \
    "$cid" bash -lc './install.sh' >>"$log_file" 2>&1
  run_rc=$?
  set -e
  printf '\nPASS 2 EXIT CODE: %s\n' "$run_rc" >>"$log_file"
  if (( run_rc != 0 )); then
    record_result "$name" "IDEMPOTENCE_FAIL" "$log_file"
    fail_note "$name: install.sh pass 2 failed (exit $run_rc)."
    tail -n 35 "$log_file" >&2 || true
    cleanup_container failed
    return
  fi

  log "Checking second installation and VAPID preservation..."
  if ! postcheck_container "$cid" >>"$log_file" 2>&1; then
    record_result "$name" "POSTCHECK2_FAIL" "$log_file"
    fail_note "$name: second post-check failed. See $log_file"
    cleanup_container failed
    return
  fi

  env_hash_after="$(docker exec -u "$TEST_USER" -e HOME="$TEST_HOME" "$cid" sha256sum "$TEST_HOME/airdrop-push/.env" | awk '{print $1}')"
  printf 'ENV HASH AFTER:  %s\n' "$env_hash_after" >>"$log_file"

  if [[ "$env_hash_before" != "$env_hash_after" ]]; then
    record_result "$name" "VAPID_CHANGED" "$log_file"
    fail_note "$name: .env changed on second install. See $log_file"
    cleanup_container failed
    return
  fi

  printf 'RESULT: PASS\n' >>"$log_file"
  record_result "$name" "PASS" "$log_file"
  log "$name: PASS"
  cleanup_container
}

print_summary() {
  local i
  local pass=0
  local fail=0

  echo
  echo "========================================"
  echo " Airdrop installer distro test summary"
  echo "========================================"
  printf '%-12s %-18s %s\n' "DISTRO" "STATUS" "LOG"
  printf '%-12s %-18s %s\n' "------------" "------------------" "----------------------------------------"

  for ((i=0; i<${#RESULT_NAMES[@]}; i++)); do
    printf '%-12s %-18s %s\n' "${RESULT_NAMES[$i]}" "${RESULT_STATUSES[$i]}" "${RESULT_DETAILS[$i]}"
    if [[ "${RESULT_STATUSES[$i]}" == "PASS" ]]; then
      pass=$((pass + 1))
    else
      fail=$((fail + 1))
    fi
  done

  echo
  printf 'Passed: %d\n' "$pass"
  printf 'Failed: %d\n' "$fail"
  printf 'Logs:   %s\n' "$LOG_ROOT"
  echo

  if (( fail > 0 )); then
    return 1
  fi
  return 0
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --keep-failed)
        KEEP_FAILED=true
        ;;
      --only)
        [[ $# -ge 2 ]] || { fail_note "--only requires a comma-separated list."; exit 2; }
        ONLY_FILTER="$2"
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        fail_note "Unknown option: $1"
        usage >&2
        exit 2
        ;;
    esac
    shift
  done

  check_host_requirements
  mkdir -p "$LOG_ROOT"

  log "Project:  $PROJECT_DIR"
  log "Installer: $INSTALLER"
  log "Logs:     $LOG_ROOT"
  echo

  local found=false
  local entry name image family
  for entry in "${DISTROS[@]}"; do
    IFS='|' read -r name image family <<< "$entry"
    if selected_distro "$name"; then
      found=true
      run_one "$name" "$image" "$family"
    fi
  done

  if [[ "$found" == false ]]; then
    fail_note "No distro matched --only '$ONLY_FILTER'."
    exit 2
  fi

  print_summary
}

main "$@"
