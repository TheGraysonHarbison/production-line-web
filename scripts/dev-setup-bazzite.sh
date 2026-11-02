#!/usr/bin/env bash
# Production Line Web — developer setup on Bazzite, option A from dev doc §14 (host tools via
# Homebrew). Installs fnm, pins Node 26 for this checkout, installs dependencies and the
# Playwright browser. Safe to re-run.
set -euo pipefail
say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
cd "$(dirname "$0")/.."

if ! command -v brew >/dev/null; then
  for p in /home/linuxbrew/.linuxbrew/bin/brew /opt/homebrew/bin/brew; do
    [ -x "$p" ] && eval "$("$p" shellenv)" && break
  done
fi
command -v brew >/dev/null || { echo "Homebrew was not found. Bazzite ships it: run 'ujust brew' or see https://brew.sh" >&2; exit 1; }

if ! command -v fnm >/dev/null; then
  say "Installing fnm"
  brew install fnm
fi
eval "$(fnm env --shell bash)"
NODE_VERSION="$(cat .node-version)"
say "Installing Node $NODE_VERSION via fnm"
fnm install "$NODE_VERSION"
fnm use "$NODE_VERSION"
node -v

say "Installing dependencies"
npm ci
say "Installing the Playwright Chromium build"
npx playwright install chromium

cat <<MSG

Done. Add this to ~/.bashrc (or ~/.zshrc) so the right Node activates in this directory:
    eval "\$(fnm env --use-on-cd)"
Then: npm run dev   (client on :5173 proxying /api, server on :8080)
MSG
