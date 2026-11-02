# Contributing

## Workflow

- Every roadmap phase is built on its own branch (`phase-N-<slug>`) and merged into `main` only after its exit gate passes and the repository owner has reviewed it.
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `ci:`).
- `npm run lint`, `npm test`, and `npm run build` must pass before pushing.

## Setup

Requires Node 26. Install dependencies with `npm ci`. Run `npm run dev` for the client (`:5173`) and server (`:8080`) in watch mode. The shared package is rebuilt in watch mode too.

## Layout

```
packages/shared/   Zod schemas and types used by client and server
server/            Fastify API, serves the built client from server/public
client/            Vite + React SPA
e2e/               Playwright tests
deploy/            Docker, Podman (Quadlet), systemd
scripts/           install and helper scripts
```

## Container builds

Podman builds OCI-format images by default, which drops the `HEALTHCHECK` instruction. Use `--format docker` when the healthcheck matters locally; Docker/buildx in CI keeps it.

```bash
podman build --format docker -t production-line-web:dev -f deploy/docker/Dockerfile .
podman run --rm -p 8080:8080 -v plw-data:/data production-line-web:dev
```

On a host where `localhost` resolves to IPv6 first, test with `http://127.0.0.1:8080` since rootless Podman maps IPv4 by default.

## Releases and deployment (Phase 11)

