# Tasks: Batch Dashboard Initialization

**Input**: Design documents from `/specs/020-batch-dashboard/`
**Epic**: `adj-dpcu`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-020.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1, US2, etc.)

## Phase 1: Backend Types & Service

**Purpose**: Define DashboardResponse types and create the service that fetches all data in parallel

- [ ] T001 [US1] Define DashboardSection<T> and DashboardResponse Zod schemas and TS types in `backend/src/types/dashboard.ts`
- [ ] T002 [US1] Create dashboard-service.ts with fetchDashboard() using Promise.allSettled to call existing services (status, beads×3, crew, unreadCounts, epics-with-progress, mail) in `backend/src/services/dashboard-service.ts`
- [ ] T003 [US1] Write unit tests for dashboard-service: all-success, partial-failure, and all-failure scenarios in `backend/tests/unit/dashboard-service.test.ts`

**Checkpoint**: Backend service tested — can fetch all dashboard data in one call

---

## Phase 2: Backend Route

**Purpose**: Expose the dashboard service via HTTP

- [ ] T004 [US1] Create dashboard router with GET / handler in `backend/src/routes/dashboard.ts`
- [ ] T005 [US1] Register dashboardRouter export in `backend/src/routes/index.ts` and mount at /api/dashboard in `backend/src/index.ts`

**Checkpoint**: `GET /api/dashboard` returns combined data

---

## Phase 3: Frontend Hook (MVP)

**Purpose**: Create the unified hook that replaces individual data-fetching hooks
**Goal**: Single hook for all dashboard data with polling
**Independent Test**: useDashboard() returns all sections, polls at interval, pauses when tab hidden

- [ ] T006 [P] [US2] Add DashboardResponse types to frontend in `frontend/src/types/dashboard.ts`
- [ ] T007 [P] [US2] Add api.dashboard.get() method to API service in `frontend/src/services/api.ts`
- [ ] T008 [US2] Create useDashboard() hook with initial fetch, configurable polling, stale-while-revalidate, and tab visibility awareness in `frontend/src/hooks/useDashboard.ts`

**Checkpoint**: Hook works independently — can be tested in isolation

---

## Phase 4: Component Integration

**Goal**: Wire OverviewDashboard to unified hook
**Independent Test**: All dashboard panels render from single data source, partial failures show per-section errors

- [ ] T009 [US2] Wire OverviewDashboard.tsx to useDashboard() replacing useDashboardBeads, useDashboardCrew, useDashboardEpics, useDashboardMail in `frontend/src/components/dashboard/OverviewDashboard.tsx`
- [ ] T010 [US2] Handle nullable DashboardSection data: per-section error rendering, preserve existing UI for available sections in `frontend/src/components/dashboard/OverviewDashboard.tsx`

**Checkpoint**: Dashboard renders from unified endpoint

---

## Phase 5: Polish & Cross-Cutting

- [ ] T011 [P] Clean up unused individual hook imports from OverviewDashboard (only remove dashboard-specific usage, keep hooks available for other pages)
- [ ] T012 Verify existing individual endpoints still work and non-dashboard pages using individual hooks are unaffected

---

## Dependencies

- Phase 1 (Types & Service) → blocks Phase 2 (Route)
- Phase 2 (Route) → blocks Phase 4 (Integration) — frontend needs working endpoint
- Phase 3 (Frontend Hook) can start in parallel with Phase 2 (types don't need route)
- Phase 3 → blocks Phase 4
- Phase 4 → blocks Phase 5

## Parallel Opportunities

- T006 and T007 can run in parallel (different files)
- T011 and T012 can run in parallel
- Phase 3 (frontend) can overlap with Phase 2 (backend route)
