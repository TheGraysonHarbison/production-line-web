#!/usr/bin/env bash
# Production Line Web — standalone uninstall (dev doc §15.3).
#   sudo ./uninstall-standalone.sh            # stop + remove the service and /opt/production-line-web
#   sudo ./uninstall-standalone.sh --purge    # ...and delete /var/lib/production-line and the plweb user
set -euo pipefail
APP_DIR=/opt/production-line-web
DATA_DIR=/var/lib/production-line
SERVICE=production-line
SERVICE_USER=plweb
PURGE=0
for arg in "$@"; do
  case "$arg" in
    --purge) PURGE=1 ;;
    -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)." >&2; exit 1; }
say() { printf '\033[1m==>\033[0m %s\n' "$*"; }

if [ -f "/etc/systemd/system/$SERVICE.service" ]; then
  say "Stopping and disabling $SERVICE"
  systemctl disable --now "$SERVICE.service" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/$SERVICE.service"
  rm -rf "/etc/systemd/system/$SERVICE.service.d"
  systemctl daemon-reload
fi
say "Removing $APP_DIR"
rm -rf "$APP_DIR" "$APP_DIR.old" "$APP_DIR.new"
if [ "$PURGE" -eq 1 ]; then
  say "Purging $DATA_DIR and user $SERVICE_USER"
  rm -rf "$DATA_DIR"
  if id -u "$SERVICE_USER" >/dev/null 2>&1; then
    userdel "$SERVICE_USER" 2>/dev/null || deluser "$SERVICE_USER" 2>/dev/null || true
  fi
  say "Done. Nothing of Production Line Web remains."
else
  say "Done. Your data is still in $DATA_DIR (re-run the installer to pick it up again, or --purge to delete it)."
fi
