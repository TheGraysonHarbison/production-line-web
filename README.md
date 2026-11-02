# Production Line Web

Self-hosted, LAN-only scheduling for shared 3D printers. Book time slots on one or more printers from a calendar/timeline UI, see changes in real time across every open session, and let Home Assistant know when a slot expires.

**Status:** pre-release. See [docs/ROADMAP.md](docs/ROADMAP.md) for the build plan and [docs/DEV_DOCUMENT.md](docs/DEV_DOCUMENT.md) for the full specification.

## Requirements

- Node.js 26 or newer (standalone install), or Docker / Podman (container install)

## Install

Three supported paths. All of them serve the app on port 8080, open `http://<host>:8080/` to create the Owner account on first run. Set `PLW_PORT` before running an installer to use another port. Re-running an installer upgrades in place and keeps your data; the database migrates itself on start.

### Docker Compose

```bash
curl -fsSLO https://raw.githubusercontent.com/TheGraysonHarbison/production-line-web/main/scripts/install-docker.sh
bash install-docker.sh
```

Writes `~/production-line-web/compose.yaml` (image `ghcr.io/goblinfoddergames/production-line-web`, data on the `plw-data` volume, `TZ` from the host) and runs `docker compose up -d`. Upgrade: re-run the script. Remove: `docker compose -f ~/production-line-web/compose.yaml down` (add `-v` to delete the data volume).

### Podman (rootless, Quadlet)

```bash
curl -fsSLO https://raw.githubusercontent.com/TheGraysonHarbison/production-line-web/main/scripts/install-podman.sh
bash install-podman.sh
```

Installs `~/.config/containers/systemd/production-line.container` as a user service, starts it, and enables lingering so it comes back after a reboot. `AutoUpdate=registry` lets `podman auto-update` (or its timer) pull new images. Upgrade: re-run the script. Remove: `scripts/uninstall-podman.sh` (`--purge` also deletes the `plw-data` volume).

### Standalone (servers, Raspberry Pi 4/5 with a 64-bit OS)

Needs Node 26 or newer on the `PATH` (see <https://nodejs.org/en/download>); the installer never installs Node.

```bash
curl -fsSLO https://raw.githubusercontent.com/TheGraysonHarbison/production-line-web/main/scripts/install-standalone.sh
sudo bash install-standalone.sh                      # latest release
sudo bash install-standalone.sh --version v1.0.0-rc.1
sudo bash install-standalone.sh --from-source        # from inside a git checkout
```

Creates the `plweb` system user and `/var/lib/production-line` (the data directory, mode 0750), unpacks the release tarball into `/opt/production-line-web`, installs runtime dependencies with `npm ci --omit=dev`, and installs a hardened systemd unit (`ProtectSystem=strict`, only the data directory writable, `PrivateTmp`, `NoNewPrivileges`). Logs: `journalctl -u production-line -f`. Upgrade: re-run the installer. Remove: `sudo scripts/uninstall-standalone.sh`, which keeps `/var/lib/production-line` unless you pass `--purge`.

### Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | Listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` (standalone `/var/lib/production-line`, containers `/data`) | Database, secret key, images |
| `TZ` | unset | OS timezone for log timestamps; the app's timezone is set in Settings → General |
| `LOG_LEVEL` | `info` | pino level |
| `TRUST_PROXY` | `0` | Set `1` behind a reverse proxy |

## Development

```bash
npm ci
npm run dev      # client on :5173 (proxying /api), server on :8080
npm test         # unit + integration tests
npm run lint     # biome
npm run build    # production build into server/dist + server/public
npm start        # serve the production build on :8080
```

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for details.

## Images

An admin can turn on image uploads under **Settings → General**. Slots then accept photos (PNG, JPEG, TIFF, WEBP, and camera RAW: DNG, CR2, CR3, NEF, ARW, RAF, ORF, RW2) up to 10 MB each, and everyone can set a profile image. Files are checked by their actual bytes, stored under `DATA_DIR/images/`, and deleted with the slot. Browsers can't display TIFF or RAW, so those appear as a file card with a download link.

## Backups

**Settings → Backup** (admin) downloads a consistent copy of the database as `production-line-YYYYMMDD-HHMM.db`. It holds users, printers, slots, and settings, but not images. To restore: stop the app, replace `app.db` in the data directory with the file (removing any `app.db-wal` / `app.db-shm` beside it), and start the app again. If `secret.key` was lost too, re-enter the Home Assistant token.

## Home Assistant

When a slot's end time passes, the server deletes it and fires a native Home Assistant event, `production_line_slot_expired`, carrying the slot, its owner, and its printers. Automations trigger on it by `event_type`.

1. In Home Assistant open your profile (bottom-left) → **Security** → **Long-lived access tokens** → **Create token**. Copy it; HA shows it once.
2. In Production Line go to **Settings → Home Assistant** (admin). Enter the base URL of your HA instance, for example `http://homeassistant.local:8123`, paste the token, tick **Send events to Home Assistant**, and **Save**. The token is stored encrypted and never shown again.
3. Click **Test**. Production Line fires a `production_line_test` event and shows HA's answer. In HA, **Developer tools → Events → Listen to events** with `production_line_test` shows it arriving.

Example automation:

```yaml
triggers:
  - trigger: event
    event_type: production_line_slot_expired
actions:
  - action: notify.mobile_app_phone
    data:
      message: "{{ trigger.event.data.slot.name }} on {{ trigger.event.data.printers | map(attribute='name') | join(', ') }} is done."
```

The event data looks like this (`start_local`/`end_local` use the app timezone from Settings → General):

```json
{
  "slot": {
    "id": 42, "name": "Benchy batch", "description": "PLA, 0.2mm",
    "start_at": "2026-11-02T18:00:00Z", "end_at": "2026-11-02T21:30:00Z",
    "start_local": "2026-11-02T13:00:00-05:00", "end_local": "2026-11-02T16:30:00-05:00",
    "timezone": "America/New_York"
  },
  "user": { "id": 3, "username": "sam", "color": "#4f9cff" },
  "printers": [ { "id": 1, "name": "Prusa MK4" } ],
  "expired_at": "2026-11-02T21:30:14Z",
  "catch_up": false
}
```

Delivery is retried three times (2 s, then 8 s apart). If HA still can't be reached, the server logs `ha.delivery_failed` at `warn` with the whole payload so you can replay it, and the slot is removed anyway. Slots that expired while the server was down are sent on the next start with `"catch_up": true`.

## License

MIT
