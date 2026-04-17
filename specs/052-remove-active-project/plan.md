# Implementation Plan: Remove Active Project Concept

**Branch**: `052-remove-active-project` | **Date**: 2026-04-16
**Epic**: `adj-162` | **Priority**: P1
**Revised**: 2026-04-16 (v2 — flaw analysis incorporated)

## Summary

Remove the exclusive `projects.active` boolean from the backend, replace `POST /api/projects/:id/activate` with client-side-only project selection, and update all consumers (overview, bead lookup, epic listing, frontend ProjectContext, iOS ViewModels) to work without global active project state. The system already has most APIs parameterized by project — this epic removes the last vestiges of the singleton active project pattern.

## Revision Notes (v2)

**10 flaws identified and corrected from v1:**

1. **Phase ordering was backwards** — v1 dropped the DB column (Phase 1) before updating callers (Phase 2). You can't drop a column that code still reads. Fixed: refactor callers first, drop column last.
2. **Missing file: `beads-epics.ts`** — `listEpicsWithProgress()` line 117 also calls `getActiveProjectName()`. Was completely absent from v1.
3. **"Scan all databases" would reintroduce 48-60s timeout** — v1 proposed replacing getBead() fallback with all-database scan. This was specifically removed in adj-117 because the bd semaphore (maxConcurrency=1) serializes all calls. Fixed: use prefix-only resolution with graceful failure.
4. **Overview aggregation breaks for 6+ projects** — bd semaphore serializes ALL bd calls. N projects × 5s = Ns serial. For 6+ projects, exceeds 30s HTTP timeout. Fixed: overview requires explicit `projectId` param; "ALL" mode uses client-side aggregation.
5. **iOS Codable crash** — Swift's synthesized `Codable` requires all fields in JSON. If backend stops sending `active`, iOS JSON parsing crashes silently. Fixed: two-phase approach — backend sends `active: false` in transition, iOS adds custom decoder first.
6. **Missing iOS UI changes** — "SET AS ACTIVE PROJECT" button, context menu items, active badges, two ViewModel methods, and an API client method were all missing from v1.
7. **Missing iOS preview data** — Preview code hardcodes `active: true` — would fail to compile.
8. **No first-launch default strategy** — What happens when localStorage/UserDefaults is empty AND there's no `active` flag? Fixed: explicit defaulting to first project with beads.
9. **Overview response sends `active` field** — line 112 of overview.ts sends `active: p.active` in projects list.
10. **Frontend auto-select depends on `active` flag** — ProjectContext line 71 uses `projects.find(p => p.active)` for first-time selection. After removal, this returns undefined.

## Bead Map

- `adj-162` - Root: Remove active project concept
  - `adj-162.1` - Backend: Refactor callers & remove active-dependent logic
    - `adj-162.1.1` - Refactor `getBead()` — replace active fallback with prefix-only resolution
    - `adj-162.1.2` - Refactor `listEpicsWithProgress()` — replace active fallback with explicit project param
    - `adj-162.1.3` - Refactor `GET /api/overview` — require explicit `projectId` param
    - `adj-162.1.4` - Update `discoverLocalProjects()` — stop marking projects active
    - `adj-162.1.5` - Remove `activateProject()` and `getActiveProjectName()` from projects-service
    - `adj-162.1.6` - Remove `POST /api/projects/:id/activate` endpoint and `active` from responses
    - `adj-162.1.7` - DB migration to drop `active` column (LAST — after all callers updated)
    - `adj-162.1.8` - Backend tests for all Phase 1 changes
  - `adj-162.2` - Frontend: Client-side-only project selection
    - `adj-162.2.1` - Refactor ProjectContext — remove activate API call, fix auto-select default
    - `adj-162.2.2` - Update ProjectSelector — remove active indicator
    - `adj-162.2.3` - Update OverviewDashboard — pass projectId from ProjectContext to API
    - `adj-162.2.4` - Update BeadsView, EpicsView, ProposalsView for new pattern
    - `adj-162.2.5` - Remove `active` from frontend ProjectInfo type and API service
    - `adj-162.2.6` - Frontend tests for ProjectContext and affected components
  - `adj-162.3` - iOS: Client-side project selection via AppState
    - `adj-162.3.1` - Add safe Codable decoding for `active` field (transition — make field optional)
    - `adj-162.3.2` - Add `selectedProject` to AppState with UserDefaults persistence
    - `adj-162.3.3` - Add project picker UI that writes to AppState
    - `adj-162.3.4` - Refactor ProposalsViewModel, BeadsListViewModel, EpicsListViewModel to use AppState
    - `adj-162.3.5` - Remove "SET AS ACTIVE PROJECT" button and active badges from UI
    - `adj-162.3.6` - Remove `activateProject()` from ViewModels and APIClient
    - `adj-162.3.7` - Remove `active` from Project model (after decoder is safe)
    - `adj-162.3.8` - Update preview data and fix compilation
  - `adj-162.4` - Polish: Cleanup & verification
    - `adj-162.4.1` - Grep audit for remaining active-project references
    - `adj-162.4.2` - End-to-end verification across web and iOS
    - `adj-162.4.3` - Update CLAUDE.md and memory with new patterns

