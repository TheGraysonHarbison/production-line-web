# Production Line Web — Feature Roadmap

**Status:** planning · **Last updated:** 2026-10-31 · **Companion to:** [DEV_DOCUMENT.md](./DEV_DOCUMENT.md)

This roadmap breaks the v1 scope in `DEV_DOCUMENT.md` into incremental phases that are built one after another. Phases are **not time-boxed**. Each one is a self-contained increment with an explicit entry state, a bounded scope, and an exit gate that must pass before the next phase starts. Section references (`§n`) point at `DEV_DOCUMENT.md`.

**Starting state:** the repository contains only `docs/DEV_DOCUMENT.md`. There is no `package.json`, no source, no CI, no deploy files. Phase 0 is therefore pure scaffolding and every later phase assumes only what earlier phases delivered.

---

## How to read this document

- **Phase numbering is the build order.** A phase may only depend on lower-numbered phases.
- **Scope lists are the contract.** Anything not listed in a phase is out of scope for that phase, even if the dev document describes it. It belongs to a later phase.
- **Exit gate** is a checklist that must be green (tests, manual checks, CI) before the next phase begins. Gates are deliberately mechanical so progress is verifiable.
- **Extension points** call out code written in a phase that a later phase will hook into, so the earlier phase leaves the seam in place instead of forcing a refactor later.
- Phases 0–12 deliver v1.0.0. Phases 13+ are post-v1 and map to the "Explicitly deferred" table in §1.

### Mapping to the dev document milestones (§19)

| Dev doc milestone   | Roadmap phases    |
| ------------------- | ----------------- |
| M0 – Skeleton       | Phase 0           |
| M1 – Core data      | Phases 1, 2, 3    |
| M2 – Scheduling     | Phases 4, 5, 6    |
| M3 – Mobile + theme | Phase 7           |
| M4 – Images + HA    | Phases 8, 9       |
| M5 – Ship           | Phases 10, 11, 12 |

### Dependency graph

```
P0 Foundation
└─ P1 Data layer & config
   └─ P2 Accounts, sessions, first boot
      └─ P3 Printers & global settings
         └─ P4 Slot engine (server)
            ├─ P5 Real-time (SSE)
            │  └─ P6 Desktop calendar & timeline
            │     └─ P7 Theme & responsive
            └─ P8 Expiry scheduler & Home Assistant
               └─ P9 Images
                  └─ P10 Backup, observability, hardening
                     └─ P11 Packaging & deployment
                        └─ P12 Docs, e2e, v1.0.0

Post-v1: P13 History · P14 HA start event · P15 Password reset · P16 TLS · P17 Thumbnails · P18 Telemetry
```

P5–P7 (UI track) and P8–P9 (background/integration track) only share P4 as a prerequisite. They are listed sequentially because the team is small, but they can be swapped or interleaved without breaking any gate. P10 requires both tracks complete.

### Cross-cutting conventions (apply from Phase 0 onward)

- Conventional commits on short-lived feature branches off `main` (§4).
- Every phase ends with a `main` commit that passes `npm run lint`, `npm test`, and `npm run build`, and (from Phase 0) a green CI run.
- Shared validation lives in `packages/shared` as Zod schemas; the server never duplicates rules in handler code and the client never invents its own (§4).
- Every mutation follows **validate → transaction → commit → emit event → respond** (§5). Phases 1–4 build that pipeline incrementally; later phases must not bypass it.
- All timestamps are UTC ISO-8601 strings in the DB and API (§10). Only the HA payload builder (Phase 8) and the client renderer (Phase 6) do timezone math, and only via `Temporal`.
- Zero native Node addons (§4, D5). Any proposed dependency is checked for a `binding.gyp` or prebuilt-binary install step before being added.

---

## Phase 0 — Repository foundation

**Goal:** turn the empty repo into a buildable, lintable, testable, containerisable monorepo with a "hello" server and client. No product features.

**Entry state:** `docs/DEV_DOCUMENT.md` only.

### Scope

Repository layout exactly as §12:

