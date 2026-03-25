#!/usr/bin/env bash
set -euo pipefail

# Ensure we run from repo root regardless of where the script is invoked
cd "$(git rev-parse --show-toplevel)" || exit 1

# Skip verification for WIP branches
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" == wip/* ]]; then
  echo "WIP branch detected — skipping verification"
  exit 0
fi

echo "=== Step 1/3: Lint ==="
npm run lint || { echo "FAILED: Lint errors found"; exit 1; }

echo "=== Step 2/3: Build ==="
npm run build || { echo "FAILED: Build errors found"; exit 1; }

echo "=== Step 3/3: Test ==="
npm test || { echo "FAILED: Tests failed"; exit 1; }

echo "=== All checks passed ==="
