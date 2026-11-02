# Production Line Web — Developer Document

**Status:** v1 planning · **Last updated:** 2026-10-31 · **License:** MIT

Production Line Web is a self-hosted, LAN-only scheduling app for shared 3D printers. Users book time slots on one or more printers from a calendar/timeline UI; changes appear in real time across every open session; expired slots notify Home Assistant. It ships as a Docker image, a Podman (Quadlet) unit, and a standalone systemd service for servers and Raspberry Pi 4/5.

This document is the single source of truth for scope, rules, architecture, and setup. Anything not in here is out of scope for v1.

---

## 1. Goals and non-goals

### Goals (v1)

- Hobbyist-friendly: one container or one script, zero cloud dependencies, zero native Node addons.
- Correct scheduling: no two slots can hold the same printer in overlapping time.
- Real-time: every session sees slot, printer, and settings changes within ~1 second.
- Mobile and desktop UI with a frosted-glass look tinted by each user's chosen color.
- Home Assistant receives an event with the slot's data when a slot expires.

### Explicitly deferred (not in v1)

| Deferred item | Notes for a future version |
|---|---|
| Slot history / usage stats | v1 hard-deletes expired slots after the HA event fires. A `history` table or soft-delete with retention is the natural v2 path. |
| Password reset | No email on a LAN. v2: Owner-issued temporary passwords. |
| HTTPS | v1 serves plain HTTP; the LAN is assumed trusted. See §9.6. |
| Recurring slots | Not planned. |
| HA event on slot *start* | Only `expired` fires in v1. The event bus is designed so `started` is a one-line addition. |
| Server-side image resizing / thumbnails | Originals are stored and served as-is to avoid native dependencies (`sharp`). |
| Printer status/telemetry (OctoPrint, Klipper) | Printers are names only. |

---

## 2. Glossary

- **Owner** — the single account created on first boot. Cannot be deleted or demoted. Only the Owner can transfer ownership, grant/revoke Admin, delete users, and toggle registration.
- **Admin** — can manage printers, global settings (except registration and roles), edit/delete any slot, and download backups.
- **User** — can create slots and edit/delete/extend their own.
- **Printer** — a bookable resource with a name and an `invisible` flag.
- **Slot** — a named booking with a start, an end, an owner (user), and one or more printers.
- **Expiry** — the moment `end_at` passes. The slot's data is sent to Home Assistant, its images are deleted, and the row is removed.

---

## 3. Functional rules

### 3.1 Accounts and roles

- Registration requires `username`, `password`, `favorite_color` (free hex color). Profile image is optional; default avatar is the first character of the username on the user's color.
- Usernames: 3–32 chars, `[A-Za-z0-9_.-]`, case-insensitive unique. Passwords: minimum 8 characters, maximum 128, no other composition rules.
- Duplicate or similar colors between users are allowed.
- Role matrix:

| Action | User | Admin | Owner |
|---|---|---|---|
| Create slots; edit/delete/extend own slots | ✓ | ✓ | ✓ |
| Edit/delete any slot | | ✓ | ✓ |
| Add/edit/delete printers | | ✓ | ✓ |
| Global settings: images, HA, timezone | | ✓ | ✓ |
| Download DB backup | | ✓ | ✓ |
| Toggle registration | | | ✓ |
| Grant / revoke Admin | | | ✓ |
| Delete users | | | ✓ |
| Transfer Owner | | | ✓ |

- Deleting a user cascades: their slots, slot–printer links, slot images, profile image, and sessions are all removed. Connected clients receive `slot.deleted` events for each affected slot.
- The Owner cannot be deleted or demoted. Ownership transfer makes the previous Owner an Admin.

### 3.2 Printers

