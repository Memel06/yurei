#!/usr/bin/env sh
# Installs Yurei from this checkout: builds if needed, then runs `yurei setup`.
# Released users run `npx yurei-chrome setup` instead. Arguments are passed to setup, e.g. --yes.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
CLI="$HERE/yurei-kit/dist/yurei.mjs"

command -v node >/dev/null 2>&1 || { echo "install: Node.js 18 or newer is required: https://nodejs.org" >&2; exit 1; }
[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 18 ] || { echo "install: Node.js 18 or newer is required, found $(node -v)" >&2; exit 1; }

if [ ! -f "$CLI" ] || [ ! -f "$HERE/yurei-extension/dist/manifest.json" ]; then
  echo "→ building in $HERE"
  (cd "$HERE" && npm install --no-audit --no-fund --silent && npm run build --silent >/dev/null)
fi

exec node "$CLI" setup "$@"
