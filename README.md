# Production Line Web

Self-hosted, LAN-only scheduling for shared 3D printers. Book time slots on one or more printers from a calendar/timeline UI, see changes in real time across every open session, and let Home Assistant know when a slot expires.

**Status:** pre-release. See [docs/ROADMAP.md](docs/ROADMAP.md) for the build plan and [docs/DEV_DOCUMENT.md](docs/DEV_DOCUMENT.md) for the full specification.

## Requirements

- Node.js 26 or newer

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
