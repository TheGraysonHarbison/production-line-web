# Changelog

All notable changes to Production Line Web. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). Entries are distilled from the conventional commits on `main`.

## [Unreleased]

## [1.0.0] – 2026-11-02

The first stable release: everything from the release candidates below, plus:

### Added
- Documentation for hobbyist installs: screenshots, "how it works", upgrade notes, a reverse-proxy and HTTPS note, troubleshooting, a Home Assistant guide, and this changelog.
- The full Playwright suite runs in CI against the built container image and, on a release, against the pushed image.

## [1.0.0-rc.2] – 2026-11-02

### Fixed
- Images are published under the repository owner's namespace, `ghcr.io/thegraysonharbison/production-line-web`; the `goblinfoddergames` namespace named in the original spec does not exist, which is why `v1.0.0-rc.1` never published.

## [1.0.0-rc.1] – 2026-11-02

First release candidate (tagged, but its image push was refused; see rc.2). Everything below is new.

### Added
- **Accounts.** First-boot Owner setup, self-registration (admin can turn it off), roles (Owner / Admin / User), server-side sessions with a signed cookie, password change, profile colour, profile image, 12/24-hour preference.
- **Printers and settings.** Printer CRUD with an "invisible" (not bookable) flag; global settings for timezone, registration, images, and Home Assistant.
- **Slots.** Book one or more printers for a 5-minute-aligned range up to 30 days ahead; server-enforced conflict rule per printer; a running slot's start is locked and its end can be extended up to the next booking; every change is validated with shared Zod schemas.
- **Real time.** Server-Sent Events keep every open session in step; the UI shows a live/offline indicator.
- **Calendar and timeline.** Month calendar with per-user colour bars; a continuous timeline strip from now to the booking horizon with drag-to-create, drag-to-move, edge resizing, a Now button, and hatched past/horizon areas. Desktop dock with an Upcoming list and per-printer occupancy; tablet rail and drawer; phone tab bar with a vertical timeline and a full-screen editor.
- **Theme.** The signed-in user's colour seeds the chrome in light and dark schemes with contrast guaranteed; frosted-glass surfaces with a reduced-motion fallback.
- **Expiry and Home Assistant.** A scheduler removes finished slots (with catch-up after downtime) and fires `production_line_slot_expired` events at Home Assistant with retries; a Test button in Settings.
- **Images.** Optional uploads on slots and profiles (PNG, JPEG, TIFF, WEBP, common camera RAW), checked by magic bytes, capped at 10 MB, cleaned up with their slot or user.
- **Backup.** Admin download of a consistent database copy; restore by file replacement.
- **Hardening.** Helmet with a strict CSP, CSRF origin checks, rate limits, scrypt passwords, encrypted HA token, route-coverage test, SQL interpolation lint gate, a security review document.
- **Packaging.** Multi-arch container image (amd64, arm64) on GHCR, Docker Compose and Podman Quadlet installers, a standalone installer with a hardened systemd unit and a release tarball, uninstallers, an upgrade test in CI.

[Unreleased]: https://github.com/TheGraysonHarbison/production-line-web/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/TheGraysonHarbison/production-line-web/releases/tag/v1.0.0
[1.0.0-rc.2]: https://github.com/TheGraysonHarbison/production-line-web/releases/tag/v1.0.0-rc.2
[1.0.0-rc.1]: https://github.com/TheGraysonHarbison/production-line-web/releases/tag/v1.0.0-rc.1