- Root `package.json` with npm workspaces `client`, `server`, `packages/shared`; `engines.node >= 26`; `.node-version` / `.nvmrc` pinned to 26.
- `tsconfig.base.json` (strict, `moduleResolution: bundler` for client, `node16`/`nodenext` for server), per-workspace `tsconfig.json` extending it.
- `biome.json` with lint + format; `npm run lint` wired.
- `.gitignore`, `.editorconfig`, `LICENSE` (MIT), stub `README.md`, stub `docs/CONTRIBUTING.md`.
- `packages/shared`: builds to ESM, exports an empty `index.ts` plus a single placeholder Zod schema to prove the import path works from both sides.
- `server`: Fastify 5 app factory (`buildApp()`) separated from the listener (`index.ts`) so tests can `inject()`. One route: `GET /api/meta` returning hard-coded `{ setup_required: true, registration_enabled: true, images_enabled: false, timezone: "UTC" }`. pino logging to stdout with `LOG_LEVEL`. `PORT` and `HOST` env vars (§13).
- `server`: static serving of `server/public` with SPA fallback via `@fastify/static`, so the production shape (one port) exists from day one.
- `client`: Vite + React 19 + TypeScript, React Router with a single route, Tailwind v4 installed and rendering one utility class. Dev proxy `/api → http://localhost:8080` in `vite.config.ts`.
- Root npm scripts from §14: `dev` (concurrently: `tsx watch` + `vite`), `build` (client build → copy to `server/public` → server `tsc`), `start`, `test`, `e2e` (placeholder), `lint`, `db:migrate` (placeholder that exits 0).
- Vitest configured in `server`, `client`, and `packages/shared` with one trivial test each. Playwright installed in `e2e/` with a config declaring `desktop`, `mobile` (390×844) and `tablet` (768×1024) projects and one smoke test that loads `/` and asserts the app mounts.
- `deploy/docker/Dockerfile`: multi-stage on `node:26-bookworm-slim`, final stage has production deps + `server/dist` + `server/public`, runs as `node`, `EXPOSE 8080`, `HEALTHCHECK` on `GET /api/meta` (§15.1).
- CI (GitHub Actions): on push/PR run `npm ci`, `lint`, `test`, `build`; build the image for `linux/amd64` and `linux/arm64` with buildx (no publish yet); run the container and curl `/api/meta` as a smoke test (§18 "Build").

### Out of scope

Database, migrations, auth, any real route, any UI beyond "it mounts".

### Exit gate

- [ ] `npm ci && npm run lint && npm test && npm run build && npm start` serves the SPA and `/api/meta` on `:8080` from a clean clone.
- [ ] `npm run dev` runs both processes; client reaches `/api/meta` through the proxy.
- [ ] `podman build -f deploy/docker/Dockerfile .` succeeds on the dev host; container answers `/api/meta`.
- [ ] CI green on `main`, including the arm64 image build.
- [ ] `npm ls` shows no package with a native build step.

---

## Phase 1 — Data layer and configuration core

**Goal:** persistent storage, migrations, secrets, crypto helpers, the typed event bus, and a test harness with a throwaway SQLite file. Still no user-facing features.

**Entry state:** Phase 0.

### Scope

- `server/src/config.ts`: typed loader for `PORT`, `HOST`, `DATA_DIR`, `LOG_LEVEL`, `TRUST_PROXY`, `TZ` with the defaults in §13. Fails fast with a clear message on invalid values.
- `DATA_DIR` bootstrap on startup: create `DATA_DIR`, `DATA_DIR/images/`; generate `secret.key` (32 random bytes, mode `0600`) if absent (§4, §9.5). Refuse to start if the key exists but is unreadable or the wrong length.
- `server/src/db/connection.ts`: `node:sqlite` `DatabaseSync` opener applying `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000` on every connection (§6).
- `server/src/db/migrate.ts`: numbered `.sql` files in `server/migrations/`, applied in order inside a transaction, tracked in `schema_migrations` (§4). Forward-only. Runs on server start and via `npm run db:migrate`.
- `server/migrations/0001_init.sql`: the complete §6 schema (`users`, `sessions`, `printers`, `slots`, `slot_printers`, `images`, `settings`, `schema_migrations`), including the single-owner partial unique index and all listed indexes. The whole v1 schema lands in one migration so later phases don't each ship a migration for tables that are already specified.
- `server/src/services/crypto.ts`: scrypt hash/verify producing `scrypt$N$r$p$salt$hash` with N=2^17, r=8, p=1, 32-byte salt, constant-time compare, parameters parsed from the stored string (§9.2); AES-256-GCM encrypt/decrypt using `secret.key` (§9.5).
- `server/src/events.ts`: typed `EventEmitter` with the full §5.1 catalogue declared as TypeScript types now, even though only `settings.updated` is emitted in this phase.
- `server/src/services/settings.ts`: get/set for the §3.5 keys, values stored as JSON, `ha_token` transparently encrypted on write and never returned by the public getter (a separate internal getter decrypts for the HA client in Phase 8). Seeds defaults on first run. Emits `settings.updated { keys }`.
- Test harness: a Vitest helper that creates a temp `DATA_DIR`, runs migrations, builds the app via `buildApp()`, and tears everything down. Used by every integration test from here on.
- `GET /api/meta` now reads `setup_required` (users table empty), `registration_enabled`, `images_enabled`, `timezone` from the DB/settings instead of hard-coding.

### Extension points

- `events.ts` types are the contract Phases 4, 5, 8 emit against.
- `settings.ts` internal decrypting getter is what Phase 8's HA client calls.

### Exit gate

- [ ] Unit tests: scrypt round-trip and parameter parsing; AES round-trip and tamper detection; migration runner applies `0001` once and is a no-op on second run; settings encrypt `ha_token` at rest (assert ciphertext in DB ≠ plaintext).
- [ ] Starting the server against an empty `DATA_DIR` creates `app.db`, `secret.key` (0600), and `images/`.
- [ ] `PRAGMA foreign_keys` and `journal_mode` verified in a test.
- [ ] CI green.

---

## Phase 2 — Accounts, sessions, and first boot

**Goal:** a person can visit a fresh install, become the Owner, log out, register another account (if enabled), log in, and manage their own profile. Roles exist and are enforced.

