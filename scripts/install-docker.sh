#!/usr/bin/env bash
# Production Line Web — Docker Compose install / upgrade (dev doc §15.1, §15.4).
#   ./install-docker.sh
# Writes compose.yaml to ~/production-line-web/, pulls the image, starts it, prints the URL.
# Re-running pulls the newest image and recreates the container; data stays on the plw-data volume.
# Environment overrides: PLW_PORT (8080), PLW_TZ (host timezone), PLW_IMAGE, PLW_DIR.
set -euo pipefail
say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "docker was not found. Install Docker Engine first: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "the 'docker compose' plugin is required: https://docs.docker.com/compose/install/"

DIR="${PLW_DIR:-$HOME/production-line-web}"
PORT="${PLW_PORT:-8080}"
IMAGE="${PLW_IMAGE:-ghcr.io/goblinfoddergames/production-line-web:latest}"
TZ_VALUE="${PLW_TZ:-${TZ:-}}"
if [ -z "$TZ_VALUE" ]; then
  TZ_VALUE="$(cat /etc/timezone 2>/dev/null || timedatectl show -p Timezone --value 2>/dev/null || true)"
fi
TZ_VALUE="${TZ_VALUE:-UTC}"

mkdir -p "$DIR"
say "Writing $DIR/compose.yaml (port $PORT, TZ $TZ_VALUE)"
cat > "$DIR/compose.yaml" <<YAML
# Production Line Web — written by install-docker.sh. Re-run the script to upgrade.
# TZ is the container's OS timezone (logs); the app's timezone is set in Settings → General.
# /data holds the database, secret key, and images on the plw-data volume.
services:
  production-line:
    image: $IMAGE
    container_name: production-line
    ports:
      - "$PORT:8080"
    volumes:
      - plw-data:/data
    environment:
      TZ: "$TZ_VALUE"
    restart: unless-stopped
volumes:
  plw-data:
YAML

cd "$DIR"
case "$IMAGE" in
  localhost/*) ;; # a locally built image: nothing to pull
  *) say "Pulling $IMAGE"; docker compose pull --quiet ;;
esac
say "Starting"
docker compose up -d --remove-orphans

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/meta" >/dev/null 2>&1; then
    IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
    echo
    say "Production Line Web is running."
    echo "    http://${IP:-$(hostname)}:$PORT/"
    echo "    files: $DIR/compose.yaml   logs: docker compose -f $DIR/compose.yaml logs -f"
    exit 0
  fi
  sleep 1
done
echo "The container did not answer within 30 s. Recent log:" >&2
docker compose logs --tail 30 >&2 || true
exit 1
