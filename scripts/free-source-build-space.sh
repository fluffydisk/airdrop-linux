#!/usr/bin/env bash
# Only disposable GitHub-hosted machines, never a user's cloud workstation.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted ]] || {
  echo 'SDK cleanup is restricted to ephemeral GitHub-hosted runners' >&2
  exit 1
}
df -h .
# Electron has no Android/.NET/Haskell build dependency. Keep Python, C++,
# Node, Rust, system services and every application/user data directory.
sudo rm -rf /usr/local/lib/android /usr/share/dotnet /opt/ghc /usr/local/.ghcup
df -h .
