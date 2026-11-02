#!/usr/bin/env bash
# Production Line Web — standalone install / upgrade (dev doc §15.3, §15.4).
#
#   sudo ./install-standalone.sh                 # latest GitHub release
#   sudo ./install-standalone.sh --version v1.0.0-rc.1
#   sudo ./install-standalone.sh --tarball ./production-line-web-1.0.0.tar.gz
#   sudo ./install-standalone.sh --from-source   # run from a git checkout: npm ci && npm run build
#
# Re-running upgrades in place: the code tree under /opt/production-line-web is replaced, the
# data directory is never touched, and the service restarts (migrations run on startup).
# Environment overrides: PLW_PORT (default 8080), PLW_REPO (owner/name for release downloads).
set -euo pipefail

APP_DIR=/opt/production-line-web
DATA_DIR=/var/lib/production-line
SERVICE=production-line
SERVICE_USER=plweb
REPO="${PLW_REPO:-TheGraysonHarbison/production-line-web}"
PORT="${PLW_PORT:-8080}"
NODE_DOCS="https://nodejs.org/en/download"

VERSION=""
TARBALL=""
FROM_SOURCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --tarball) TARBALL="$2"; shift 2 ;;
    --from-source) FROM_SOURCE=1; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo)."
command -v systemctl >/dev/null || die "systemd is required."
command -v tar >/dev/null || die "tar is required."

# 1. Node ≥ 26 on PATH (we never install Node; see $NODE_DOCS).
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ] && [ -n "${SUDO_USER:-}" ]; then
  # A version manager (fnm, nvm) in the invoking user's shell is not visible to root's PATH.
  NODE_BIN="$(su - "$SUDO_USER" -c 'command -v node' 2>/dev/null || true)"
