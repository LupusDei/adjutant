# Project-Scoped Beads Strategy

## Problem

1. "Rig" terminology is a Gastown holdover that should have been removed in 027. It creates confusion — the concept is "project", not "rig".
2. Beads views (iOS and web) don't auto-scope to the active project. Users must manually select the project from a dropdown after already selecting it as active.
3. Switching the active project requires navigating into a project detail view — needs a quicker UX.

## Phase 1: Remove "Rig" Terminology

**Goal:** Replace all references to "rig" with "project" across backend, frontend, and iOS. This is a rename/refactor — no behavior changes.

### Backend Types (4 files)
- `backend/src/services/beads/types.ts` — Rename `rig` field to `project` in `BeadInfo`, `RecentlyClosedBead`, `ListBeadsOptions`. Rename `rigPath` to `projectPath`. Update `BeadsGraphOptions.rig` to `project`. Update `BeadSource` comments.
- `backend/src/services/workspace/workspace-provider.ts` — Rename `BeadsDirInfo.rig` to `project`. Rename `listRigNames()` to `listProjectNames()`. Rename `resolveRigPath()` to `resolveProjectPath()`.
- `backend/src/types/index.ts` — Rename `CrewMember.rig` to `project`.
- `backend/src/services/agent-data.ts` — Rename `AgentRuntimeInfo.rig` to `project`. Rename `sourceRig` variable.

### Backend Services (5 files)
- `backend/src/services/beads/beads-transform.ts` — Rename `extractRig()` to `extractProject()`.
- `backend/src/services/beads/beads-filter.ts` — Rename `filterByRig()` to `filterByProject()`.
- `backend/src/services/beads/beads-database.ts` — Rename `buildDatabaseList()` rig parameter and internal variables. Update error codes (`RIG_NOT_FOUND` → `PROJECT_NOT_FOUND`).
- `backend/src/services/beads/index.ts` — Update re-exports.
- `backend/src/services/workspace/swarm-provider.ts` — Rename `listRigNames()` to `listProjectNames()`, `resolveRigPath()` to `resolveProjectPath()`. Update `rig:` field assignments.
- `backend/src/services/workspace/index.ts` — Update exported function names.

### Backend Routes (1 file)
- `backend/src/routes/beads.ts` — Rename `rig` query parameter to `project`. Rename `rigParam`, `rigPath` variables. Update `resolveRigPath()` calls to `resolveProjectPath()`. Keep backward compatibility: if `rig` param is sent, treat it as `project`.

### Frontend (3 files)
- `frontend/src/types/index.ts` — Rename `BeadInfo.rig` and `CrewMember.rig` to `project`.
- `frontend/src/components/beads/BeadsView.tsx` — Rename `RigFilter` type, `rigFilter`/`rigOptions` state, localStorage key `beads-rig-filter` → `beads-project-filter`. Update API param from `rig` to `project`.
- `frontend/src/components/epics/EpicsView.tsx` — Same renames as BeadsView. localStorage key `epics-rig-filter` → `epics-project-filter`.

### iOS (1 file)
- `ios/AdjutantKit/Sources/AdjutantKit/Models/Bead.swift` — Rename `BeadInfo.rig` and `BeadDetail.rig` to `project`. Update CodingKey.

### Tests
- Update any test files referencing `rig` fields/functions to use new names.

**Total: ~15 files, pure rename refactor.**

## Phase 2: Project Scoping + Quick-Switch UX

**Goal:** Beads auto-scope to the active project. Add long-press quick-switch on iOS projects list.

### 2a: REST API — Accept `projectId` Parameter
- `backend/src/routes/beads.ts` — Add `projectId` query parameter. When provided, resolve via `getProject()` to get the path and use as beads directory. Takes precedence over `project` name param.

### 2b: iOS Auto-Scoping
- `ios/Adjutant/Features/Beads/ViewModels/BeadsListViewModel.swift` — On load, read active project from `AppState` and set `selectedSource` to match. Dropdown still exists for manual override but defaults to active project.
- Observe active project changes — when user switches project, beads view refreshes automatically.

### 2c: iOS Long-Press Quick-Switch
- `ios/Adjutant/Features/Projects/ProjectsListView.swift` (or equivalent) — Add `.contextMenu` or long-press gesture on each project row. Shows confirmation alert: "Switch active project to [name]?" with Confirm/Cancel. On confirm, calls `activateProject()` API and updates `AppState`.

### 2d: Frontend Auto-Scoping
- `frontend/src/components/beads/BeadsView.tsx` — Default `projectFilter` to the active project instead of `'ALL'`. Add `useActiveProject()` hook or read from context.
- `frontend/src/components/epics/EpicsView.tsx` — Same auto-scoping behavior.

### 2e: Agent Project Enforcement
- Ensure agents spawned within a project always have `projectId` in their MCP session. Log warnings when agents without project context access beads.

## Implementation Order

| Phase | Scope | Files | Priority |
|-------|-------|-------|----------|
| 1: Rig → Project rename | Pure refactor, no behavior change | ~15 files | P0 |
| 2a: REST API projectId | Backend route enhancement | 1 file | P1 |
| 2b: iOS auto-scope | ViewModel + AppState observation | 2 files | P1 |
| 2c: iOS long-press switch | ProjectsListView UX | 1-2 files | P1 |
| 2d: Frontend auto-scope | BeadsView + EpicsView defaults | 2-3 files | P2 |
| 2e: Agent enforcement | MCP tools logging | 1 file | P3 |
