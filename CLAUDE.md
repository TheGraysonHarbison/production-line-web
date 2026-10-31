# CLAUDE.md — Production Line Web

Self-hosted, LAN-only scheduling app for shared 3D printers. `docs/DEV_DOCUMENT.md` is the single source of truth for scope, rules, and architecture. `docs/ROADMAP.md` is the phased build order.

## Workflow rules (mandatory)

1. **One phase, one branch.** Every roadmap phase is built on its own feature branch (`phase-N-<slug>`, e.g. `phase-0-foundation`) cut from `main`. Never commit phase work directly to `main`.
2. **No merge without review.** A phase branch is merged into `main` only after (a) its roadmap exit gate is fully green and (b) the repository owner has reviewed and explicitly approved the merge. Do not merge, fast-forward, rebase onto, or push to `main` on your own initiative. When a phase is ready, stop and ask for review.
3. A phase is "complete" only when every item in its exit gate in `docs/ROADMAP.md` passes. Partial phases stay on their branch.

## Engineering rules

- Zero native Node addons (dev doc §4, D5). Check any new dependency for a build step before adding it.
- Shared validation lives in `packages/shared` as Zod schemas; neither client nor server duplicates rules.
- Every mutation: validate → transaction → commit → emit event → respond.
- UTC ISO-8601 strings everywhere in DB and API. Timezone math only via `Temporal`.
- Conventional commits. Lint, test, and build must pass before any commit is pushed.
