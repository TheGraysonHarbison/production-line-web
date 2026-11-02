#!/usr/bin/env bash
# Upgrade test (dev doc §15.4, roadmap Phase 11): boot OLD_IMAGE on a fresh volume, create the
# owner and a printer, stop it, boot NEW_IMAGE on the same volume, and assert the app comes up
# with setup already done, the printer intact, and the migrations table present.
#   scripts/upgrade-test.sh OLD_IMAGE NEW_IMAGE
# CONTAINER_RUNTIME selects docker (default) or podman. Exits 0 with "skipped" when OLD_IMAGE
# cannot be pulled (nothing published yet), so a first release still passes CI.
set -euo pipefail
OLD="${1:?old image}"
NEW="${2:?new image}"
RT="${CONTAINER_RUNTIME:-docker}"
PORT="${UPGRADE_TEST_PORT:-18080}"
ID="plw-upgrade-$$"
VOL="$ID-data"
O="http://127.0.0.1:$PORT"
cleanup() { "$RT" rm -f "$ID" >/dev/null 2>&1 || true; "$RT" volume rm -f "$VOL" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if ! "$RT" image inspect "$OLD" >/dev/null 2>&1 && ! "$RT" pull --quiet "$OLD" >/dev/null 2>&1; then
  echo "upgrade-test: skipped ($OLD is not available)"
  exit 0
fi

boot() {
  "$RT" run -d --name "$ID" -p "127.0.0.1:$PORT:8080" -v "$VOL:/data" "$1" >/dev/null
  for _ in $(seq 1 60); do
    curl -fsS "$O/api/meta" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "upgrade-test: $1 did not become healthy" >&2
  "$RT" logs "$ID" >&2 || true
  exit 1
}
api() { curl -fsS -b "$JAR" -c "$JAR" -H "Origin: $O" -H 'content-type: application/json' "$@"; }
JAR="$(mktemp)"

echo "upgrade-test: booting $OLD"
"$RT" volume create "$VOL" >/dev/null
boot "$OLD"
api -d '{"username":"owner","password":"upgrade-test-pass","favorite_color":"#3366ff","timezone":"UTC"}' "$O/api/setup" >/dev/null
api -d '{"name":"Upgrade Printer"}' "$O/api/printers" >/dev/null
OLD_META="$(curl -fsS "$O/api/meta")"
"$RT" stop -t 10 "$ID" >/dev/null
"$RT" rm "$ID" >/dev/null

echo "upgrade-test: booting $NEW on the same volume"
boot "$NEW"
META="$(curl -fsS "$O/api/meta")"
case "$META" in *'"setup_required":false'*) ;; *) echo "upgrade-test: setup state lost: $META" >&2; exit 1 ;; esac
rm -f "$JAR"; JAR="$(mktemp)"
api -d '{"username":"owner","password":"upgrade-test-pass"}' "$O/api/auth/login" >/dev/null
PRINTERS="$(curl -fsS -b "$JAR" "$O/api/printers")"
case "$PRINTERS" in *'"Upgrade Printer"'*) ;; *) echo "upgrade-test: printer missing after upgrade: $PRINTERS" >&2; exit 1 ;; esac
MIGRATIONS="$("$RT" exec "$ID" node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("/data/app.db",{readOnly:true});console.log(db.prepare("select count(*) as n from schema_migrations").get().n)')"
[ "$MIGRATIONS" -ge 1 ] 2>/dev/null || { echo "upgrade-test: schema_migrations unreadable: $MIGRATIONS" >&2; exit 1; }
NEW_LOGS="$("$RT" logs "$ID" 2>&1 | grep -c '"level":[45][0-9]' || true)"
rm -f "$JAR"
echo "upgrade-test: ok — old meta $OLD_META; after upgrade $MIGRATIONS migration(s) recorded, printer retained, $NEW_LOGS warning/error log lines"