## Technical Context

**Stack**: TypeScript 5.x (strict), React 18, Express, SQLite 3.51.2, Swift/SwiftUI, Zod
**Storage**: SQLite (projects table migration), localStorage, UserDefaults
**Testing**: Vitest (backend + frontend), XCTest (iOS)

**Critical Constraints**:
- **bd semaphore**: `maxConcurrency=1` — ALL bd CLI calls are serialized. Dolt panics (SIGSEGV) under concurrent access. This means multi-project aggregation is inherently serial: N projects × ~5s = Ns total.
- **Performance**: Overview was scoped to active project to avoid serial bd timeouts (adj-109). Replacement MUST accept explicit `projectId` — no "aggregate all" in backend.
- **iOS Codable**: Swift's synthesized decoder REQUIRES all fields in JSON. Must add custom decoder before backend stops sending `active`.
- **Migration**: SQLite 3.51.2 supports `ALTER TABLE DROP COLUMN` natively.
- **Backwards compat**: MCP tools already accept `projectId` — agents won't break.

## Architecture Decisions

### Client-side selection over server-side state

1. Multiple clients (web tabs, iOS app) should have independent project views
2. Server-side "active" was only used by ~4 code paths (overview, getBead, listEpics, discovery)
3. Most APIs already accept `projectId` parameters (adj-141, adj-146)
4. Agent MCP sessions carry `ProjectContext` per-connection — no global active needed

### Overview requires explicit `projectId` (no backend aggregation)

**Why NOT aggregate all projects server-side:**
- bd semaphore (maxConcurrency=1) serializes all calls: 3 projects × 8 bd calls × ~500ms = ~12s
- 6+ projects exceeds 30s HTTP timeout guaranteed
- adj-109 exists specifically because this was tried and failed

**Instead:**
- `GET /api/overview?projectId=<uuid>` — returns scoped data (fast, single project)
- `GET /api/overview` without projectId — returns projects list + agents + unread messages, but NO beads/epics (those require a project scope)
- Frontend passes `selectedProject.id` as `projectId` param
- "ALL PROJECTS" mode in frontend: calls overview per-project from client side, or shows project-agnostic data only

### getBead() uses prefix-only resolution (no fallback scan)

**Why NOT scan all databases:**
- adj-117 specifically removed all-database scanning because it caused 48-60s serial timeouts
- Each `bd show` goes through the semaphore — 15 projects = 15 × ~1s = ~15s for a single bead lookup
- Prefix resolution is reliable: each `.beads/config.yaml` has a unique prefix
- If prefix resolution fails, return `BEAD_NOT_FOUND` — don't silently scan

**Instead:**
- `resolveBeadDatabase(beadId)` uses prefix map (already works)
- If prefix not found in map, try refreshing the map once (handles new projects)
- If still not found, return error with helpful message ("bead prefix 'xyz' not mapped to any project")
- The `options.project` parameter already handles explicit project scoping

### iOS transition strategy (two-phase)

1. **Phase A**: Add custom Codable decoder that treats `active` as optional with default `false`
2. **Phase B**: After decoder is safe, remove `active` from model, UI, and ViewModels