**Entry state:** Phase 1.

### Scope

Shared (`packages/shared`):

- Zod schemas: `username` (3–32, `[A-Za-z0-9_.-]`), `password` (8–128), `favorite_color` (`#RRGGBB`), `time_format` (`12h|24h`), register/login/setup bodies, `PATCH /api/me` body (color, time_format, password + `current_password`), public user shape (§3.1).

Server:

- `@fastify/cookie` with a signed `httpOnly; SameSite=Lax; Path=/` session cookie; `sessions` table rows with 32-byte base64url IDs and 30-day sliding expiry (§4, §9.1). A `preHandler` that loads the session and user onto `request`.
- `requireAuth()`, `requireRole('admin' | 'owner')`, and a `requireSlotAccess()` stub (real implementation in Phase 4) as the single authorization helpers (§9.3).
- CSRF guard: every mutating route rejects requests whose `Origin` doesn't match the server host; honours `X-Forwarded-Proto`/host when `TRUST_PROXY=1` (§7, §9.6).
- `@fastify/helmet` with the same-origin CSP (§9.8). `@fastify/rate-limit` at 10/min/IP on login and register, 300/min/IP global backstop (§9.4). Rate-limit hits log `auth.rate_limited`.
- Routes (§7): `POST /api/setup` (only while `users` is empty; creates Owner; writes `timezone` if unset; starts a session), `POST /api/auth/register` (403 when disabled), `POST /api/auth/login` (logs `auth.login_failed` with username + IP), `POST /api/auth/logout`, `GET /api/me`, `PATCH /api/me` (password change requires `current_password` and revokes all other sessions), `GET /api/users` (public fields), `PATCH /api/users/:id/role`, `POST /api/users/:id/transfer-ownership` (requires `current_password`; previous Owner becomes Admin), `DELETE /api/users/:id` (cannot target owner; cascades sessions and emits `user.deleted`; slot cascade is wired in Phase 4 and image cascade in Phase 9).
- Owner invariants enforced in service code and backed by the DB partial index: Owner can't be deleted or demoted; exactly one Owner.
- First-boot redirect: while `setup_required`, every non-`/setup`, non-static, non-`/api/meta` request redirects to `/setup` (§3.7).
- Avatar routes (`PUT/DELETE /api/me/avatar`) are **registered but return `403 images_disabled`** until Phase 9 — keeps the API surface stable.

Client:

- Auth context backed by TanStack Query (`/api/me`), route guards, and the first-boot redirect driven by `/api/meta`.
- Pages: Setup (username, password, color, auto-detected timezone from `Intl.DateTimeFormat().resolvedOptions().timeZone`), Login, Register (hidden when `registration_enabled` is false), and a minimal app shell with a sign-out control and a Profile settings page (color, time format, password). Plain Tailwind styling; theme work is Phase 7.
- Default avatar: first character of username on the user's color (§3.1).

### Out of scope

Printers, slots, settings UI other than Profile, Users admin UI (Phase 3), theme.

### Exit gate

- [ ] Integration tests cover the full §3.1 role matrix for every route in this phase (user/admin/owner × allowed/403), 401 for unauthenticated, setup refused once a user exists, registration 403 when disabled, rate limiting on login, owner can't be deleted/demoted, transfer-ownership swaps roles, password change revokes other sessions, CSRF rejects a mismatched `Origin`.
- [ ] Playwright: fresh install → `/setup` → Owner created → lands on the app; second context registers a user and logs in.
- [ ] Session cookie attributes verified in a test (`HttpOnly`, `SameSite=Lax`, no `Secure`).
- [ ] CI green.

---

## Phase 3 — Printers and global settings

**Goal:** Admins can define the bookable resources and configure the app; the Owner can manage users and registration. This completes the "Core data" milestone and gives Phase 4 the printers it needs.

**Entry state:** Phase 2.

### Scope

Shared: Zod schemas for printer (`name` 1–64 unique case-insensitive, `invisible` boolean) and the settings `PATCH` body (every §3.5 key with its type; `ha_base_url` validated as an `http(s)` URL; `timezone` validated as an IANA name via `Intl.supportedValuesOf('timeZone')` where available with a fallback check).

Server:

- `GET /api/printers` (all, including `invisible`), `POST /api/printers`, `PATCH /api/printers/:id`, `DELETE /api/printers/:id` (admin). Emits `printer.created|updated|deleted`. The delete-while-in-use `409` with affected slots is wired in Phase 4; in this phase the delete always succeeds because no slots exist.
- `GET /api/settings` (admin; `ha_token` returned as `{ set: boolean }`), `PATCH /api/settings` (admin; `registration_enabled` requires owner, else `403`), emitting `settings.updated` with the changed keys and never a secret value (§7, §5.1).
- `POST /api/settings/ha/test` registered but returns `501` until Phase 8 (keeps the UI and API shape stable).

Client:

