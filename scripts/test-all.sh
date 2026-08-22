#!/usr/bin/env bash
# Everything, in §12's build order. Each stage gates the next.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "═══ types"
npx tsc --noEmit
echo "  ok    typecheck clean"

echo
echo "═══ unit (LMSR, odds, Elo, tab parser, trade queue)"
npx vitest run --reporter=dot

echo
echo "═══ shared code drift"
node scripts/check-shared.mjs

echo
echo "═══ database (migrations, LMSR parity, trading, RLS, anti-abuse, auto-settle, concurrency)"
./scripts/local-db.sh test

echo
echo "═══ ui (renders, no percentages for traders, quadrant geometry, 380px)"
npm run test:ui --silent

echo
echo "═══ build"
npx vite build >/dev/null
echo "  ok    production build"
