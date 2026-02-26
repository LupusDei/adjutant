# Batch Dashboard Initialization - Beads

**Feature**: 020-batch-dashboard
**Generated**: 2026-02-25
**Source**: specs/020-batch-dashboard/tasks.md

## Root Epic

- **ID**: adj-dpcu
- **Title**: Batch Dashboard Initialization
- **Type**: epic
- **Priority**: 1
- **Description**: Consolidate 6+ dashboard init requests into single GET /api/dashboard endpoint with nullable sections for partial failure handling. Frontend useDashboard() hook with polling replaces individual hooks.

## Epics

### Phase 1 — Backend: Types & Service
- **ID**: adj-fmbt
- **Type**: epic
- **Priority**: 1
- **Tasks**: 3

### Phase 2 — Backend: Route
- **ID**: adj-ivtw
- **Type**: epic
- **Priority**: 1
- **Blocked by**: adj-fmbt (Phase 1)
- **Tasks**: 2

### Phase 3 — Frontend: Unified Hook
- **ID**: adj-9103
- **Type**: epic
- **Priority**: 1
- **MVP**: true
- **Tasks**: 3

### Phase 4 — Component Integration
- **ID**: adj-z3nm
- **Type**: epic
- **Priority**: 1
- **Blocked by**: adj-ivtw (Phase 2), adj-9103 (Phase 3)
- **Tasks**: 2

### Phase 5 — Polish
- **ID**: adj-5f0e
- **Type**: epic
- **Priority**: 2
- **Blocked by**: adj-z3nm (Phase 4)
- **Tasks**: 2

## Tasks

### Phase 1 — Backend: Types & Service (adj-fmbt)

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Define DashboardResponse Zod schemas and TS types | backend/src/types/dashboard.ts | adj-s1un |
| T002 | Create dashboard-service with Promise.allSettled parallel fetch | backend/src/services/dashboard-service.ts | adj-a78c |
| T003 | Write dashboard-service unit tests (success, partial, all-fail) | backend/tests/unit/dashboard-service.test.ts | adj-uiu0 |

### Phase 2 — Backend: Route (adj-ivtw)

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T004 | Create dashboard router GET / handler | backend/src/routes/dashboard.ts | adj-mdtz |
| T005 | Register dashboardRouter in routes/index.ts and app entrypoint | backend/src/routes/index.ts, backend/src/index.ts | adj-aoeg |

### Phase 3 — Frontend: Unified Hook (adj-9103)

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T006 | Add DashboardResponse types to frontend | frontend/src/types/dashboard.ts | adj-dk77 |
| T007 | Add api.dashboard.get() method | frontend/src/services/api.ts | adj-3vnr |
| T008 | Create useDashboard() hook with polling | frontend/src/hooks/useDashboard.ts | adj-8i94 |

### Phase 4 — Component Integration (adj-z3nm)

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T009 | Wire OverviewDashboard to useDashboard() | frontend/src/components/dashboard/OverviewDashboard.tsx | adj-3n8d |
| T010 | Handle nullable sections with per-section error rendering | frontend/src/components/dashboard/OverviewDashboard.tsx | adj-3ats |

### Phase 5 — Polish (adj-5f0e)

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T011 | Clean up unused individual hook imports from dashboard | frontend/src/components/dashboard/OverviewDashboard.tsx | adj-e70l |
| T012 | Verify individual endpoints and non-dashboard pages unaffected | — | adj-l6hz |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Backend Types & Service | 3 | 1 | adj-fmbt |
| 2: Backend Route | 2 | 1 | adj-ivtw |
| 3: Frontend Hook (MVP) | 3 | 1 | adj-9103 |
| 4: Component Integration | 2 | 1 | adj-z3nm |
| 5: Polish | 2 | 2 | adj-5f0e |
| **Total** | **12** | | |

## Dependency Graph

```
Phase 1: Backend Types & Service (adj-fmbt)
    |
Phase 2: Backend Route (adj-ivtw)        Phase 3: Frontend Hook (adj-9103)  [parallel]
    |                                          |
    +------------------+-----------------------+
                       |
            Phase 4: Component Integration (adj-z3nm)
                       |
            Phase 5: Polish (adj-5f0e)
```

## Improvements

Improvements (Level 4: adj-xxx.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered.