- Settings page gains tabs per §11.2: **Profile** (from Phase 2), **Printers** (admin: list, add, rename, toggle invisible, delete), **General** (admin: images enabled, timezone), **Home Assistant** (admin: base URL, token write-only field showing "set/not set", Test button disabled with "available in a later version" until Phase 8), **Users** (owner: list, grant/revoke admin, delete, transfer ownership with password confirm, registration toggle). Tabs are hidden by role.
- Printers list in the app shell (names only; availability column comes in Phase 6).

### Exit gate

- [ ] Integration tests: printer name uniqueness is case-insensitive; `invisible` round-trips; settings role split (`registration_enabled` owner-only); `ha_token` never appears in any response body; `settings.updated` event payload contains only keys.
- [ ] Playwright: Admin adds a printer and changes the timezone; Owner toggles registration and sees the Register link disappear in a second context after reload (live update comes in Phase 5).
- [ ] CI green.

---

## Phase 4 — Slot engine (server)

**Goal:** the correctness core of the product: slots with the conflict rule, extend rule, permission rule, and all cascades. API-only; the UI consumes it in Phase 6.

**Entry state:** Phase 3.

### Scope

Shared:

- Zod slot schemas (§3.3): `name` 1–80, `description` ≤ 2000, `start_at`/`end_at` ISO-8601 UTC and 5-minute aligned, `printer_ids` non-empty, create/patch bodies, the `409` conflict response shape from §7, and the range query (`from`/`to`, ≤ 62 days).
- Pure helpers used by both sides: `roundToFiveMinutes(instant, 'nearest')`, `overlaps(a, b)`, `isRunning(slot, now)`.

Server (`services/slots.ts` + `routes/slots.ts`):

- Create: validate → in a write transaction, for each printer run the §6 conflict query → insert `slots` + `slot_printers` → commit → emit `slot.created` → respond `201`. Any conflict rolls back and returns `409` listing every conflicting printer with its blocking slot and owner.
- Rules enforced server-side: `start_at` not in the past after rounding; `end_at > start_at`; minimum 5 minutes; `end_at ≤ now + 30 days`; invisible printers rejected for new and edited slots (existing links untouched) (§3.2, §3.3).
- Update: re-runs the conflict check excluding the slot itself; a running slot's `start_at` cannot move; extending a running slot is allowed up to the next slot on each of its printers (the conflict query already expresses this, but the `409` message distinguishes "extend blocked by X" for the UI). Emits `slot.updated`.
- Delete: removes the row (cascade removes `slot_printers`), emits `slot.deleted`. Image file cleanup hook is a no-op stub until Phase 9.
- `requireSlotAccess()` implemented: slot owner, Admin, or Owner, else `403` (§3.3).
- `GET /api/slots?from=&to=` with the 62-day cap and `GET /api/slots/:id`, both returning printers and the public user embedded.
- Printer delete now returns `409` listing affected slots when any `slot_printers` row references it (§3.2, D9).
- User delete now cascades slots and emits one `slot.deleted` per affected slot before `user.deleted`; logs `user.deleted` with cascaded counts (§3.1, §17).

### Extension points

- `slots.ts` exposes `deleteSlot(id, reason: 'manual' | 'expired' | 'user_deleted')` so Phase 8 (expiry) and Phase 9 (image cleanup) hook the same code path.

### Exit gate

- [ ] Unit tests: 5-minute rounding at boundaries and across DST (UTC instants); overlap math including touching edges (`end == start` is not a conflict).
- [ ] Integration tests: single-printer conflict `409`; multi-printer slot conflicts on only one printer reports exactly that printer; edit excluding self; extend-into-neighbour blocked at the neighbour's `start_at` and allowed up to it; running slot `start_at` immutable; past start rejected; 30-day horizon; invisible printer rejected on create and on edit; printer delete `409` with slot list; user delete cascade emits `slot.deleted` per slot; full permission matrix for edit/delete.
- [ ] Concurrency test: two simultaneous creates for the same printer/time, exactly one succeeds (SQLite write transaction serialises; the test proves it).
- [ ] CI green.

---

## Phase 5 — Real-time (SSE)

**Goal:** every authenticated session sees slot, printer, settings, and user changes within about a second, and recovers cleanly from disconnects.

**Entry state:** Phase 4.

### Scope

Server:

- `GET /api/stream` (§7): requires a session; sets `text/event-stream`, disables buffering, sends a comment heartbeat every 15 s, assigns an `id` per event. The broadcaster subscribes to the Phase 1 event bus and forwards every §5.1 event as `event: <name>` + JSON `data`. Per-connection cleanup on close; connections are dropped when their session is revoked (user delete, password change).
- `settings.updated` carries keys only; `user.*` carries public fields only (enforced at the broadcaster, not trusted from emitters).

Client:

- `useEventStream()` hook using native `EventSource` with auto-reconnect. On each event, patch or invalidate the TanStack Query cache: `slot.*` patches the slot range queries, `printer.*` the printers list, `settings.updated` refetches `/api/meta` and settings, `user.*` the users list and `/api/me`.
- On reconnect (`open` after an `error`), refetch the visible range and the printers list so missed events are harmless (§5).
- Connection state surfaced in the shell (a small "reconnecting" indicator).

### Exit gate

