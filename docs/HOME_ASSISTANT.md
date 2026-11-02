# Home Assistant integration

When a slot's end time passes, Production Line deletes it and fires a native Home Assistant event, `production_line_slot_expired`. Automations trigger on it by `event_type`. Nothing is polled and no entities are created; the only traffic is one authenticated `POST` per expired slot.

## 1. Create a long-lived access token

In Home Assistant open your profile (your name at the bottom-left of the sidebar) → **Security** → **Long-lived access tokens** → **Create token**. Give it a name such as "Production Line" and copy the token. Home Assistant shows it only once.

A dedicated Home Assistant user with no administrator rights is enough; firing events does not need admin.

## 2. Enter it in Production Line

Signed in as an admin, go to **Settings → Home Assistant**:

1. **Base URL**: where Production Line can reach your instance from the server it runs on, for example `http://homeassistant.local:8123` or `http://192.168.1.20:8123`. Use `https://` if your Home Assistant is behind TLS.
2. **Token**: paste the token. It is stored encrypted with a key kept in the data directory and is never shown again; leave the field empty on later saves to keep the current one.
3. Tick **Send events to Home Assistant** and **Save**.

## 3. Test it

Click **Test**. Production Line fires a `production_line_test` event once (no retries) and shows Home Assistant's answer, for example `200 OK`, `401` for a bad token, or a connection error for a wrong URL.

To see it arrive, open Home Assistant's **Developer tools → Events**, enter `production_line_test` under **Listen to events**, click **Start listening**, and press **Test** again.

## 4. The event

`production_line_slot_expired` carries the slot, its owner, and its printers. Times are UTC ISO-8601 plus local copies in the app timezone from **Settings → General**. Instants are whole seconds.

```json
{
  "slot": {
    "id": 42,
    "name": "Benchy batch",
    "description": "PLA, 0.2mm",
    "start_at": "2026-11-02T18:00:00Z",
    "end_at": "2026-11-02T21:30:00Z",
    "start_local": "2026-11-02T13:00:00-05:00",
    "end_local": "2026-11-02T16:30:00-05:00",
    "timezone": "America/New_York"
  },
  "user": { "id": 3, "username": "sam", "color": "#4f9cff" },
  "printers": [ { "id": 1, "name": "Prusa MK4" }, { "id": 2, "name": "Bambu P1S" } ],
  "expired_at": "2026-11-02T21:30:14Z",
  "catch_up": false
}
```

`catch_up` is `true` for slots that expired while Production Line was not running; they are sent on the next start, oldest first, with `expired_at` set to when the server noticed.

## 5. Example automation

Notify a phone when any print slot finishes:

```yaml
alias: Print slot finished
triggers:
  - trigger: event
    event_type: production_line_slot_expired
actions:
  - action: notify.mobile_app_phone
    data:
      title: "Printer free"
      message: >-
        {{ trigger.event.data.slot.name }} by {{ trigger.event.data.user.username }}
        on {{ trigger.event.data.printers | map(attribute='name') | join(', ') }} is done.
```

Only react to one printer, or ignore catch-up events after a restart:

```yaml
triggers:
  - trigger: event
    event_type: production_line_slot_expired
conditions:
  - condition: template
    value_template: >-
      {{ 'Prusa MK4' in (trigger.event.data.printers | map(attribute='name') | list)
         and not trigger.event.data.catch_up }}
```

## 6. Delivery, retries, and replaying a failed event

Each event is tried up to three times, 2 s and then 8 s apart, with a 10 s timeout per attempt. The slot is removed from the schedule whether or not Home Assistant answered, so a down HA never blocks the printer.

If every attempt fails, the server logs one line at `warn` with the full payload:

```json
{"level":40,"msg":"ha.delivery_failed","eventType":"production_line_slot_expired","httpStatus":null,"error":"fetch failed","attempts":3,"payload":{ ... }}
```

To replay it once Home Assistant is back, pull the payload out of the log and post it yourself with the same token. With the standalone install:

```bash
# 1. Find the failed deliveries (Docker: `docker logs production-line`; Podman: `journalctl --user -u production-line`).
journalctl -u production-line -o cat | grep '"ha.delivery_failed"' > failed.jsonl

# 2. Replay each payload as the event it was meant to be.
HA=http://homeassistant.local:8123
TOKEN=...   # your long-lived token
while read -r line; do
  type=$(printf '%s' "$line" | jq -r .eventType)
  printf '%s' "$line" | jq -c .payload \
    | curl -fsS -X POST "$HA/api/events/$type" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' --data-binary @-
  echo
done < failed.jsonl
```

Each replay re-fires the event exactly as the automation expects; `catch_up` keeps whatever value the original attempt had.