- Fields: `name` (unique, 1–64 chars), `invisible` (boolean, default false).
- An invisible printer cannot be added to new or edited slots. Existing slots that include it are untouched and continue to display it.
- Deleting a printer that is part of existing slots is refused with a clear error listing the affected slots. (Prevents silently changing other users' bookings.)

### 3.3 Slots

- Fields: `name` (1–80 chars, required), `description` (≤ 2000 chars, optional), `start_at`, `end_at`, `user_id`, printers (≥ 1), images (0–n, only when images are enabled).
- **Granularity:** `start_at` and `end_at` are multiples of 5 minutes. A "start now" slot rounds to the nearest 5-minute mark.
- **Length:** minimum 5 minutes. No maximum, but `end_at` must be ≤ 30 days from the current time.
- **Past:** `start_at` may not be in the past (after rounding). `end_at` must be > `start_at`.
- **Conflict rule:** for every selected printer, no other slot may satisfy `other.start_at < new.end_at AND other.end_at > new.start_at`. The server is the authority; the client only pre-filters the printer list for the selected range.
- **Edit/extend:** any change to times or printers re-runs the conflict check excluding the slot being edited. Extending a running slot is allowed up to the start of the next slot on each of its printers. A running slot's `start_at` cannot be moved.
- **Permissions:** the slot's user, Admins, and the Owner may edit/delete. Others get `403`.
- **Multiple printers:** one slot row, many `slot_printers` rows. Conflicts are evaluated per printer.

### 3.4 Expiry

- An in-process scheduler ticks every 30 seconds and processes slots with `end_at <= now` in `end_at` order.
- Per slot: build the HA payload → send to HA (if enabled) → delete image files → delete the row → broadcast `slot.expired`.
- HA delivery: up to 3 attempts with 2s/8s backoff. Failure is logged at `warn` with the full payload so it can be replayed manually; the slot is still deleted (no history in v1).
- **Catch-up on startup:** any slots already expired when the server starts are processed in the same way. Each catch-up run writes an `info` log line `expiry.catchup` with the count and the list of slot IDs, and each slot's HA payload carries `"catch_up": true`.

### 3.5 Global settings

| Key | Default | Who |
|---|---|---|
| `registration_enabled` | `true` | Owner |
| `images_enabled` | `false` | Admin |
| `ha_enabled` | `false` | Admin |
| `ha_base_url` | — | Admin |
| `ha_token` (encrypted) | — | Admin (write-only; never returned to clients) |
| `timezone` | auto-detected at first boot | Admin |

Disabling images does not delete existing images; it blocks new uploads and hides the upload control. (Existing images remain viewable so slots don't silently lose content.)

### 3.6 Per-user preferences

- `time_format`: `12h` or `24h` (default `12h`).
- `favorite_color`, profile image.

### 3.7 First boot

1. On start, if `users` is empty, every route except `/setup` and static assets redirects to `/setup`.
2. The setup page creates the Owner (same fields as registration) and auto-detects the timezone from the browser, which is written to settings as the initial value.
3. The Owner is logged in and redirected to Admin Settings. From then on the app behaves normally.

This is intentionally not protected by a setup token; the deployment context is a trusted home LAN.

### 3.8 Images

- Enabled per the `images_enabled` setting; applies to slot images and profile images.
- Limit: 10 MB per file. Allowed: PNG, JPEG, TIFF, WEBP, and camera RAW (DNG, CR2, CR3, NEF, ARW, RAF, ORF, RW2).
- Validation is by magic bytes, not extension or `Content-Type`. Files are renamed to `<uuid>.<ext>` and stored under `DATA_DIR/images/`. Original filenames are kept in the DB for display.
- **Browser caveat (documented decision):** browsers render PNG/JPEG/WEBP inline. TIFF and RAW cannot be displayed by browsers and are shown as a file card with a download link. No conversion in v1.
- Slot images are deleted with the slot (expiry or manual delete). Profile images are deleted when replaced or when the user is deleted.

---

## 4. Tech stack

Principle: **zero native Node addons.** Everything builds and runs identically on x86-64 and arm64 with `npm ci` and nothing else, which is what makes the Pi and container targets painless.

| Layer | Choice | Why |
|---|---|---|
| Runtime | **Node.js 26 LTS** (`engines.node >= 26`) | Current LTS as of Oct 2026. Ships stable `node:sqlite`. |
| Language | **TypeScript** (strict) everywhere | Shared types between client and server. |
| Server framework | **Fastify 5** | Fast, schema-driven validation, first-party plugins for cookies, rate limiting, static files, multipart. |
| Validation | **Zod** (shared schemas in `packages/shared`) | Same rules validated on client and server. |
| Database | **SQLite via `node:sqlite`** (built-in `DatabaseSync`) | No compile step, WAL mode, single file, trivial backups. |
| Migrations | Hand-rolled: numbered `.sql` files in `server/migrations/`, applied in a transaction, tracked in `schema_migrations` | No ORM dependency for a ~8-table schema. |
| Password hashing | **`crypto.scrypt`** from `node:crypto` (N=2^17, r=8, p=1, 32-byte salt) | OWASP-acceptable, built-in, no native addon. |
| Secret encryption | **AES-256-GCM** via `node:crypto`; key in `DATA_DIR/secret.key` (generated on first boot, mode 0600) | Protects the HA token at rest. |
| Sessions | Server-side session table + signed `httpOnly`, `SameSite=Lax` cookie (`@fastify/cookie`) | Revocable on user delete/password change. No JWT. |
| Real-time | **Server-Sent Events** (`GET /api/stream`) | All traffic is server→client broadcast. Simpler than WebSockets, proxies cleanly, auto-reconnects. |
| Rate limiting | `@fastify/rate-limit` | 10 requests/min/IP on login and register. |
| Uploads | `@fastify/multipart` + `file-type` (magic bytes) | |
| Logging | **pino** (Fastify's default) → stdout, JSON | Containers and journald both capture stdout. |
| Frontend | **Vite + React 19 + TypeScript** | |
| Styling | **Tailwind CSS v4** | Color tokens set as CSS variables from the user's color. |
| Client state | TanStack Query for server data; SSE events invalidate/patch the cache | |
| Routing | React Router | |
| Dates | `Temporal` polyfill (`temporal-polyfill`) for timezone-correct math | Native `Date` + timezones is a bug factory. |
| Testing | **Vitest** (server + client unit/integration), **Playwright** (e2e, including mobile viewports) | |
| Lint/format | **Biome** | One tool, fast, no plugin matrix. |
| Package manager | npm workspaces | Already on every target. |
| Version control | Git, single repo, `main` + short-lived feature branches, conventional commits | |

---

## 5. Architecture

```
┌──────────────────────── Browser (React SPA) ────────────────────────┐
│  Calendar / Timeline  ·  Slot editor  ·  Settings  ·  SSE client    │
└────────────┬───────────────────────────────────────────┬────────────┘
             │ HTTPS/HTTP JSON (fetch)                   │ text/event-stream
┌────────────▼───────────────────────────────────────────▼────────────┐
│                     Node 26 · Fastify (single process)              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌──────────┐  │
│  │ auth     │ │ slots    │ │ printers │ │ settings  │ │ images   │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └─────┬─────┘ └────┬─────┘  │
│       └────────────┴───────┬────┴──────────────┴────────────┘       │
│                    ┌───────▼────────┐    ┌──────────────────┐       │
│                    │ event bus      │───▶│ SSE broadcaster  │       │
│                    │ (EventEmitter) │    └──────────────────┘       │
│                    └───────▲────────┘                               │
│  ┌─────────────────┐       │          ┌───────────────────┐         │
│  │ expiry scheduler│───────┘─────────▶│ Home Assistant    │──HTTP──▶ HA
│  │ (30s tick)      │                  │ client            │         │
│  └─────────────────┘                  └───────────────────┘         │
│                    ┌────────────────────────────┐                   │
│                    │ node:sqlite (WAL)          │                   │
│                    └────────────────────────────┘                   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                 DATA_DIR/  app.db · secret.key · images/
```

- One process, one SQLite file. No horizontal scaling; the target is a handful of users on a LAN. Fastify serves the built SPA from `client/dist` on the same port.
- Every mutation goes: validate → transaction → commit → emit event → respond. The SSE broadcaster forwards events to all authenticated connections.
- Client reconnect: on SSE reconnect the client refetches the visible day range, so missed events are harmless.

### 5.1 Real-time event catalogue

```
slot.created | slot.updated | slot.deleted | slot.expired      { slot }
printer.created | printer.updated | printer.deleted           { printer }
settings.updated                                               { keys: [...] }   (no secret values)
user.updated | user.deleted                                    { user: public fields }
```

---

## 6. Data model

```sql
users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,              -- "scrypt$N$r$p$salt$hash" (base64)
  color         TEXT NOT NULL,              -- "#RRGGBB"
  role          TEXT NOT NULL CHECK (role IN ('owner','admin','user')),
  time_format   TEXT NOT NULL DEFAULT '12h',
  avatar_image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL               -- ISO-8601 UTC
);
-- exactly one owner: partial unique index
CREATE UNIQUE INDEX users_single_owner ON users(role) WHERE role = 'owner';

sessions (
  id         TEXT PRIMARY KEY,              -- 32 random bytes, base64url
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL                  -- created + 30 days, sliding
);

printers (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  invisible INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

slots (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  start_at    TEXT NOT NULL,                -- ISO-8601 UTC, 5-min aligned
  end_at      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  CHECK (end_at > start_at)
);
CREATE INDEX slots_range ON slots(start_at, end_at);

slot_printers (
  slot_id    INTEGER NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  printer_id INTEGER NOT NULL REFERENCES printers(id) ON DELETE RESTRICT,
  PRIMARY KEY (slot_id, printer_id)
);
CREATE INDEX slot_printers_printer ON slot_printers(printer_id);

images (
  id            INTEGER PRIMARY KEY,
  slot_id       INTEGER REFERENCES slots(id) ON DELETE CASCADE,   -- NULL for avatars
  uploader_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stored_name   TEXT NOT NULL UNIQUE,       -- "<uuid>.<ext>" under DATA_DIR/images
  original_name TEXT NOT NULL,
  mime          TEXT NOT NULL,
  bytes         INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);

settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,                 -- JSON; ha_token stored as AES-GCM ciphertext
  updated_at TEXT NOT NULL
);

schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
```

`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;` on every connection. All timestamps are UTC ISO-8601 strings; the server never does timezone math except when rendering the HA payload's local-time fields.

**Conflict query** (run inside the write transaction, per printer):

```sql
SELECT s.id FROM slots s
JOIN slot_printers sp ON sp.slot_id = s.id
WHERE sp.printer_id = :printer_id
  AND s.id != :exclude_slot_id
  AND s.start_at < :new_end_at
  AND s.end_at   > :new_start_at
LIMIT 1;
```

---

## 7. API

All routes are under `/api`. JSON in, JSON out. Every route except `setup`, `login`, `register`, and `GET /api/meta` requires a valid session cookie; unauthenticated calls return `401`. Role violations return `403`. Validation errors return `400` with `{ error: "validation", issues: [...] }`. Conflicts return `409` with `{ error: "conflict", printers: [{ id, name, slot: { id, name, start_at, end_at, user: {...} } }] }`.

CSRF: cookie is `SameSite=Lax`; all mutating routes additionally require the `Origin` header to match the server's host, and reject otherwise.

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/api/meta` | — | `{ setup_required, registration_enabled, images_enabled, timezone }` |
| POST | `/api/setup` | — (only while no users) | Create Owner; sets `timezone` from body if settings empty |
| POST | `/api/auth/register` | — | Rate-limited 10/min/IP; `403` if registration disabled |
| POST | `/api/auth/login` | — | Rate-limited 10/min/IP |
| POST | `/api/auth/logout` | user | Deletes session |
| GET | `/api/me` | user | Own profile + preferences |
| PATCH | `/api/me` | user | color, time_format, password (requires `current_password`) |
| PUT | `/api/me/avatar` · DELETE | user | multipart; subject to image rules |
| GET | `/api/users` | user | Public fields only (id, username, color, role, avatar) |
| PATCH | `/api/users/:id/role` | owner | `admin` ↔ `user`; cannot target owner |
| POST | `/api/users/:id/transfer-ownership` | owner | Requires `current_password` |
| DELETE | `/api/users/:id` | owner | Cascades; cannot target owner |
| GET | `/api/printers` | user | Includes `invisible` flag (client hides from pickers) |
| POST | `/api/printers` · PATCH/DELETE `/:id` | admin | DELETE → `409` if printer is in any slot |
| GET | `/api/slots?from=&to=` | user | Range query, max 62 days |
| GET | `/api/slots/:id` | user | |
| POST | `/api/slots` | user | Conflict-checked |
| PATCH | `/api/slots/:id` | owner-of-slot / admin | Conflict-checked; running slots cannot change `start_at` |
| DELETE | `/api/slots/:id` | owner-of-slot / admin | Deletes images |
| POST | `/api/slots/:id/images` · DELETE `/:imageId` | owner-of-slot / admin | `403` if images disabled |
| GET | `/api/images/:storedName` | user | Served with `Content-Disposition` for non-browser types |
| GET | `/api/settings` | admin | `ha_token` returned as `{ set: true/false }` only |
| PATCH | `/api/settings` | admin (owner for `registration_enabled`) | |
| POST | `/api/settings/ha/test` | admin | Fires a `production_line_test` event |
| GET | `/api/backup` | admin | Streams `VACUUM INTO` copy of the DB as `production-line-YYYYMMDD-HHMM.db` |
| GET | `/api/stream` | user | SSE |

---

## 8. Home Assistant integration

**Mechanism:** Home Assistant REST API, `POST {ha_base_url}/api/events/production_line_slot_expired` with header `Authorization: Bearer <long-lived access token>`. This creates a native HA event that automations trigger on by `event_type`, and the token is stored AES-encrypted in `settings`.

(Alternative considered: an HA webhook trigger. Simpler, needs no token, but any LAN device that learns the URL can fire it, and the event is less structured. Not chosen.)

**Payload:**

```json
{
  "slot": {
    "id": 42,
    "name": "Benchy batch",
    "description": "PLA, 0.2mm",
    "start_at": "2026-11-02T18:00:00Z",
    "end_at":   "2026-11-02T21:30:00Z",
    "start_local": "2026-11-02T13:00:00-05:00",
    "end_local":   "2026-11-02T16:30:00-05:00",
    "timezone": "America/New_York"
  },
  "user":     { "id": 3, "username": "sam", "color": "#4f9cff" },
  "printers": [ { "id": 1, "name": "Prusa MK4" }, { "id": 2, "name": "Bambu P1S" } ],
  "expired_at": "2026-11-02T21:30:14Z",
  "catch_up": false
}
```

**Example HA automation:**

```yaml
triggers:
  - trigger: event
    event_type: production_line_slot_expired
actions:
  - action: notify.mobile_app_phone
    data:
      message: "{{ trigger.event.data.slot.name }} on {{ trigger.event.data.printers | map(attribute='name') | join(', ') }} is done."
```

Setup steps for the end user (goes in the README): create a long-lived access token in HA (Profile → Security), paste base URL and token into Admin Settings, click **Test**.

---

## 9. Security

1. **Authentication:** every `/api` route except setup/login/register/meta requires a session. Session IDs are 256-bit random, stored server-side, cookie is `httpOnly; SameSite=Lax; Path=/`. 30-day sliding expiry. All sessions for a user are revoked on password change and user deletion.
2. **Passwords:** scrypt (N=2^17, r=8, p=1), per-user 32-byte salt, constant-time compare. Parameters are stored in the hash string so they can be raised later.
3. **Authorization:** enforced in route handlers via a single `requireRole()` / `requireSlotAccess()` helper; never trusted from the client.
4. **Rate limiting:** login and register at 10/min per IP. Global default 300/min per IP as a backstop.
5. **Secrets at rest:** `ha_token` AES-256-GCM encrypted with the key in `DATA_DIR/secret.key`. The key is generated with `crypto.randomBytes(32)` on first boot. Losing it means re-entering the HA token, nothing else.
6. **Transport:** **plain HTTP in v1.** The deployment is a trusted home LAN. Consequences: credentials and cookies are visible to anyone sniffing the LAN; `Secure` cookies are not used. Users who want TLS can put Caddy or Nginx in front; the app honours `X-Forwarded-Proto` when `TRUST_PROXY=1`. Revisit in v2.
7. **Uploads:** magic-byte sniffing, 10 MB cap enforced at the multipart layer (connection is aborted, not buffered), random stored names, served from a dedicated route with `X-Content-Type-Options: nosniff` and `Content-Disposition: attachment` for TIFF/RAW.
8. **Headers:** `@fastify/helmet` with a CSP allowing only same-origin scripts/styles/images.
9. **Input:** every body/query/param validated with Zod before any DB access. SQL uses parameterised statements exclusively.
10. **Process:** containers run as non-root `node` user; the standalone service runs as a dedicated `plweb` system user with `ProtectSystem=strict`.

---

## 10. Timezone and time handling

- Storage and API: UTC ISO-8601 strings everywhere.
- `settings.timezone` (IANA name) is auto-detected from the browser at setup, editable by Admins. Used for the HA payload's `*_local` fields and as the display zone for all clients, so everyone on the LAN sees the same wall-clock times regardless of their device.
- Per-user `time_format` controls 12h/24h rendering only.
- Containers: set the `TZ` environment variable as well so logs match (documented in deploy files).
- All client-side math uses `Temporal.ZonedDateTime` with the settings timezone. DST transitions are handled by Temporal; the 5-minute rounding operates on UTC instants.

---

## 11. UI / UX

### 11.1 Layout

- **Desktop (≥ 1024px):** left dock (~280px), top to bottom: toolbar (today, view switch, new slot), an **Upcoming** list of the next five bookings across all printers (each opens in the editor), the printer list with per-printer availability for today plus the name and author of the slot printing now (or next up), then Settings directly above the current user's row. Main area: calendar or timeline.
- **Tablet (≥ 768px):** dock collapses to icons; printer list opens as a drawer.
- **Mobile (< 768px):** bottom tab bar (Calendar · Printers · New · Settings). Timeline is vertical and scrolls; slot editor is a full-screen sheet. Minimum touch target 44px. Tested in Playwright at 390×844 and 768×1024.

### 11.2 Views

- **Calendar (month):** days show stacked color bars per user with slots; tap → timeline.
- **Timeline (strip):** one lane per visible printer, horizontal on desktop, vertical on mobile. The strip is continuous: it starts on the hour at least an hour before now (or at the start of an earlier day opened from the calendar) and runs to the end of the day the 30-day booking horizon falls on, with date markers at each midnight and the printer labels pinned while it scrolls. `/day/:date` opens the strip scrolled to that day; Previous/Next day step the scroll, and a **Now** button returns to the current time. Slots render as glass cards tinted by their user's color; drag-to-create, drag either edge, and drag-to-move snap to 5 minutes and are clamped to the bookable window (never before the current 5-minute mark, never past the horizon). The past, the time beyond the horizon, and invisible printers render hatched; a press in a hatched area does nothing.
- **Slot editor:** name, description, start/end pickers (date input plus hour and minute selects; the minute list is the twelve 5-minute marks, so every browser offers the same grid), printer multi-select (printers conflicting with the chosen range are disabled with a tooltip showing who has them), images (when enabled).
- **Settings:** Profile (color picker, avatar, time format, password) · Printers (admin) · General (admin) · Home Assistant (admin) · Users (owner) · Backup (admin).

### 11.3 Theme

- Frosted glass: translucent surfaces (`backdrop-filter: blur(16px) saturate(140%)`), 1px semi-transparent borders, soft shadows. Light and dark variants follow `prefers-color-scheme`.
- The user's color seeds the palette: converted to OKLCH, then `--accent`, `--accent-soft`, `--accent-strong`, and `--on-accent` are derived by adjusting lightness/chroma while keeping hue. `--on-accent` is chosen (near-black or near-white) by contrast ratio so text on the user's color always meets WCAG AA. Because the picker is free-form, very light or very dark picks are nudged in lightness for UI surfaces but the raw color is kept for identity (avatar, slot bar).
- Other users' slots use *their* color; the current user's accent only drives chrome.
- `prefers-reduced-motion` disables blur-in transitions; `backdrop-filter` falls back to a solid semi-opaque surface where unsupported.

---

## 12. Repository layout

```
production-line-web/
├── package.json              # npm workspaces: client, server, packages/shared
├── biome.json
├── tsconfig.base.json
├── client/                   # Vite + React
│   ├── src/
│   └── vite.config.ts        # dev proxy → http://localhost:8080/api
├── server/                   # Fastify
│   ├── src/
│   │   ├── index.ts          # bootstrap, migrations, scheduler start
│   │   ├── routes/           # auth, slots, printers, settings, images, users, stream
│   │   ├── services/         # slots (conflict logic), expiry, ha, crypto, images
│   │   ├── db/               # connection, migrate.ts
│   │   └── events.ts         # typed EventEmitter
│   ├── migrations/           # 0001_init.sql, ...
│   └── test/
├── packages/shared/          # Zod schemas + TS types used by both sides
├── deploy/
│   ├── docker/Dockerfile
│   ├── docker/compose.yaml
│   ├── podman/production-line.container     # Quadlet
│   └── systemd/production-line.service
├── scripts/
│   ├── install-docker.sh
│   ├── install-podman.sh
│   ├── install-standalone.sh
│   ├── uninstall-standalone.sh
│   └── dev-setup-bazzite.sh
├── e2e/                      # Playwright
├── docs/                     # this file, README, HA guide, CONTRIBUTING
└── LICENSE                   # MIT
```

Build output: `client/dist` is copied into `server/public` at build time; the server serves it with SPA fallback.

---

## 13. Configuration (environment)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | Listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` (standalone: `/var/lib/production-line`; containers: `/data`) | DB, secret key, images |
| `TZ` | unset | OS timezone for logs; app timezone comes from settings |
| `LOG_LEVEL` | `info` | pino level |
| `TRUST_PROXY` | `0` | Set `1` behind a reverse proxy |

No other configuration exists outside the Admin Settings UI.

---

## 14. Development environment (Bazzite)

Bazzite is an immutable Fedora image; don't `rpm-ostree install` dev tooling. Host already has Podman, Distrobox, Node, npm, and Git. Two supported workflows:

### Option A — host tools via Homebrew (simplest)

```bash
brew install fnm                 # Node version manager
fnm install 26 && fnm use 26     # matches engines.node
# add `eval "$(fnm env --use-on-cd)"` to ~/.bashrc or ~/.zshrc
git clone <repo> && cd production-line-web
npm ci
npm run dev                      # client on :5173 (proxying /api), server on :8080
```

### Option B — Distrobox dev container (isolated, recommended for parity with CI)

```bash
distrobox create --name plw-dev --image quay.io/fedora/fedora-toolbox:latest
distrobox enter plw-dev
sudo dnf install -y nodejs npm git      # Fedora's current nodejs package (verify >= 26 with `node -v`; otherwise use fnm inside the box)
cd ~/production-line-web && npm ci && npm run dev
```

The home directory is shared, so the repo lives on the host either way. Podman on the host builds and runs the container image for testing:

```bash
podman build -t production-line-web:dev -f deploy/docker/Dockerfile .
podman run --rm -p 8080:8080 -v plw-data:/data production-line-web:dev
```

`scripts/dev-setup-bazzite.sh` automates Option A (installs fnm via brew, pins Node 26, runs `npm ci`, installs Playwright browsers).

### npm scripts

```
npm run dev          # concurrently: server (tsx watch) + client (vite)
npm run build        # client build → copy to server/public → server tsc
npm run start        # node server/dist/index.js
npm test             # vitest (unit + integration with a temp SQLite file)
npm run e2e          # playwright (desktop + mobile projects)
npm run lint         # biome check
npm run db:migrate   # apply pending migrations to $DATA_DIR
```

---

## 15. Deployment targets

All targets expect **Node 26** to be present on the host (standalone) or in the base image (containers). Install scripts set up and start the app; they do not install Node.

### 15.1 Docker

`deploy/docker/Dockerfile` — multi-stage, base `node:26-bookworm-slim`, builds client + server, final stage contains only production deps and `server/dist` + `server/public`, runs as `node`, exposes 8080, `HEALTHCHECK` on `GET /api/meta`. Images published multi-arch (`linux/amd64`, `linux/arm64`) via `docker buildx` in CI.

```yaml
# deploy/docker/compose.yaml
services:
  production-line:
    image: ghcr.io/goblinfoddergames/production-line-web:latest
    ports: ["8080:8080"]
    volumes: ["plw-data:/data"]
    environment:
      TZ: "America/New_York"
    restart: unless-stopped
volumes:
  plw-data:
```

`scripts/install-docker.sh`: checks for `docker`, writes `compose.yaml` to `~/production-line-web/`, runs `docker compose up -d`, prints the URL.

### 15.2 Podman (Quadlet)

Rootless Podman with systemd user units. `scripts/install-podman.sh` copies the Quadlet file to `~/.config/containers/systemd/`, runs `systemctl --user daemon-reload`, `systemctl --user start production-line` (Quadlet-generated units cannot be `enable`d; the generator honours the `[Install]` section instead), and runs `loginctl enable-linger $USER` so it starts at boot. `scripts/uninstall-podman.sh` removes the unit and, with `--purge`, the `plw-data` volume.

```ini
# deploy/podman/production-line.container
[Unit]
Description=Production Line Web

[Container]
Image=ghcr.io/goblinfoddergames/production-line-web:latest
PublishPort=8080:8080
Volume=plw-data:/data
Environment=TZ=America/New_York
AutoUpdate=registry

[Service]
Restart=always

[Install]
WantedBy=default.target
```

### 15.3 Standalone (servers, Raspberry Pi 4/5)

Requirements: 64-bit OS (Raspberry Pi OS 64-bit, Debian, Ubuntu, Fedora…), Node 26 on `PATH`. `scripts/install-standalone.sh`:

1. Verify `node -v` ≥ 26; abort with a link to the Node install docs otherwise.
2. Create system user `plweb` and `/var/lib/production-line` (owned by `plweb`, 0750).
3. Download the release tarball (prebuilt `server/dist` + `server/public` + `package-lock.json`) to `/opt/production-line-web`, run `npm ci --omit=dev` as `plweb`. (From-source install: `--from-source` flag runs `npm ci && npm run build` instead.)
4. Install `deploy/systemd/production-line.service`, `systemctl enable --now production-line`.
5. Print the URL.

```ini
[Unit]
Description=Production Line Web
After=network-online.target

[Service]
User=plweb
WorkingDirectory=/opt/production-line-web
Environment=DATA_DIR=/var/lib/production-line PORT=8080
ExecStart=/usr/bin/env node server/dist/index.js
Restart=on-failure
ProtectSystem=strict
ReadWritePaths=/var/lib/production-line
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

`scripts/uninstall-standalone.sh` stops the service and removes `/opt/production-line-web`; it leaves `/var/lib/production-line` unless `--purge` is passed.

### 15.4 Upgrades

- Containers: pull new image, restart. Migrations run on startup.
- Standalone: re-run the install script; it replaces `/opt/production-line-web` and restarts. Migrations run on startup.
- Migrations are forward-only. The backup endpoint (or copying `app.db` while stopped) is the rollback path.

---

## 16. Backups and data

- `DATA_DIR` is the only state: `app.db` (+ `-wal`/`-shm`), `secret.key`, `images/`.
- Admin UI → Backup downloads a consistent copy produced with `VACUUM INTO`. Images are **not** included in the download (they can be large and are expendable by design); the page says so.
- Restore: stop the app, replace `app.db`, start. If `secret.key` is lost, re-enter the HA token.

---

## 17. Logging and observability

- pino JSON to stdout; journald/Docker capture it. `LOG_LEVEL` env.
- Notable log events: `auth.login_failed` (username, IP), `auth.rate_limited`, `expiry.processed` (slot id, HA status), `expiry.catchup` (count, ids), `ha.delivery_failed` (payload), `user.deleted` (by, target, cascaded counts).
- `GET /api/meta` doubles as the health check.

---

## 18. Testing strategy

| Level | Tool | Covers |
|---|---|---|
| Unit | Vitest | 5-minute rounding, conflict math, palette derivation, Zod schemas, crypto helpers |
| Integration | Vitest + Fastify `inject()` + temp SQLite | Every route's auth/role matrix, conflict `409`s, extend-into-neighbour, user-delete cascade, expiry + catch-up (fake timers), HA client against a mock server |
| E2E | Playwright (desktop + mobile projects) | First-boot → owner → settings; create/edit/extend/delete slot; two browser contexts see each other's changes via SSE; image upload on/off |
| Build | CI | `npm ci`, lint, tests, multi-arch image build, container smoke test (`/api/meta`) |

---

## 19. Milestones

1. **M0 – Skeleton:** repo, workspaces, Biome, Fastify hello + Vite hello, Dockerfile builds on amd64/arm64.
2. **M1 – Core data:** migrations, users/sessions/scrypt, first-boot setup, printers CRUD, settings.
3. **M2 – Scheduling:** slots CRUD with conflict rule, extend rule, SSE, calendar + timeline UI (desktop).
4. **M3 – Mobile + theme:** responsive layouts, color palette derivation, frosted glass.
5. **M4 – Images + HA:** uploads, expiry scheduler with catch-up, HA client + test button.
6. **M5 – Ship:** install scripts for all three targets, README/HA guide, backup endpoint, Playwright suite, v1.0.0 tag.

---

## 20. Decisions and assumptions log

| # | Decision | Rationale |
|---|---|---|
| D1 | Podman target is an OCI image managed by Quadlet; Distrobox is used for the *dev* environment only | Distrobox is not a service-deployment tool |
| D2 | No slot history in v1 | Per product decision; schema leaves room for a `history` table |
| D3 | Plain HTTP in v1 | Trusted LAN; reverse proxy documented |
| D4 | No setup token on first boot | Hobbyist context; first visitor on a trusted LAN becomes Owner |
| D5 | `node:sqlite` over better-sqlite3; scrypt over argon2; no `sharp` | Zero native addons → painless arm64/containers |
| D6 | SSE over WebSockets | Broadcast-only traffic |
| D7 | HA REST events over HA webhooks | Authenticated, structured, filterable by `event_type` |
| D8 | TIFF/RAW accepted but not previewed | Browsers can't render them; conversion deferred |
| D9 | Deleting a printer in use is refused rather than cascaded | Avoids silently altering other users' bookings |
| D10 | App-wide display timezone from settings, not per-device | Everyone on the LAN talks about the same wall clock |
| D11 | Raspberry Pi 4/5 (arm64) only | 32-bit Pis are not viable with current Node |
| D12 | Node must be preinstalled on standalone hosts | Per product decision; scripts only set up and start the app |