- [ ] Integration tests: an unauthenticated stream request gets `401`; each emitted event type arrives with the expected payload shape; `settings.updated` for `ha_token` contains no value; revoking a session closes the stream.
- [ ] Playwright: two browser contexts; a printer created in one appears in the other without reload; a slot created via API appears in both.
- [ ] Manual: kill the server, restart; clients reconnect and refetch.
- [ ] CI green.

---

## Phase 6 — Desktop calendar and timeline UI

**Goal:** the primary booking experience on desktop (≥ 1024 px): month calendar, day timeline, slot editor, and the left dock. Plain styling; the glass theme and other breakpoints come in Phase 7.

**Entry state:** Phase 5.

### Scope

- `temporal-polyfill` installed; all client date math goes through a small `time.ts` module that uses `Temporal.ZonedDateTime` in the settings timezone and renders with the user's `time_format` (§10).
- **Left dock** (~280 px): toolbar (Today, Calendar/Timeline switch, New slot, Settings, avatar) and the printer list with per-printer availability for the selected range (free / booked until / booked by) (§11.1).
- **Calendar (month view):** days show stacked color bars per user; clicking a day opens the timeline for that day (§11.2).
- **Timeline (day view):** one horizontal lane per visible printer (invisible printers still show lanes for existing slots but accept no new ones); slots render as cards tinted with their user's color; drag-to-create and drag-to-resize snapping to 5 minutes; unavailable ranges hatched; current-time line; keyboard-accessible alternative to drag (click-to-create at a time, resize via the editor) (§11.2).
- **Slot editor** (modal on desktop): name, description, start/end pickers in 5-minute steps, printer multi-select where printers conflicting with the chosen range are disabled with a tooltip naming the owner and slot; image section hidden until Phase 9. Submit handles `400` (field errors) and `409` (highlights the conflicting printers with the returned info) (§11.2, §7).
- Edit/extend/delete from a slot card for slots the user may edit; running slots show a locked start time and an **Extend** affordance capped at the next slot.
- Client-side pre-filtering of the printer list is advisory only; the server remains the authority (§3.3).

### Exit gate

- [ ] Unit tests: `time.ts` formatting for 12h/24h; DST day rendering has the right number of lanes/ticks; drag snapping maths.
- [ ] Playwright (desktop project): create a slot by drag; edit it; extend a running slot (use an API-created slot that started in the past); delete it; attempt a conflicting booking and see the `409` surface; second context sees each change live.
- [ ] Accessibility pass: editor is fully keyboard-operable; focus is trapped in the modal; colour is never the only indicator of ownership (names shown).
- [ ] CI green.

---

## Phase 7 — Theme and responsive layouts

**Goal:** the frosted-glass look tinted by the user's color, light/dark variants, and the tablet and mobile layouts. Completes the "Mobile + theme" milestone.

**Entry state:** Phase 6.

### Scope

- **Palette derivation** (pure, tested module in `client/src/theme/`): user color → OKLCH → `--accent`, `--accent-soft`, `--accent-strong`, `--on-accent` by adjusting lightness/chroma with fixed hue; `--on-accent` chosen by WCAG AA contrast; very light/dark picks nudged for surfaces but the raw color kept for identity (avatar, slot bar) (§11.3). Exposed as CSS variables on `:root`; Tailwind v4 tokens read them.
- Other users' slots use their own color; the current user's accent drives chrome only.
- Frosted glass surfaces: `backdrop-filter: blur(16px) saturate(140%)`, 1 px translucent borders, soft shadows; `@supports` fallback to a solid semi-opaque surface; `prefers-color-scheme` light/dark; `prefers-reduced-motion` disables blur-in transitions (§11.3).
- **Tablet (≥ 768 px):** dock collapses to icons; printer list opens as a drawer (§11.1).
- **Mobile (< 768 px):** bottom tab bar (Calendar · Printers · New · Settings); vertical, scrolling timeline; slot editor as a full-screen sheet; 44 px minimum touch targets; drag interactions have tap equivalents (§11.1).
- Settings pages restyled to the theme; color picker in Profile shows a live preview.

### Exit gate

- [ ] Unit tests: palette derivation for a sample of hues including near-white, near-black, and highly saturated inputs; every `--on-accent` result meets 4.5:1 against `--accent`.
- [ ] Playwright `mobile` (390×844) and `tablet` (768×1024) projects: tab bar navigation, create/edit a slot via the sheet, printer drawer opens; no element under 44 px in the tap-target audit.
- [ ] Manual: light and dark modes on desktop and phone; reduced-motion honoured; `backdrop-filter` fallback verified in a browser with it disabled.
- [ ] CI green.

---

## Phase 8 — Expiry scheduler and Home Assistant

**Goal:** slots expire on schedule, Home Assistant receives a native event with the slot's data, and failures are visible and replayable. The "Images + HA" milestone, HA half.

**Entry state:** Phase 4 (and Phase 3 for the settings UI). Does not depend on Phases 5–7, but the HA settings tab from Phase 3 is where the Test button lives.

### Scope

Server:

