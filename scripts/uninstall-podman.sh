#!/usr/bin/env bash
# Production Line Web — remove the rootless Podman (Quadlet) install.
#   ./uninstall-podman.sh            # stop the service and remove the unit; keep the plw-data volume
#   ./uninstall-podman.sh --purge    # ...and delete the plw-data volume (database, key, images)
set -euo pipefail
say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
PURGE=0
for arg in "$@"; do
  case "$arg" in
    --purge) PURGE=1 ;;
    -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done
UNIT="$HOME/.config/containers/systemd/production-line.container"
if [ -f "$UNIT" ]; then
  say "Stopping production-line"
  systemctl --user stop production-line.service 2>/dev/null || true
  rm -f "$UNIT"
  systemctl --user daemon-reload
fi
podman rm -f production-line >/dev/null 2>&1 || true
if [ "$PURGE" -eq 1 ]; then
  say "Removing the plw-data volume"
  podman volume rm -f plw-data >/dev/null 2>&1 || true
  say "Done. Nothing of Production Line Web remains (lingering was left as it was)."
else
  say "Done. Your data is still in the plw-data volume (re-run the installer to pick it up again, or --purge to delete it)."
fi
