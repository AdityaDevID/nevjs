#!/usr/bin/env bash
# Publish all packages in dependency order. Run from the repo root after `npm login`.
#   ./scripts/publish.sh --dry-run     # check everything without publishing
#   ./scripts/publish.sh               # publish for real (asks for your 2FA code per package)
set -euo pipefail
cd "$(dirname "$0")/.."
npm test
for p in nevb nevf nevg nevgthree nev; do
  echo "── publishing packages/$p"
  name=$(node -p "require('./packages/$p/package.json').name"); ver=$(node -p "require('./packages/$p/package.json').version")
  if npm view "$name@$ver" version >/dev/null 2>&1; then echo "skip $name@$ver (already published)"; continue; fi
  (cd "packages/$p" && npm publish --access public "$@")
done
echo "Done. Try:  npx @adityadevid/nevjs create demo"