- `services/expiry.ts`: in-process scheduler ticking every 30 s; selects `end_at <= now` ordered by `end_at`; per slot: build payload → deliver to HA if `ha_enabled` → `deleteSlot(id, 'expired')` → emit `slot.expired` (§3.4). Started from `index.ts` after migrations; stopped on shutdown.
- **Catch-up on startup:** one pass before the first tick processes already-expired slots, logs `expiry.catchup` with count and IDs, and sets `catch_up: true` in each payload (§3.4).
- `services/ha.ts`: `POST {ha_base_url}/api/events/production_line_slot_expired` with `Authorization: Bearer <decrypted token>` using global `fetch`; up to 3 attempts with 2 s / 8 s backoff; on final failure log `ha.delivery_failed` at `warn` with the full payload; the slot is still deleted (§3.4, §8). `expiry.processed` logged with slot id and HA status (§17).
- Payload builder exactly per §8, with `start_local`/`end_local`/`timezone` computed with `Temporal` from `settings.timezone`. This is the only server-side timezone math.
- `POST /api/settings/ha/test` now fires `production_line_test` with a minimal payload and returns the HA response status (§7).
- Graceful shutdown: SIGTERM stops the scheduler, finishes an in-flight slot, closes SSE connections and the DB.

Client:

- HA settings tab: Test button enabled; shows success/failure with the HTTP status. `slot.expired` handled by the SSE hook (slot disappears live).
- A small "expired" toast for the slot owner if they are online when their slot expires.

### Extension points

- The event name is a parameter of `ha.ts` so Phase 14 adds `production_line_slot_started` without touching delivery code (§1 deferred table).
- `deleteSlot(id, 'expired')` is where Phase 9 adds image file deletion.

### Exit gate

- [ ] Integration tests with fake timers: slot expires on the tick after `end_at`; multiple expired slots processed in `end_at` order; catch-up on boot processes pre-expired slots with `catch_up: true` and logs the ID list; HA retried 3× against a mock server that fails twice then succeeds; after 3 failures the payload is logged and the slot still deleted; disabled HA skips delivery entirely; `slot.expired` emitted once per slot.
- [ ] Payload snapshot test matches §8 exactly, including local-time fields for a DST-crossing slot.
- [ ] Manual: against a real Home Assistant instance, the Test button fires `production_line_test` and an automation on `production_line_slot_expired` triggers from a real expiry.
- [ ] CI green.

---

## Phase 9 — Images

**Goal:** slot images and profile avatars, gated by `images_enabled`, validated by magic bytes, cleaned up on every deletion path. Completes the "Images + HA" milestone.

**Entry state:** Phase 8 (for the expiry deletion path) and Phase 6 (for the editor UI).

### Scope

Server:

- `@fastify/multipart` with a 10 MB per-file limit that **aborts** the connection rather than buffering (§9.7); `file-type` magic-byte sniffing against the §3.8 allow-list (PNG, JPEG, TIFF, WEBP, DNG, CR2, CR3, NEF, ARW, RAF, ORF, RW2); reject on mismatch regardless of extension or `Content-Type`.
- `services/images.ts`: store as `<uuid>.<ext>` under `DATA_DIR/images/`, insert `images` row with original name, mime, bytes, uploader; delete file + row helpers that tolerate an already-missing file.
- Routes (§7): `POST /api/slots/:id/images`, `DELETE /api/slots/:id/images/:imageId` (slot access rule; `403 images_disabled` when off), `PUT/DELETE /api/me/avatar` (replaces Phase 2 stubs; replacing deletes the old file), `GET /api/images/:storedName` (session required; `X-Content-Type-Options: nosniff`; inline for PNG/JPEG/WEBP, `Content-Disposition: attachment` for TIFF/RAW) (§3.8, §9.7).
- Cleanup wired into every path: manual slot delete, expiry, user delete (slot images and avatar), avatar replace (§3.8). Slot and user payloads now include image metadata.
- Disabling `images_enabled` blocks new uploads but keeps existing images viewable (§3.5).

Client:

- Slot editor image section (visible only when enabled): multi-file upload with progress, thumbnails for browser-renderable types, a **file card with download link** for TIFF/RAW (§3.8 caveat, D8), delete control under the slot access rule.
- Slot card shows an image count; slot detail shows the gallery.
- Profile avatar upload/remove; avatar shown in the dock, user lists, and slot cards; fallback to the initial-on-color default.

### Exit gate

- [ ] Integration tests: each allowed type is accepted by magic bytes (fixture files); a renamed `.png` that is actually a script is rejected; `Content-Type: image/png` with wrong bytes is rejected; 10 MB + 1 byte aborts; uploads `403` when images are disabled; existing images still served when disabled; files removed from disk on slot delete, expiry, user delete, avatar replace; serving route sets `nosniff` and `attachment` for TIFF/RAW; unauthenticated image fetch gets `401`.
- [ ] Playwright: images on → upload PNG and a RAW fixture, see thumbnail and file card; images off → upload control hidden, existing image still visible.
- [ ] CI green.

---

## Phase 10 — Backup, observability, and hardening

**Goal:** the operational features and a line-by-line pass over §9 and §17 before packaging. No new product features.

