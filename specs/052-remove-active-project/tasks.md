# Tasks: Remove Active Project Concept (v2 — revised)

**Input**: Design documents from `/specs/052-remove-active-project/`
**Epic**: `adj-162`
**Revised**: 2026-04-16 — 10 flaws fixed from v1

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-162.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1-US5)

## Phase 1: Backend — Refactor Callers & Remove Active Logic

**Purpose**: Update ALL callers of `getActiveProjectName()` and `activateProject()` FIRST, then remove the functions, then drop the DB column LAST. Order matters — you cannot drop a column that code still reads.

**CRITICAL: Execute tasks in listed order (T001→T008). Migration (T007) must be last.**

- [ ] T001 [US5] Refactor `getBead()` — replace active-project fallback with prefix-only resolution + stale map retry in `backend/src/services/beads/beads-queries.ts`
- [ ] T002 [US3] Refactor `listEpicsWithProgress()` — replace `getActiveProjectName()` default with explicit project param requirement in `backend/src/services/beads/beads-epics.ts`
- [ ] T003 [US3] Refactor `GET /api/overview` — require explicit `projectId` query param, skip beads/epics without it, remove `active` from project list response in `backend/src/routes/overview.ts`
- [ ] T004 [US2] Update `discoverLocalProjects()` — stop setting `active = 1` on root project in `backend/src/services/projects-service.ts`
- [ ] T005 [US2] Remove `activateProject()` and `getActiveProjectName()` functions from `backend/src/services/projects-service.ts`
- [ ] T006 [US2] Remove `POST /api/projects/:id/activate` endpoint, remove `active` from project types/responses in `backend/src/routes/projects.ts` and `backend/src/services/projects-service.ts`
- [ ] T007 [US2] Create SQLite migration to drop `active` column from projects table (LAST — all callers already updated) in `backend/src/services/migrations/`
- [ ] T008 [P] [US2] Write/update tests for all Phase 1 changes — migration, service removal, route removal, bead resolution, epic listing, overview in `backend/tests/unit/`

**Checkpoint**: Backend has no active project concept. `npm run build` exits 0. `npm test` passes.

---

## Phase 2: Frontend — Client-Side-Only Project Selection

**Goal**: Make project selection a pure client-side concern. No backend state mutation on project switch.
**Independent Test**: Open two browser tabs, select different projects in each — both work independently.

- [ ] T009 [US1] Refactor `ProjectContext.tsx` — remove `api.projects.activate()` call, fix auto-select to use first project with beads instead of `p.active` in `frontend/src/contexts/ProjectContext.tsx`
- [ ] T010 [US1] Update `ProjectSelector.tsx` — remove active indicator/badge logic in `frontend/src/components/shared/ProjectSelector.tsx`
- [ ] T011 [US3] Update `OverviewDashboard.tsx` — pass `projectId` from ProjectContext to overview API call instead of deriving from API response in `frontend/src/components/dashboard/OverviewDashboard.tsx`
- [ ] T012 [P] [US1] Update `BeadsView.tsx` — remove active-dependent auto-scoping in `frontend/src/components/beads/BeadsView.tsx`
- [ ] T013 [P] [US1] Update `EpicsView.tsx` — remove active dependency in `frontend/src/components/epics/EpicsView.tsx`
- [ ] T014 [P] [US1] Update `ProposalsView.tsx` — remove active dependency in `frontend/src/components/proposals/ProposalsView.tsx`
- [ ] T015 [US1] Remove `active: boolean` from `ProjectInfo` type and `api.projects.activate()` from API service in `frontend/src/types/index.ts` and `frontend/src/services/api.ts`
- [ ] T016 [P] [US1] Update frontend tests — delete activate tests, add first-launch default tests in `frontend/tests/unit/`

**Checkpoint**: Frontend project selection is fully client-side. No backend activate calls.

---

## Phase 3: iOS — AppState Project Selection (Two-Phase Transition)

**Goal**: Add global project selection to AppState. Eliminate per-tab `getProjects()` → `filter { $0.active }` pattern. Prevent Codable crash during backend transition.
**Independent Test**: Select project in iOS, navigate between tabs — all show consistent project data without redundant API calls.

**Phase 3A — Safe decoder + AppState (execute first):**

- [ ] T017 [US4] Add custom Codable decoder to Project model — make `active` optional with `decodeIfPresent` default false in `ios/AdjutantKit/Sources/AdjutantKit/Models/Project.swift`
- [ ] T018 [US4] Add `@Published var selectedProject: Project?` with `@AppStorage` persistence to `ios/Adjutant/Core/State/AppState.swift`
- [ ] T019 [US4] Add/update project picker UI that writes to AppState in `ios/Adjutant/Features/Projects/`

**Phase 3B — Refactor ViewModels + remove active UI (after 3A):**

- [ ] T020 [P] [US4] Refactor `ProposalsViewModel.swift` — replace `loadActiveProjectScope()` with AppState observation in `ios/Adjutant/Features/Proposals/ProposalsViewModel.swift`
- [ ] T021 [P] [US4] Refactor `BeadsListViewModel.swift` — replace `loadActiveProjectScope()` with AppState observation in `ios/Adjutant/Features/Beads/ViewModels/BeadsListViewModel.swift`
- [ ] T022 [P] [US4] Refactor `EpicsListViewModel.swift` — replace `loadActiveProjectScope()` with AppState observation in `ios/Adjutant/Features/Epics/ViewModels/EpicsListViewModel.swift`
- [ ] T023 [US4] Remove "SET AS ACTIVE PROJECT" button from `SwarmProjectDetailView.swift`, active badges from both project views, context menu activate option from `ProjectsListView.swift`
- [ ] T024 [US4] Remove `activateProject()` from `SwarmProjectDetailViewModel.swift`, `ProjectsListViewModel.swift`, and `APIClient+Endpoints.swift`
- [ ] T025 [US4] Remove `active: Bool` from Project model (safe now — decoder handles missing field) in `ios/AdjutantKit/Sources/AdjutantKit/Models/Project.swift`
- [ ] T026 [US4] Update `SpawnAgentSheet.swift` & `DeployPersonaSheet.swift` to default to AppState selection. Fix preview data that hardcodes `active: true`.

---

## Phase 4: Polish & Cross-Cutting

**Purpose**: Final audit, verification, and documentation updates.

- [ ] T027 [P] Grep audit for remaining `activeProject`, `getActiveProjectName`, `activateProject`, `.active` references across entire codebase
- [ ] T028 End-to-end verification: start server, test overview with projectId, beads, proposals, project switching on web. Test iOS JSON decoding with and without `active` field.
- [ ] T029 [P] Update `CLAUDE.md` project identity section and memory to reflect removal of active project pattern

---

## Dependencies

- Phase 1: INTERNAL sequential order (T001→T007, then T008 parallel with nothing)
- Phase 1 → Phase 2 + Phase 3 (frontend/iOS depend on backend API changes)
- Phase 3A (T017-T019) → Phase 3B (T020-T026) — safe decoder before model changes
- Phase 2 + Phase 3 can run in PARALLEL
- Phase 4 depends on all phases complete

## Parallel Opportunities

- Phase 2 (Frontend) and Phase 3 (iOS) are fully independent — different codebases
- Within Phase 2: T012, T013, T014 touch different component files (parallel)
- Within Phase 3B: T020, T021, T022 touch different ViewModel files (parallel)
- Phase 1 is mostly sequential due to caller→function→column ordering constraint