This prevents JSON crash during the transition window where backend is deployed before iOS is updated.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/migrations/XXX-drop-active-column.sql` | New migration: drop `active` column |
| `backend/src/services/projects-service.ts` | Remove `activateProject()`, `getActiveProjectName()`, update `discoverLocalProjects()`, remove `active` from `rowToProject()`, `Project` type, `ProjectRow` type |
| `backend/src/routes/projects.ts` | Remove `POST /:id/activate`, remove `active` from responses |
| `backend/src/routes/overview.ts` | Require `projectId` query param, remove `p.active` from response, skip beads/epics when no projectId |
| `backend/src/services/beads/beads-queries.ts` | Remove `getActiveProjectName()` fallback, prefix-only resolution |
| `backend/src/services/beads/beads-epics.ts` | **[NEW]** Replace `getActiveProjectName()` default with explicit param requirement |
| `frontend/src/contexts/ProjectContext.tsx` | Remove `api.projects.activate()`, fix auto-select to use first project instead of `p.active` |
| `frontend/src/components/shared/ProjectSelector.tsx` | Remove `active` badge logic |
| `frontend/src/components/dashboard/OverviewDashboard.tsx` | Pass `projectId` from ProjectContext to API |
| `frontend/src/components/beads/BeadsView.tsx` | Minor: remove `active`-dependent logic |
| `frontend/src/components/epics/EpicsView.tsx` | Minor: remove `active`-dependent logic |
| `frontend/src/components/proposals/ProposalsView.tsx` | Minor: remove `active`-dependent logic |
| `frontend/src/types/index.ts` | Remove `active: boolean` from `ProjectInfo` |
| `frontend/src/services/api.ts` | Remove `api.projects.activate()` method |
| `ios/AdjutantKit/Sources/AdjutantKit/Models/Project.swift` | Custom Codable decoder, then remove `active` |
| `ios/Adjutant/Core/State/AppState.swift` | Add `@Published var selectedProject` with persistence |
| `ios/Adjutant/Features/Proposals/ProposalsViewModel.swift` | Use AppState |
| `ios/Adjutant/Features/Beads/ViewModels/BeadsListViewModel.swift` | Use AppState |
| `ios/Adjutant/Features/Epics/ViewModels/EpicsListViewModel.swift` | Use AppState |
| `ios/Adjutant/Features/Projects/SwarmProjectDetailView.swift` | **[NEW]** Remove "SET AS ACTIVE" button, active badge |
| `ios/Adjutant/Features/Projects/SwarmProjectDetailViewModel.swift` | **[NEW]** Remove `activateProject()` method |
| `ios/Adjutant/Features/Projects/ProjectsListView.swift` | **[NEW]** Remove context menu activate option, active badges |
| `ios/Adjutant/Features/Projects/ProjectsListViewModel.swift` | **[NEW]** Remove `activateProject()` method |
| `ios/AdjutantKit/Sources/AdjutantKit/Networking/APIClient+Endpoints.swift` | **[NEW]** Remove `activateProject()` API method |
| `ios/Adjutant/Features/Projects/SpawnAgentSheet.swift` | Default to AppState selection |

## Phase 1: Backend — Refactor Callers & Remove Active Logic (adj-162.1)

**CRITICAL ORDER**: Refactor callers FIRST, drop column LAST. You cannot drop a column that code still reads.

**Step order within this phase:**
1. Refactor `getBead()` — replace active fallback with prefix-only resolution + map refresh
2. Refactor `listEpicsWithProgress()` — require explicit project param (no default to active)
3. Refactor `GET /api/overview` — require `projectId` param, skip beads/epics without it
4. Update `discoverLocalProjects()` — stop setting `active = 1`
5. Remove `activateProject()` and `getActiveProjectName()` from projects-service
6. Remove `POST /api/projects/:id/activate` endpoint and `active` from all responses
7. **LAST**: DB migration to drop `active` column
8. Tests for all the above

**getBead() replacement strategy:**
```typescript
// BEFORE: Falls back to active project (48-60s scan risk)
const activeProjectDbs = await buildDatabaseList(getActiveProjectName());

// AFTER: Prefix-only resolution with one retry on stale map
if (!result.success && !options?.project) {
  // Refresh prefix map in case a new project was registered
  await refreshPrefixMap();
  const retryDb = await resolveBeadDatabase(beadId);
  if (!("error" in retryDb) && retryDb.workDir !== db.workDir) {
    result = await execBd(["show", beadId, "--json"], retryDb);
  }
}
```

**listEpicsWithProgress() replacement:**
```typescript
// BEFORE: Defaults to active project
const effectiveProject = options.project?.trim() || getActiveProjectName();

