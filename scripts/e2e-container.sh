#!/usr/bin/env bash
# Runs the full Playwright suite against a container built from the given image (dev doc §18,
# roadmap Phase 12): a fresh anonymous /data volume so first boot is testable, the test-only
# rate-limit overrides, and PLW_E2E_EXTERNAL=1 so Playwright does not start its own server.
#   scripts/e2e-container.sh IMAGE [PORT]
# CONTAINER_RUNTIME selects docker (default) or podman.
set -euo pipefail
IMAGE="${1:?image}"
PORT="${2:-${PLW_E2E_PORT:-8080}}"
RT="${CONTAINER_RUNTIME:-docker}"
NAME="plw-e2e-$$"
cleanup() { "$RT" rm -f -v "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
# host.docker.internal lets the server reach the Home Assistant mock the admin spec hosts in the
# test process (Docker 20.10+ and Podman 4+ both understand host-gateway).
"$RT" run -d --name "$NAME" -p "127.0.0.1:$PORT:8080" -v /data \
  --add-host=host.docker.internal:host-gateway \
  -e LOG_LEVEL=warn -e RATE_LIMIT_MAX=100000 -e RATE_LIMIT_AUTH_MAX=100000 "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$PORT/api/meta" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/api/meta" >/dev/null || { echo "container did not become healthy" >&2; "$RT" logs "$NAME" >&2; exit 1; }
cd "$(dirname "$0")/.."
PLW_E2E_EXTERNAL=1 PLW_E2E_PORT="$PORT" PLW_E2E_HA_BIND=0.0.0.0 PLW_E2E_HA_HOST=host.docker.internal \
  npx playwright test -c e2e/playwright.config.ts "${@:3}"
