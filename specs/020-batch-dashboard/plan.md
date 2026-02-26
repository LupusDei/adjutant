# Implementation Plan: Batch Dashboard Initialization

**Branch**: `020-batch-dashboard` | **Date**: 2026-02-25
**Epic**: `adj-dpcu` | **Priority**: P1

## Summary

Consolidate 6+ dashboard initialization requests into a single `GET /api/dashboard` endpoint. The backend service calls existing service functions in parallel via `Promise.allSettled`, wrapping each section in a nullable `DashboardSection<T>` envelope for graceful partial failures. The frontend gets a unified `useDashboard()` hook with built-in polling that replaces the 4 dashboard hooks (beads, crew, epics, mail).

## Bead Map

- `adj-dpcu` - Root: Batch Dashboard Initialization
  - `adj-fmbt` - Phase 1: Backend Types & Service
    - `adj-s1un` - T001: Define DashboardResponse Zod schemas and TS types
    - `adj-a78c` - T002: Create dashboard-service with Promise.allSettled
    - `adj-uiu0` - T003: Write dashboard-service unit tests
  - `adj-ivtw` - Phase 2: Backend Route (blocked by Phase 1)
    - `adj-mdtz` - T004: Create dashboard router GET / handler
    - `adj-aoeg` - T005: Register dashboardRouter in routes/index and app
  - `adj-9103` - Phase 3: Frontend Unified Hook (parallel with Phase 2)
    - `adj-dk77` - T006: Add DashboardResponse types to frontend
    - `adj-3vnr` - T007: Add api.dashboard.get() method
    - `adj-8i94` - T008: Create useDashboard() hook with polling
  - `adj-z3nm` - Phase 4: Component Integration (blocked by Phase 2 + 3)
    - `adj-3n8d` - T009: Wire OverviewDashboard to useDashboard()
    - `adj-3ats` - T010: Handle nullable sections with per-section errors
  - `adj-5f0e` - Phase 5: Polish (blocked by Phase 4)
    - `adj-e70l` - T011: Clean up unused individual hook imports
    - `adj-l6hz` - T012: Verify individual endpoints unaffected

## Technical Context

**Stack**: TypeScript 5.x (strict), Express 4, React 18+, Zod, Tailwind CSS
**Storage**: SQLite (message store for unread counts), bd CLI (beads)
**Testing**: Vitest
**Constraints**: Must not break existing individual endpoints; must handle partial failures gracefully

## Architecture Decision

**Promise.allSettled over Promise.all**: Using `Promise.allSettled` ensures that one failing service doesn't cause the entire endpoint to error. Each section is independently wrapped — the frontend can render what's available and show errors for failed sections.

**DashboardSection<T> envelope**: Each field in the response is `{ data: T | null; error?: string }` rather than directly `T | null`. This preserves error context for the frontend to display per-section error messages rather than generic "something failed."

**Stale-while-revalidate polling**: The hook shows previous data during refetch, only shows a loading spinner on the very first mount. This avoids UI flicker during polling.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/types/dashboard.ts` | New: DashboardResponse Zod schema + TS types |
| `backend/src/services/dashboard-service.ts` | New: fetchDashboard() using Promise.allSettled |
| `backend/src/routes/dashboard.ts` | New: GET / route handler |
| `backend/src/routes/index.ts` | Add dashboardRouter export |
| `backend/src/index.ts` | Register /api/dashboard route |
| `backend/tests/unit/dashboard-service.test.ts` | New: unit tests for dashboard service |
| `frontend/src/types/dashboard.ts` | New: frontend DashboardResponse types |
| `frontend/src/services/api.ts` | Add api.dashboard.get() method |
| `frontend/src/hooks/useDashboard.ts` | New: unified hook with polling |
| `frontend/src/components/dashboard/OverviewDashboard.tsx` | Wire to useDashboard(), handle nullable sections |

## Phase 1: Backend Types & Service

Define the shared types and the core service that orchestrates parallel data fetching.

- Zod schema for `DashboardSection<T>` and `DashboardResponse`
- `fetchDashboard()` function calling existing services via `Promise.allSettled`
- Each section: status, beads (3 categories), crew, unreadCounts, epics (with progress), mail
- Unit tests covering all-success, partial-failure, and all-failure scenarios

## Phase 2: Backend Route

Create the Express route handler and register it in the app.

- Simple GET handler that calls `fetchDashboard()` and returns the result
- Register in routes/index.ts and app entrypoint
- Route-level tests

## Phase 3: Frontend Hook (MVP)

Build the frontend types, API method, and unified hook.

- Frontend DashboardResponse types mirroring backend
- `api.dashboard.get()` fetch method
- `useDashboard({ pollInterval })` hook with:
  - Initial fetch on mount
  - Configurable polling interval (default 30s)
  - Stale-while-revalidate (no loading spinner on refetch)
  - Tab visibility awareness (pause when hidden)

## Phase 4: Component Integration

Wire the dashboard view to the unified hook and handle partial failures.

- Replace 4 individual hooks in OverviewDashboard with single `useDashboard()`
- Per-section error rendering for nullable data
- Preserve all existing UI behavior and interactions

## Phase 5: Polish

Clean up and verify.

- Remove unused individual hook imports from dashboard
- Verify no regressions in non-dashboard pages that use individual hooks

## Parallel Execution

- Phase 1 tasks (types + service + tests) are sequential (types first, then service, then tests)
- Phase 2 depends on Phase 1
- Phase 3 (frontend) can run in **parallel with Phase 2** (frontend types don't depend on backend route)
- Phase 4 depends on Phase 3
- Phase 5 depends on Phase 4

## Verification Steps

- [ ] `GET /api/dashboard` returns all sections with data populated
- [ ] Simulated beads failure: beads section null, others populated
- [ ] Network tab shows 1 request on dashboard mount (down from 6+)
- [ ] Polling fires at configured interval
- [ ] Tab hidden → polling pauses; tab visible → polling resumes
- [ ] All existing individual endpoints still work
- [ ] `npm run build` passes
- [ ] `npm test` passes