**Entry state:** Phases 7 and 9 complete (both tracks).

### Scope

- `GET /api/backup` (admin): `VACUUM INTO` a temp file, stream it as `production-line-YYYYMMDD-HHMM.db`, delete the temp file (§7, §16). Backup settings tab with a download button and the note that images are not included.
- Observability audit against §17: every listed log event present with the listed fields (`auth.login_failed`, `auth.rate_limited`, `expiry.processed`, `expiry.catchup`, `ha.delivery_failed`, `user.deleted`); request logging at `info` with request IDs; `LOG_LEVEL` respected.
- Security audit against §9, item by item, recorded as a checklist in `docs/SECURITY_REVIEW.md`: session attributes, scrypt parameters, authorization helpers used on every route (a test asserts no `/api` route lacks `requireAuth` except the four public ones), rate limits, secret at rest, `TRUST_PROXY` handling of `X-Forwarded-Proto`, upload path, helmet CSP (verified not to break the SPA), Zod on every input, parameterised SQL only (grep gate in CI for string-concatenated SQL).
- Error handling: a single error handler maps Zod → `400 { error: "validation", issues }`, conflict → `409`, auth → `401/403`, everything else → `500` with no stack leakage; unknown `/api` paths return JSON `404`, not the SPA.
- Robustness: WAL checkpoint on shutdown; `busy_timeout` verified under a concurrent-write test; scheduler survives a thrown error in one slot and continues with the next.
- Performance sanity: seed 10 printers × 500 slots over 62 days and confirm range queries and the timeline render acceptably on a Pi-class CPU (document numbers; no hard target).

### Exit gate

- [ ] Backup downloads, opens in `sqlite3`, and restores by file replacement per §16.
- [ ] `docs/SECURITY_REVIEW.md` has every §9 item ticked with a pointer to the enforcing code or test.
- [ ] Route-coverage test proves every `/api` route is behind auth or on the explicit public list.
- [ ] CI green.

---

## Phase 11 — Packaging and deployment

**Goal:** the three supported install paths work end-to-end on real targets, and CI publishes multi-arch images. The "Ship" milestone, deployment half.

**Entry state:** Phase 10.

### Scope

- `deploy/docker/Dockerfile` finalised (non-root `node`, healthcheck, production deps only) and `deploy/docker/compose.yaml` per §15.1. `scripts/install-docker.sh`: checks for `docker`, writes `compose.yaml` to `~/production-line-web/`, `docker compose up -d`, prints the URL.
- `deploy/podman/production-line.container` (Quadlet, `AutoUpdate=registry`) and `scripts/install-podman.sh`: copy unit, `daemon-reload`, `enable --now`, `loginctl enable-linger` (§15.2).
- `deploy/systemd/production-line.service` with the §15.3 hardening (`ProtectSystem=strict`, `ReadWritePaths`, `PrivateTmp`, `NoNewPrivileges`, dedicated `plweb` user). `scripts/install-standalone.sh`: Node ≥ 26 check with a link on failure, user + `/var/lib/production-line` (0750), release tarball to `/opt/production-line-web`, `npm ci --omit=dev` as `plweb`, `--from-source` flag, enable + start, print URL. `scripts/uninstall-standalone.sh` with `--purge` (§15.3). Scripts are POSIX-sh-compatible or clearly `#!/usr/bin/env bash`, idempotent, and safe to re-run for upgrades (§15.4).
- `scripts/dev-setup-bazzite.sh`: installs fnm via brew, pins Node 26, `npm ci`, installs Playwright browsers (§14).
- Release build: a `release` npm script producing the tarball (`server/dist`, `server/public`, `package.json`, `package-lock.json`, migrations) that the standalone installer consumes.
- CI: on tag `v*`, build and push `ghcr.io/thegraysonharbison/production-line-web` for `linux/amd64` + `linux/arm64` with `:latest` and `:<version>` tags, attach the release tarball to the GitHub release, run the container smoke test against the pushed image.
- Upgrade test in CI: start version N−1 image with a seeded volume, swap to N, assert migrations applied and data intact (§15.4).
- `TZ` documented in all deploy files; `DATA_DIR` defaults per target (§13).

### Exit gate

- [ ] Docker path verified on an x86-64 host; Podman Quadlet path verified rootless on the Bazzite dev host; standalone path verified on a Raspberry Pi 4 or 5 (64-bit OS) from the tarball.
- [ ] Each installer prints a URL that serves `/setup` on a fresh install and the app after upgrade with data retained.
- [ ] Uninstall with and without `--purge` behaves per §15.3.
- [ ] CI publishes a pre-release tag (`v1.0.0-rc.1`) successfully to GHCR for both architectures.

---

## Phase 12 — Documentation, end-to-end suite, and v1.0.0

**Goal:** everything a hobbyist needs to install, configure, and use the app without reading source, plus the full automated e2e suite. Tag v1.0.0.

**Entry state:** Phase 11.

### Scope

