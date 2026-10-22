#!/usr/bin/env bash
# A fresh namespace with no external interfaces; compile as the original user.
set -euo pipefail
test "$#" -gt 0
sudo --preserve-env=HOME,PATH,CARGO_HOME,RUSTUP_HOME,RUSTUP_TOOLCHAIN,GITHUB_SHA \
  unshare --net -- setpriv --reuid="$(id -u)" --regid="$(id -g)" --init-groups --no-new-privs -- "$@"