- `npm run release` builds everything and writes `release/production-line-web-<version>.tar.gz` (+ `.sha256`): built server and client, migrations, the lockfile and workspace manifests, the systemd unit, and the standalone install scripts. `--no-build` reuses an existing build, `--version X.Y.Z` overrides the manifest version (CI passes the tag).
- `deploy/` holds the Dockerfile, `compose.yaml`, the Quadlet unit, and the systemd unit; `scripts/install-*.sh` are the user-facing installers (idempotent; re-running upgrades). Every deploy file documents `TZ` and the `DATA_DIR` default for its target (dev doc §13).
- `scripts/upgrade-test.sh OLD NEW` boots OLD on a fresh volume, seeds an owner and a printer, then boots NEW on the same volume and asserts the data and migrations survive. CI runs it against the last published `:latest` (skipped until one exists); locally use `CONTAINER_RUNTIME=podman`.
- `.github/workflows/release.yml` runs on `v*` tags: lint/test/build, multi-arch push to `ghcr.io/goblinfoddergames/production-line-web` (`:<version>`, plus `:latest` for non-pre-releases), smoke and upgrade tests against the pushed image, and a GitHub release carrying the tarball. `GITHUB_TOKEN` can only push packages under the repository owner's namespace; add a `GHCR_TOKEN` secret with `write:packages` on the organisation if the repo and the image live under different owners.
- The standalone path can be rehearsed without a Pi in a systemd container: build a `debian:trixie` image with `systemd` and `libatomic1` installed, run it rootless with `podman run --systemd=always --privileged --security-opt label=disable` (the unit's mount sandboxing needs `CAP_SYS_ADMIN`, and SELinux would otherwise block the bind mounts), bind-mount a Node 26 tree and the repo, and run `scripts/install-standalone.sh --tarball …` inside it. Under `--platform linux/arm64` QEMU user-mode emulation the container's systemd cannot spawn any service (journald fails the same way), so on arm64 only the tarball unpack, `npm ci`, and a direct `node server/dist/index.js` run as `plweb` can be checked; the unit itself needs real hardware.

## Database and migrations

- SQLite via `node:sqlite`, one file at `$DATA_DIR/app.db`, WAL mode. Every connection sets `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- Migrations are numbered SQL files in `server/migrations/` (`0002_short_name.sql`). They run automatically on server start and via `npm run db:migrate` (built) or `npm run db:migrate -w server` (from source). Each file runs in its own transaction and is recorded in `schema_migrations`. Forward-only: never edit a shipped migration; add a new one.
- `secret.key` in `$DATA_DIR` is the AES-256-GCM key for secrets at rest (the Home Assistant token). Losing it only means re-entering that token.

## Test-only environment overrides

`RATE_LIMIT_MAX` raises the global per-IP request backstop (default 300/min) and `RATE_LIMIT_AUTH_MAX` the login/register limit (default 10/min). They exist so the Playwright suite, whose browser contexts all share one IP, is not throttled. It is not a supported production setting and is intentionally undocumented in the README.

## Auth and API conventions

- Sessions are server-side rows referenced by a signed `plw_session` cookie (`httpOnly`, `SameSite=Lax`, `Path=/`, not `Secure` in v1). `request.user` is populated by the auth plugin; routes guard with `requireAuth` / `requireRole("admin" | "owner")`.
- Every mutating request (`POST`, `PUT`, `PATCH`, `DELETE`) must send an `Origin` header matching the server's origin, or it is rejected with `403 csrf_origin_*`. Browsers do this automatically; scripts and tests must set it explicitly.
- Errors are JSON: `{ error: "<code>", message?, issues? }`. Zod failures are `400 validation` with per-field `issues`; `401 unauthorized`, `403 <reason>`, `404 <thing>_not_found`, `409 <conflict>`, `429 rate_limited`.
- Validation schemas live in `packages/shared` and are parsed in the route handler (`Schema.parse(request.body)`); never re-implement the rules in the client.

## Slots

- The server is the only authority on conflicts. Clients may pre-filter printers for a range, but every create/update runs the per-printer overlap query inside a `BEGIN IMMEDIATE` transaction and answers `409 conflict` with the blocking slot per printer.
- Times are rounded to the nearest 5 minutes on the server, so a client may send "now". Rules: start not before the current 5-minute mark (so "start now" is always accepted), end after start, at least 5 minutes, end within 30 days. A running slot's start is locked; its end may be extended up to the next slot on each of its printers.
- Deleting a slot goes through `SlotsService.delete(id, reason)` (`manual` | `expired` | `user_deleted`); later phases register cleanup hooks there with `onDelete()`.

## Expiry and Home Assistant

- `server/src/services/expiry.ts` is the only thing that deletes slots on the server's own initiative. `index.ts` starts it after `listen()` (catch-up pass, then a 30 s tick); the app's `onClose` hook awaits `stop()`, which finishes the slot in flight and leaves the rest for the next boot's catch-up. Tests never start it implicitly: `createTestApp()` leaves `ctx.expiry` idle and tests call `run()`/`start()` themselves, usually under `vi.useFakeTimers`.
- `server/src/services/ha.ts` is the Home Assistant client. The event type is a parameter of `fire()` so a start event (Phase 14) reuses the retry/backoff path. `fetch` and the backoff delays are injectable for tests; production uses the global fetch with a 10 s per-attempt timeout. `fire()` never throws: failures come back as a result and the final one is logged as `ha.delivery_failed` with the payload. The payload builder is the only server-side timezone math (Temporal via `temporal-polyfill`, same as the client); keep it that way.
- `POST /api/settings/ha/test` fires once (no retries) and always answers 200 with `{ ok, status, error }` when it could attempt delivery, 400 `ha_not_configured` otherwise, so the settings page can show HA's actual status.

## Images

- Uploads are one file per multipart request. `@fastify/multipart` enforces the 10 MB cap (`throwFileSizeLimit`), so the request stream errors at the cap and `ImagesService.store()` turns that into 413 `image_too_large`; nothing past the cap is buffered or kept (`.part` files are removed). The type comes from magic bytes only (`file-type`, peeking 4100 bytes through a Web-stream bridge); extension and Content-Type are ignored. 415 `image_type_not_allowed` carries the detected MIME, if any.
- Files are `<uuid>.<ext>` under `DATA_DIR/images/`; the `images` row holds the original name, MIME, and size. `GET /api/images/:storedName` needs a session and sets `nosniff`; browser-renderable types (PNG/JPEG/WEBP) are `inline`, everything else `attachment`.
- Cleanup is hook-based so no path can forget it: `slots.onDelete` removes a slot's files (manual, expiry, user cascade) and `users.onDelete` removes every file the user uploaded (their avatar included). `unlinkFile` tolerates a missing file. Rows go in the transaction; files go after it.
- `avatar_url` is derived from a LEFT JOIN on `images` in every user read (`USER_SELECT` in `services/users.ts`); add that join to any new query that builds a `UserRow`.
- Test fixtures live in `e2e/fixtures/` (a real 8×8 PNG, a RAF with its magic string, a script named `.png`); the server tests synthesize the other formats from their byte signatures.
- Client: `lib/upload.ts` is the one XHR in the codebase, because `fetch` cannot report upload progress. The editor reads the slot's images from the `["slot", id]` query, which the event stream keeps in step.

## Hardening and operations (Phase 10)

- `docs/SECURITY_REVIEW.md` is the §9 checklist with a pointer to the code and test for every item. Update it in the same change as any route, guard, or dependency change.
- Route coverage: `buildApp({ onRoute })` reports every registered route (test-only hook). `server/test/hardening.test.ts` asserts each `/api` route has `requireAuth`, `requireRole:*`, or `requireSlotAccess` in its preHandlers unless it is one of the four public routes, and then calls each without a cookie expecting 401. Guards returned by factories carry those names on purpose; keep that when adding one.
- `npm run lint` also runs `scripts/check-sql.mjs`: any `prepare()`/`exec()` whose statement text interpolates `${…}` must have a `// sql:` justification on the same or previous line, and the interpolated value must come from our own constants or whitelists, never from a request.
- `GET /api/backup` runs `VACUUM INTO` a temp file under `DATA_DIR` and streams it; the WAL is checkpointed on shutdown (`closeDatabase`) so a stopped app's `app.db` is complete on its own.
- `scripts/perf-seed.mjs` seeds 10 printers × 500 slots over 62 days into a throwaway data dir and prints range-query timings (`--keep` leaves the server up for a manual look). Numbers are recorded in `docs/PERFORMANCE.md`.

## Theme and layouts

- The signed-in user's color seeds the chrome (`client/src/theme/palette.ts`, pure and unit-tested): hex → OKLCH → `--accent`, `--accent-soft`, `--accent-strong`, `--on-accent` with the hue fixed. Lightness is clamped to a per-scheme band and nudged until near-black or near-white text reaches 4.5:1. The raw pick is never altered for identity (avatars, slot and calendar bars). `ThemeProvider` writes both schemes onto `:root` through the CSSOM (no inline styles, so the strict CSP holds); `index.css` picks per `prefers-color-scheme` and exposes them to Tailwind as `bg-accent`, `text-ink`, `border-line`, and so on. Never hard-code `neutral-*` / `dark:` classes in components.
- Glass surfaces use the `glass` / `glass-strong` classes. The `@supports not (backdrop-filter)` fallback is a solid surface; `prefers-reduced-motion` disables the `glass-in` entrance (it shortens other transitions to 0.01ms rather than removing them, so tests that read computed styles right after a change must wait for `document.getAnimations()` to finish).
- `useViewport()` (matchMedia, `≥ 1024px` desktop, `≥ 768px` tablet, else mobile) mounts exactly one chrome: desktop dock, tablet icon rail + printer drawer, or mobile header + bottom tab bar with the vertical timeline and the full-screen editor sheet. Keep it that way; hiding alternative chromes with CSS would duplicate controls and test ids in the DOM.
- The timeline mounts only the cards near the viewport (a day of slack each side, re-measured in 12-hour steps); tests that look for a card must first navigate or scroll to its day, which every existing test already does. Lanes are memoised and the pointer handlers read live values through a ref: keep new handlers stable (`useCallback` with the ref) or every lane re-renders on each pointer move. Numbers and the reasoning are in `docs/PERFORMANCE.md`.
- The timeline is one strip from shortly before now to the booking horizon (`stripOrigin` / `stripEnd` in `client/src/lib/time.ts`, both unit-tested across DST). Hour lines are a repeating gradient rather than DOM: the origin always sits on a wall-clock hour and hours are 60 real minutes even on DST days, so the pattern is exact. Ticks carry `data-date`; e2e helpers must pick a tick by date as well as label, and wait for smooth scrolls (Next day, Now) to settle before measuring positions. Drags are clamped on the client to the same window the server enforces (`validateTimes`), so a release never produces a `slot_in_past` or `slot_beyond_horizon` error.
- Touch targets: below the desktop breakpoint, `index.css` forces 44px minimums on buttons, links, and inputs. Controls whose size encodes time (timeline cards, resize handles) opt out with `data-geometry`; the Playwright audit in `e2e/responsive.spec.ts` honours the same attribute. Vertical timeline columns have a 120px minimum and scroll sideways.
- Biome parses Tailwind directives (`css.parser.tailwindDirectives`) because `index.css` uses `@theme inline`.

## Rules

- Zero native Node addons at runtime. The production dependency tree (`npm ls --omit=dev -w server`) must be pure JavaScript. Check any new dependency for a `binding.gyp` or install-time compile step before adding it.
- The dev/build toolchain (Vite's rolldown, Tailwind's oxide, lightningcss, esbuild) ships prebuilt per-platform binaries with no compile step, including `linux-arm64`. That is acceptable because it never reaches the runtime image. CI's arm64 image build is the check that keeps this true.
- Shared validation lives in `packages/shared`; the client and server never duplicate rules.
- All timestamps are UTC ISO-8601 strings in the database and API.
