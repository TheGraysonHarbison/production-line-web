#!/usr/bin/env bash
# Production Line Web — rootless Podman (Quadlet) install / upgrade (dev doc §15.2, §15.4).
#   ./install-podman.sh
# Copies the Quadlet unit to ~/.config/containers/systemd/, starts it as a user service, and
# enables lingering so it comes up at boot without a login. Re-running pulls the newest image and
# restarts; `podman auto-update` does the same on its own because of AutoUpdate=registry.
# Environment overrides: PLW_PORT (8080), PLW_TZ (host timezone), PLW_IMAGE.
set -euo pipefail
say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

command -v podman >/dev/null || die "podman was not found: https://podman.io/docs/installation"
command -v systemctl >/dev/null || die "systemd (user services) is required."
[ "$(id -u)" -ne 0 ] || die "run as your normal user, not root (this is a rootless install)."
PODMAN_MAJOR="$(podman version --format '{{.Client.Version}}' | cut -d. -f1)"
[ "$PODMAN_MAJOR" -ge 4 ] 2>/dev/null || die "Podman 4.4 or newer is required for Quadlet (found $(podman version --format '{{.Client.Version}}'))."

PORT="${PLW_PORT:-8080}"
IMAGE="${PLW_IMAGE:-ghcr.io/thegraysonharbison/production-line-web:latest}"
TZ_VALUE="${PLW_TZ:-${TZ:-}}"
if [ -z "$TZ_VALUE" ]; then
  TZ_VALUE="$(cat /etc/timezone 2>/dev/null || timedatectl show -p Timezone --value 2>/dev/null || true)"
fi
TZ_VALUE="${TZ_VALUE:-UTC}"
UNIT_DIR="$HOME/.config/containers/systemd"
UNIT="$UNIT_DIR/production-line.container"

mkdir -p "$UNIT_DIR"
say "Writing $UNIT (port $PORT, TZ $TZ_VALUE)"
cat > "$UNIT" <<INI
# Production Line Web — written by install-podman.sh. Re-run the script to upgrade.
# TZ is the container's OS timezone (logs); the app's timezone is set in Settings → General.
# /data holds the database, secret key, and images on the plw-data volume.
[Unit]
Description=Production Line Web
After=network-online.target
Wants=network-online.target

[Container]
Image=$IMAGE
ContainerName=production-line
PublishPort=$PORT:8080
Volume=plw-data:/data
Environment=TZ=$TZ_VALUE
AutoUpdate=registry

[Service]
Restart=always
TimeoutStartSec=300

[Install]
WantedBy=default.target
INI

case "$IMAGE" in
  localhost/*) ;; # a locally built image: nothing to pull
  *) say "Pulling $IMAGE"; podman pull --quiet "$IMAGE" >/dev/null ;;
esac
say "Reloading user units"
systemctl --user daemon-reload
# Quadlet-generated units are enabled through their [Install] section by the generator itself;
# `systemctl enable` refuses generated units, so start (or restart for an upgrade) is all we do.
if systemctl --user is-active --quiet production-line.service; then
  say "Restarting production-line"
  systemctl --user restart production-line.service
else
  say "Starting production-line"
  systemctl --user start production-line.service
fi
if command -v loginctl >/dev/null; then
  say "Enabling lingering so the service starts at boot"
  loginctl enable-linger "$(id -un)" || echo "    could not enable lingering; run: sudo loginctl enable-linger $(id -un)"
fi

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/api/meta" >/dev/null 2>&1; then
    IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
    echo
    say "Production Line Web is running."
    echo "    http://${IP:-$(hostname)}:$PORT/"
    echo "    unit: $UNIT   logs: journalctl --user -u production-line -f"
    exit 0
  fi
  sleep 1
done
echo "The service did not answer within 60 s. Recent log:" >&2
journalctl --user -u production-line -n 30 --no-pager >&2 || true
exit 1
