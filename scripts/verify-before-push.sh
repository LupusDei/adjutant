#!/usr/bin/env bash
set -euo pipefail

# Ensure we run from monorepo root regardless of where the script is invoked
cd "$(git rev-parse --show-toplevel)" || exit 1

# Skip verification for WIP branches
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" == wip/* ]]; then
  echo "WIP branch detected — skipping verification"
  exit 0
fi

echo "=== Step 1/3: Lint ==="
# nice the lint step too — eslint (with type-aware rules) is a heavy multi-core
# consumer, and concurrent agent lint runs are a top cause of CPU saturation.
nice -n 10 npm run lint || { echo "FAILED: Lint errors found"; exit 1; }

# Run tests at lowered priority (nice) so concurrent agent test runs yield to
# interactive work and don't grind the machine to a halt. The worker pool is
# also capped in the vitest configs (VITEST_MAX_WORKERS) to bound total CPU.
echo "=== Step 2/3: Backend tests ==="
cd backend && (nice -n 10 npx vitest run --changed HEAD~1 || nice -n 10 npx vitest run) || { echo "FAILED: Backend tests"; exit 1; }

echo "=== Step 3/3: Frontend tests ==="
cd ../frontend && (nice -n 10 npx vitest run --changed HEAD~1 || nice -n 10 npx vitest run) || { echo "FAILED: Frontend tests"; exit 1; }

echo "=== All checks passed ==="
