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

## Database and migrations

- SQLite via `node:sqlite`, one file at `$DATA_DIR/app.db`, WAL mode. Every connection sets `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- Migrations are numbered SQL files in `server/migrations/` (`0002_short_name.sql`). They run automatically on server start and via `npm run db:migrate` (built) or `npm run db:migrate -w server` (from source). Each file runs in its own transaction and is recorded in `schema_migrations`. Forward-only: never edit a shipped migration; add a new one.
- `secret.key` in `$DATA_DIR` is the AES-256-GCM key for secrets at rest (the Home Assistant token). Losing it only means re-entering that token.

## Rules

- Zero native Node addons at runtime. The production dependency tree (`npm ls --omit=dev -w server`) must be pure JavaScript. Check any new dependency for a `binding.gyp` or install-time compile step before adding it.
- The dev/build toolchain (Vite's rolldown, Tailwind's oxide, lightningcss, esbuild) ships prebuilt per-platform binaries with no compile step, including `linux-arm64`. That is acceptable because it never reaches the runtime image. CI's arm64 image build is the check that keeps this true.
- Shared validation lives in `packages/shared`; the client and server never duplicate rules.
- All timestamps are UTC ISO-8601 strings in the database and API.