- `README.md`: what it is, screenshots (desktop + phone), the three install paths, environment variables, backup/restore, upgrade, reverse-proxy TLS note (§9.6), troubleshooting.
- `docs/HOME_ASSISTANT.md`: token creation, settings entry, Test button, the §8 payload, the example automation, and a replay recipe for `ha.delivery_failed` log lines.
- `docs/CONTRIBUTING.md`: dev setup (both Bazzite options), scripts, test layers, conventional commits, how to add a migration, the zero-native-addon rule.
- `CHANGELOG.md` seeded from conventional commits.
- Playwright suite complete per §18: first-boot → owner → settings; create/edit/extend/delete slot; two contexts via SSE; image upload on/off; all three viewport projects; runs in CI against the built container.
- Final consistency pass: `DEV_DOCUMENT.md` updated where implementation deliberately diverged, with the decision added to §20.
- Tag `v1.0.0`; CI publishes images and the tarball; GitHub release notes.

### Exit gate

- [ ] A person following only the README installs on a fresh target and books a slot.
- [ ] Full e2e suite green in CI on the release image.
- [ ] `v1.0.0` images available for both architectures; tarball attached; installers point at them.

---

# Post-v1 phases

These correspond to the "Explicitly deferred" table in §1 and the v2 notes in §9.6. Each is independent unless stated; order below is a suggested priority, not a dependency chain. Each gets its own design addendum to `DEV_DOCUMENT.md` before implementation.

## Phase 13 — Slot history and usage stats

- New migration: `slot_history` table populated at expiry and manual delete (snapshot of slot, printers, user, reason, timestamps) with a retention setting (`history_retention_days`, Admin). Images are still deleted at expiry; history is metadata only.
- `GET /api/history?from=&to=` (user sees own; admin sees all) and a History settings tab with per-printer and per-user totals for a range; CSV export.
- Replaces the "no history" caveat in §3.4; the HA failure log remains the replay path for integration, history is for people.

## Phase 14 — Home Assistant slot-started event (and richer integration)

- `production_line_slot_started` fired by the scheduler when `start_at` passes (one-line addition per §1, using the Phase 8 extension point). Payload mirrors the expired one with `started_at`.
- Optional: `production_line_slot_created/updated/deleted` events behind a setting, and a per-printer `sensor`-friendly summary endpoint for HA REST sensors.

## Phase 15 — Owner-issued password reset

- `POST /api/users/:id/reset-password` (owner) issues a one-time temporary password shown once in the UI; flag `must_change_password` on the user; login with a temporary password forces a change before any other route works; all other sessions revoked (§1 deferred table).

## Phase 16 — Optional TLS

- `TLS_CERT`/`TLS_KEY` env vars enabling HTTPS directly in Fastify, `Secure` cookies when TLS or `TRUST_PROXY` with `X-Forwarded-Proto: https`, HSTS off by default (LAN names), docs for self-signed certs and Caddy/Nginx (§9.6). Keep plain HTTP as the default.

## Phase 17 — Image previews without native addons

- Client-side downscaling before upload for PNG/JPEG/WEBP (canvas), stored alongside the original as `thumb_<uuid>.webp`; a pure-JS or WASM decoder evaluated for TIFF/RAW previews (must honour D5: no `sharp`, no native build). Thumbnails used on slot cards and the calendar.

## Phase 18 — Printer status and telemetry

- Optional per-printer `integration` config (OctoPrint, Moonraker/Klipper, Bambu) polled server-side; status badge on printer lanes; a "printer busy outside a slot" warning; no control actions in the first cut. Printers remain usable as names-only.

## Not on the roadmap

- **Recurring slots** — explicitly "not planned" in §1. Revisit only if real usage shows a need.
- **Multi-instance / horizontal scaling** — out of scope by architecture (§5).
- **Cloud or remote access** — the product is LAN-only by design; users who want it put a VPN in front.

---

## Open questions to settle inside the phase that owns them

| Question                                                                                                      | Owner phase | Why it matters                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `node:sqlite` API surface on Node 26 LTS (transactions, `busy_timeout` behaviour, prepared-statement caching) | 1           | The migration runner and conflict transaction depend on it. Verify before writing the service layer.                           |
| Whether `@fastify/multipart` can hard-abort at the size limit without buffering the body                      | 9           | §9.7 says abort, not buffer. If the plugin can't, a raw stream handler is needed.                                              |
| `Intl.supportedValuesOf('timeZone')` availability on the server runtime for IANA validation                   | 3           | Fallback is constructing a `Temporal.TimeZone` and catching.                                                                   |
| Drag-and-drop on touch (vertical timeline) vs. tap-to-create only                                             | 7           | §11.2 specifies drag; mobile may need long-press to start a drag so it doesn't fight scrolling.                                |
| Tailwind v4 + CSS variables from OKLCH in older Safari                                                        | 7           | OKLCH support and `backdrop-filter` prefixes; fallback path must be tested.                                                    |
| Catch-up ordering when many slots expired during downtime and HA is unreachable                               | 8           | 3 retries × up to 10 s per slot can delay startup; decide whether catch-up delivery runs concurrently or with a bounded queue. |
| Release tarball vs. git-clone-and-build for `--from-source` on the Pi                                         | 11          | Building Vite on a Pi 4 is slow; the tarball is the default for a reason.                                                      |
