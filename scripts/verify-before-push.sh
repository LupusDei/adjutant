#!/usr/bin/env bash
set -euo pipefail

# Skip verification for WIP branches
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" == wip/* ]]; then
  echo "WIP branch detected — skipping verification"
  exit 0
fi

echo "=== Running lint ==="
npm run lint

echo "=== Running changed tests ==="
cd backend && npx vitest run --changed HEAD~1 2>/dev/null || npx vitest run
cd ../frontend && npx vitest run --changed HEAD~1 2>/dev/null || npx vitest run

echo "=== All checks passed ==="