// AFTER: Require explicit project or return empty
const effectiveProject = options.project?.trim();
if (!effectiveProject) {
  return { success: true, data: [] }; // No project = no epics
}
```

**Overview route replacement:**
```typescript
// BEFORE: Finds active project internally
const activeProject = allProjects.find((p) => p.active && p.hasBeads);

// AFTER: Accept explicit projectId, skip beads without it
const projectId = req.query.projectId as string | undefined;
const targetProject = projectId
  ? allProjects.find(p => p.id === projectId)
  : null;

// Beads/epics only returned when a specific project is requested
if (targetProject?.hasBeads) {
  // ... query beads for targetProject
}
```

## Phase 2: Frontend — Client-Side Selection (adj-162.2)

**Changes from v1:**
- Fix auto-select logic: `projects.find(p => p.active)` → `projects[0]` (first project with beads)
- OverviewDashboard must pass `projectId` param to overview API
- Remove `api.projects.activate()` method entirely

**First-launch default strategy:**
```typescript
// BEFORE: Auto-select project marked active on backend
const active = projects.find((p) => p.active);

// AFTER: Auto-select first project with beads, or first project
const defaultProject = projects.find(p => p.hasBeads) ?? projects[0];
if (defaultProject) {
  setSelectedProjectId(defaultProject.id);
  localStorage.setItem(STORAGE_KEY, defaultProject.id);
}
```

## Phase 3: iOS — AppState Project Selection (adj-162.3)

**Two-phase iOS transition (prevents Codable crash):**

**Phase 3A — Safe decoder first:**
```swift
// Add CodingKeys and custom decoder BEFORE removing field
enum CodingKeys: String, CodingKey {
    case id, name, path, gitRemote, sessions, createdAt, active, hasBeads
}

public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    // ... decode other fields ...
    self.active = try container.decodeIfPresent(Bool.self, forKey: .active) ?? false
}
```

**Phase 3B — Remove UI and model:**
- Remove "SET AS ACTIVE PROJECT" button from SwarmProjectDetailView (lines 410-417)
- Remove context menu "Set as Active Project" from ProjectsListView (lines 225-231)
- Remove active badges from both views
- Remove `activateProject()` from both ViewModels
- Remove `activateProject()` from APIClient+Endpoints
- Remove `active: Bool` from Project model
- Update preview data that hardcodes `active: true`

**AppState first-launch default:**
```swift
// On projects load, if no selection persisted:
if selectedProjectId == nil, let first = projects.first {
    selectedProject = first
    selectedProjectId = first.id  // Persists to UserDefaults
}
```

## Phase 4: Polish & Verification (adj-162.4)

1. Grep audit: `rg "active.*project|activeProject|getActiveProject|activateProject|\.active" --type ts --type swift`
2. End-to-end: Start server, verify overview loads, verify beads/proposals filter correctly
3. Documentation: Update CLAUDE.md to remove references to "active project" pattern

## Parallel Execution

- **Phase 1**: Sequential internally (callers first, column drop last)
- **Phase 2 + Phase 3**: PARALLEL after Phase 1 (frontend and iOS are independent)
- **Phase 4**: Depends on all phases complete

```
Phase 1 (Backend — refactor callers → remove APIs → drop column)
    |
    ├── Phase 2 (Frontend)  ──→ Phase 4 (Polish)
    └── Phase 3 (iOS)       ──↗
```

## Verification Steps

- [ ] `projects` table has no `active` column after migration
- [ ] `POST /api/projects/:id/activate` returns 404
- [ ] `GET /api/overview?projectId=<uuid>` returns scoped beads/epics
- [ ] `GET /api/overview` (no param) returns projects + agents but NO beads/epics
- [ ] Frontend project switching doesn't trigger any backend API call
- [ ] Frontend auto-selects first project with beads on fresh install
- [ ] iOS JSON decoding works with AND without `active` field in response
- [ ] iOS project switching uses AppState, not per-tab `getProjects()` calls
- [ ] iOS "SET AS ACTIVE" buttons are removed
- [ ] `getBead()` resolves correctly via prefix — no active project fallback
- [ ] `listEpicsWithProgress()` requires explicit project param
- [ ] All existing tests pass
- [ ] No grep hits for `getActiveProjectName`, `activateProject` in TS/Swift
- [ ] `npm run build` exits 0, `npm test` passes
