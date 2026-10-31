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

## License

MIT
