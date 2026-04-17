# Remove Active Project Concept - Beads (v2 — revised)

**Feature**: 052-remove-active-project
**Generated**: 2026-04-16
**Revised**: 2026-04-16 — phase reordering, missing tasks added
**Source**: specs/052-remove-active-project/tasks.md

## Root Epic

- **ID**: adj-162
- **Title**: Remove active project concept — all projects always active
- **Type**: epic
- **Priority**: 1
- **Description**: Remove the exclusive `projects.active` boolean from the backend, replace with client-side-only project selection in frontend and iOS. Eliminate the single-project bottleneck so all projects are always available.

## Epics

### Phase 1 — Backend: Refactor Callers & Remove Active Logic
- **ID**: adj-162.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: 8
- **Note**: Internal ordering critical — refactor callers first, drop column last

### Phase 2 — Frontend: Client-Side-Only Project Selection
- **ID**: adj-162.2
- **Type**: epic
- **Priority**: 1
- **MVP**: true
- **Blocks**: Phase 4
- **Tasks**: 8

### Phase 3 — iOS: AppState Project Selection
- **ID**: adj-162.3
- **Type**: epic
- **Priority**: 2
- **Blocks**: Phase 4
- **Tasks**: 10

### Phase 4 — Polish: Cleanup & Verification
- **ID**: adj-162.4
- **Type**: epic
- **Priority**: 3
- **Depends**: Phase 2, Phase 3
- **Tasks**: 3

## Tasks

### Phase 1 — Backend: Refactor Callers & Remove Active Logic

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Refactor `getBead()` — prefix-only resolution | `backend/src/services/beads/beads-queries.ts` | adj-162.1.1 |
| T002 | Refactor `listEpicsWithProgress()` — explicit project param | `backend/src/services/beads/beads-epics.ts` | adj-162.1.2 |
| T003 | Refactor overview route — require `projectId` param | `backend/src/routes/overview.ts` | adj-162.1.3 |
| T004 | Update `discoverLocalProjects()` — no active marking | `backend/src/services/projects-service.ts` | adj-162.1.4 |
| T005 | Remove `activateProject()` and `getActiveProjectName()` | `backend/src/services/projects-service.ts` | adj-162.1.5 |
| T006 | Remove `POST /:id/activate` endpoint + `active` from responses | `backend/src/routes/projects.ts` | adj-162.1.6 |
| T007 | DB migration to drop `active` column (LAST) | `backend/src/services/migrations/` | adj-162.1.7 |
| T008 | Backend tests for all Phase 1 changes | `backend/tests/unit/` | adj-162.1.8 |

### Phase 2 — Frontend: Client-Side-Only Project Selection

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T009 | Refactor ProjectContext — remove activate call, fix auto-select | `frontend/src/contexts/ProjectContext.tsx` | adj-162.2.1 |
| T010 | Update ProjectSelector — remove active indicator | `frontend/src/components/shared/ProjectSelector.tsx` | adj-162.2.2 |
| T011 | Update OverviewDashboard — pass projectId to API | `frontend/src/components/dashboard/OverviewDashboard.tsx` | adj-162.2.3 |
| T012 | Update BeadsView — remove active-dependent logic | `frontend/src/components/beads/BeadsView.tsx` | adj-162.2.4 |
| T013 | Update EpicsView — remove active dependency | `frontend/src/components/epics/EpicsView.tsx` | adj-162.2.5 |
| T014 | Update ProposalsView — remove active dependency | `frontend/src/components/proposals/ProposalsView.tsx` | adj-162.2.6 |
| T015 | Remove `active` from types and API service | `frontend/src/types/index.ts`, `frontend/src/services/api.ts` | adj-162.2.7 |
| T016 | Frontend tests — delete activate tests, add defaults | `frontend/tests/unit/` | adj-162.2.8 |

### Phase 3 — iOS: AppState Project Selection

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T017 | Safe Codable decoder — make `active` optional | `ios/AdjutantKit/.../Models/Project.swift` | adj-162.3.1 |
| T018 | Add selectedProject to AppState with persistence | `ios/Adjutant/Core/State/AppState.swift` | adj-162.3.2 |
| T019 | Add/update project picker UI for AppState | `ios/Adjutant/Features/Projects/` | adj-162.3.3 |
| T020 | Refactor ProposalsViewModel — use AppState | `ios/.../ProposalsViewModel.swift` | adj-162.3.4 |
| T021 | Refactor BeadsListViewModel — use AppState | `ios/.../BeadsListViewModel.swift` | adj-162.3.5 |
| T022 | Refactor EpicsListViewModel — use AppState | `ios/.../EpicsListViewModel.swift` | adj-162.3.6 |
| T023 | Remove "SET AS ACTIVE" buttons and active badges | `SwarmProjectDetailView.swift`, `ProjectsListView.swift` | adj-162.3.7 |
| T024 | Remove `activateProject()` from ViewModels & APIClient | `*ViewModel.swift`, `APIClient+Endpoints.swift` | adj-162.3.8 |
| T025 | Remove `active: Bool` from Project model | `ios/AdjutantKit/.../Models/Project.swift` | adj-162.3.9 |
| T026 | Update SpawnAgent/DeployPersona defaults + fix previews | `SpawnAgentSheet.swift`, `DeployPersonaSheet.swift` | adj-162.3.10 |

### Phase 4 — Polish: Cleanup & Verification

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T027 | Grep audit for remaining active-project references | Entire codebase | adj-162.4.1 |
| T028 | End-to-end verification | All platforms | adj-162.4.2 |
| T029 | Update CLAUDE.md and memory | Project root | adj-162.4.3 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Backend Refactor & Remove | 8 | 1 | adj-162.1 |
| 2: Frontend (MVP) | 8 | 1 | adj-162.2 |
| 3: iOS | 10 | 2 | adj-162.3 |
| 4: Polish | 3 | 3 | adj-162.4 |
| **Total** | **29** | | |

## Dependency Graph

```
Phase 1: Backend (adj-162.1) — sequential: callers → functions → column
    |
    ├── Phase 2: Frontend (adj-162.2)  ──→ Phase 4: Polish (adj-162.4)
    └── Phase 3: iOS (adj-162.3)       ──↗
         └── 3A (T017-T019) → 3B (T020-T026)
```

## Improvements

Improvements (Level 4: adj-162.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered.