fi
[ -n "$NODE_BIN" ] || die "Node.js was not found. Install Node 26 or newer first: $NODE_DOCS"
NODE_BIN="$(readlink -f "$NODE_BIN")"
NODE_VERSION="$("$NODE_BIN" -v 2>&1)" || die "Node at $NODE_BIN does not run: $NODE_VERSION (official Linux builds need libatomic1 / libstdc++6)"
NODE_MAJOR="${NODE_VERSION#v}"; NODE_MAJOR="${NODE_MAJOR%%.*}"
[ "$NODE_MAJOR" -ge 26 ] 2>/dev/null || die "Node $NODE_VERSION found at $NODE_BIN; version 26 or newer is required: $NODE_DOCS"
NPM_CLI="$(dirname "$NODE_BIN")/../lib/node_modules/npm/bin/npm-cli.js"
[ -f "$NPM_CLI" ] || NPM_CLI="$(dirname "$NODE_BIN")/npm"
[ -e "$NPM_CLI" ] || die "npm was not found next to $NODE_BIN"
say "Using Node $("$NODE_BIN" -v) at $NODE_BIN"
case "$NODE_BIN" in
  /home/*|/root/*) echo "    note: Node lives under a home directory; it must stay readable by the '$SERVICE_USER' user." ;;
esac

# 2. Service user and data directory (0750, owned by plweb).
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  say "Creating system user $SERVICE_USER"
  if command -v useradd >/dev/null; then
    useradd --system --home-dir "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  else
    adduser --system --home "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  fi
fi
install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR"

# 3. Obtain the release tree.
WORK="$(mktemp -d /tmp/plw-install.XXXXXX)"
chmod 0755 "$WORK" # the service user must be able to enter it for npm ci
trap 'rm -rf "$WORK"' EXIT
if [ "$FROM_SOURCE" -eq 1 ]; then
  SRC="$(cd "$(dirname "$0")/.." && pwd)"
  [ -f "$SRC/package.json" ] && [ -d "$SRC/server/src" ] || die "--from-source must be run from scripts/ inside a git checkout."
  say "Building from source in $SRC"
  BUILD_AS="${SUDO_USER:-root}"
  su "$BUILD_AS" -s /bin/bash -c "cd '$SRC' && PATH='$(dirname "$NODE_BIN"):$PATH' '$NODE_BIN' '$NPM_CLI' ci && PATH='$(dirname "$NODE_BIN"):$PATH' '$NODE_BIN' scripts/release.mjs --no-build --out '$WORK/out'" \
    || die "build failed."
  TARBALL="$(ls "$WORK"/out/production-line-web-*.tar.gz)"
elif [ -z "$TARBALL" ]; then
  command -v curl >/dev/null || die "curl is required to download the release."
  if [ -z "$VERSION" ]; then
    VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)"
    [ -n "$VERSION" ] || die "could not determine the latest release of $REPO; pass --version vX.Y.Z or --tarball FILE."
  fi
  ASSET="production-line-web-${VERSION#v}.tar.gz"
  URL="https://github.com/$REPO/releases/download/$VERSION/$ASSET"
  say "Downloading $URL"
  curl -fsSL --retry 3 -o "$WORK/$ASSET" "$URL" || die "download failed: $URL"
  if curl -fsSL -o "$WORK/$ASSET.sha256" "$URL.sha256" 2>/dev/null; then
    (cd "$WORK" && sha256sum -c "$ASSET.sha256" >/dev/null) || die "checksum mismatch for $ASSET"
    say "Checksum verified"
  fi
  TARBALL="$WORK/$ASSET"
fi
[ -f "$TARBALL" ] || die "tarball not found: $TARBALL"

say "Unpacking $(basename "$TARBALL")"
mkdir -p "$WORK/tree"
tar -xzf "$TARBALL" -C "$WORK/tree" --strip-components=1
NEW_VERSION="$(cat "$WORK/tree/VERSION" 2>/dev/null || echo unknown)"

# 4. Runtime dependencies from the lockfile, as the service user, in a scratch cache.
say "Installing runtime dependencies (npm ci --omit=dev)"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$WORK/tree"
# A throwaway HOME so npm's cache and logs never land in the data directory.
install -d -m 0700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$WORK/home"
su "$SERVICE_USER" -s /bin/bash -c "cd '$WORK/tree' && HOME='$WORK/home' npm_config_cache='$WORK/home/.npm' PATH='$(dirname "$NODE_BIN"):/usr/bin:/bin' '$NODE_BIN' '$NPM_CLI' ci --omit=dev --workspace=packages/shared --workspace=server --no-audit --no-fund --loglevel=error" \
  || die "npm ci failed."
rm -rf "$WORK/home"
# Root owns the code tree; the service only needs to read it (ProtectSystem=strict).
chown -R root:root "$WORK/tree"
chmod -R a+rX "$WORK/tree"

# 5. Swap the tree in, install the unit and the Node path drop-in, (re)start.
say "Installing to $APP_DIR (version $NEW_VERSION)"
rm -rf "$APP_DIR.new"
mv "$WORK/tree" "$APP_DIR.new"
if [ -d "$APP_DIR" ]; then
  rm -rf "$APP_DIR.old"
  mv "$APP_DIR" "$APP_DIR.old"
fi
mv "$APP_DIR.new" "$APP_DIR"
rm -rf "$APP_DIR.old"

install -m 0644 "$APP_DIR/deploy/systemd/$SERVICE.service" "/etc/systemd/system/$SERVICE.service"
install -d -m 0755 "/etc/systemd/system/$SERVICE.service.d"
cat > "/etc/systemd/system/$SERVICE.service.d/10-install.conf" <<CONF
# Written by install-standalone.sh; edit 20-local.conf for your own overrides instead.
[Service]
Environment=PORT=$PORT
ExecStart=
ExecStart=$NODE_BIN server/dist/index.js
CONF
systemctl daemon-reload
systemctl enable "$SERVICE.service" >/dev/null 2>&1 || true
if systemctl is-active --quiet "$SERVICE.service"; then
  say "Restarting $SERVICE"
  systemctl restart "$SERVICE.service"
else
  say "Starting $SERVICE"
  systemctl start "$SERVICE.service"
fi

# 6. Wait for the health endpoint, then print the URL.
HOSTNAME_FQDN="$(hostname -f 2>/dev/null || hostname)"
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/api/meta" >/dev/null 2>&1; then
    echo
    say "Production Line Web $NEW_VERSION is running."
    echo "    http://${IP:-$HOSTNAME_FQDN}:$PORT/"
    [ -n "$IP" ] && echo "    http://$HOSTNAME_FQDN:$PORT/"
    echo "    data: $DATA_DIR   code: $APP_DIR   logs: journalctl -u $SERVICE -f"
    exit 0
  fi
  sleep 1
done
echo "The service did not answer within 60 s. Recent log:" >&2
journalctl -u "$SERVICE" -n 30 --no-pager >&2 || true
exit 1
