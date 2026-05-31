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

echo "=== Step 1/4: Lint ==="
# nice the lint step too — eslint (with type-aware rules) is a heavy multi-core
# consumer, and concurrent agent lint runs are a top cause of CPU saturation.
nice -n 10 npm run lint || { echo "FAILED: Lint errors found"; exit 1; }

# Typecheck (tsc --noEmit) for BOTH packages. This is the step that was missing:
# vitest does NOT typecheck, and `vite build` strips types via esbuild, so a type
# error — e.g. a contravariant function-arg mismatch (TS2322, see adj-181.3.8) —
# would pass lint + tests here yet break `tsc` / `npm run build` at merge time.
# Whole-project, not --changed: a change in one file can break types in another.
echo "=== Step 2/4: Typecheck ==="
# Backend typecheck is BLOCKING — backend is clean, and this closes the exact hole
# that let adj-181.3.8 (TS2322 contravariance) pass verify yet break `npm run build`.
( cd backend && nice -n 10 npm run typecheck ) || { echo "FAILED: Backend typecheck (tsc --noEmit)"; exit 1; }
# Frontend typecheck is a RATCHET. The frontend was never typechecked before (vite
# build strips types via esbuild), so it carries a baseline of pre-existing errors
# recorded in frontend/.tsc-baseline (burn-down: adj-70idj). Block only on REGRESSION
# above the baseline — new type errors are caught without freezing the team on legacy
# debt. When the baseline reaches 0, delete this ratchet and make it a plain blocking
# check like the backend.
FE_BASELINE=$(cat frontend/.tsc-baseline 2>/dev/null || echo 0)
FE_OUT=$( ( cd frontend && nice -n 10 npm run typecheck 2>&1 ) || true )
FE_ERRORS=$( printf '%s\n' "$FE_OUT" | grep -cE "error TS" || true )
if [ "$FE_ERRORS" -gt "$FE_BASELINE" ]; then
  echo "FAILED: Frontend typecheck REGRESSED — $FE_ERRORS errors > baseline $FE_BASELINE."
  echo "  A change introduced new type error(s). Inspect: cd frontend && npm run typecheck"
  printf '%s\n' "$FE_OUT" | grep -E "error TS" | head -20
  exit 1
elif [ "$FE_ERRORS" -lt "$FE_BASELINE" ]; then
  echo "Frontend typecheck IMPROVED: $FE_ERRORS < baseline $FE_BASELINE — please lower frontend/.tsc-baseline to $FE_ERRORS and commit it."
else
  echo "Frontend typecheck at baseline ($FE_BASELINE pre-existing errors; burn-down adj-70idj)."
fi

# Run tests at lowered priority (nice) so concurrent agent test runs yield to
# interactive work and don't grind the machine to a halt. The worker pool is
# also capped in the vitest configs (VITEST_MAX_WORKERS) to bound total CPU.
echo "=== Step 3/4: Backend tests ==="
cd backend && (nice -n 10 npx vitest run --changed HEAD~1 || nice -n 10 npx vitest run) || { echo "FAILED: Backend tests"; exit 1; }

echo "=== Step 4/4: Frontend tests ==="
cd ../frontend && (nice -n 10 npx vitest run --changed HEAD~1 || nice -n 10 npx vitest run) || { echo "FAILED: Frontend tests"; exit 1; }

echo "=== All checks passed ==="
