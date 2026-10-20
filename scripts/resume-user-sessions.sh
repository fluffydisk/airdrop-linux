#!/bin/sh
set -eu
# Restart only sessions explicitly recorded by the package pre-upgrade hook.
if [ -d /run/systemd/system ]; then
  systemctl daemon-reload
  if [ -f /run/airdrop-upgrade-users ]; then
    while read -r uid; do
      case "$uid" in ''|*[!0-9]*) continue ;; esac
      bus="/run/user/$uid/bus"
      [ -S "$bus" ] || continue
      user=$(getent passwd "$uid" | cut -d: -f1)
      [ -n "$user" ] || continue
      runuser -u "$user" -- env XDG_RUNTIME_DIR="/run/user/$uid" DBUS_SESSION_BUS_ADDRESS="unix:path=$bus" /usr/bin/systemctl --user daemon-reload
      runuser -u "$user" -- env XDG_RUNTIME_DIR="/run/user/$uid" DBUS_SESSION_BUS_ADDRESS="unix:path=$bus" /usr/bin/systemctl --user start airdrop-session.service
    done < /run/airdrop-upgrade-users
    rm -f /run/airdrop-upgrade-users
  fi
fi
