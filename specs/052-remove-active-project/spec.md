# Feature Specification: Remove Active Project Concept

**Feature Branch**: `052-remove-active-project`
**Created**: 2026-04-16
**Status**: In Progress (Phase 1 backend complete)

## Background

Adjutant currently enforces a single "active project" via a boolean `active` column on the `projects` table. Only one project can be active at a time. Switching projects mutates backend state (`POST /api/projects/:id/activate`), which means:
- The frontend and iOS app fight over which project is "active" if both are open
- Agents' project context is coupled to this global state for some operations
- The overview page can only show one project's data
- The user must explicitly "activate" a project before beads/epics/proposals views show relevant data

The system has been evolving toward explicit project parameters (adj-141 UUID enforcement, adj-146 projectId on MCP tools), but the `active` boolean remains as a legacy anchor.

## User Scenarios & Testing

### User Story 1 - Client-Side Project Selection (Priority: P1)

As a user, I want project selection to be a client-side view filter — not a backend state mutation — so that switching projects in the web frontend doesn't affect what the iOS app shows, and vice versa.

**Why this priority**: This is the foundation. Every other change depends on project selection being client-local.

**Independent Test**: Open web frontend in two browser tabs. Select different projects in each. Both should show their selected project's data independently without interfering.

**Acceptance Scenarios**:

1. **Given** the web frontend is loaded, **When** I select "Project A" in the dropdown, **Then** BeadsView, EpicsView, and ProposalsView show Project A's data, AND no `POST /api/projects/:id/activate` call is made
2. **Given** I have the web frontend and iOS app open, **When** I select different projects in each, **Then** each shows its own selection independently
3. **Given** I select a project and close the browser, **When** I reopen, **Then** my selection is restored from localStorage
4. **Given** I select "ALL PROJECTS", **When** I view Beads, **Then** beads from all registered projects are displayed

---

### User Story 2 - Backend Active Column Removal (Priority: P1)

As a developer, I want the `projects.active` column and related backend APIs removed so there is no global "active project" state on the server, eliminating the single-project bottleneck.

**Why this priority**: This is the core refactoring — the `active` column is the root cause.

**Independent Test**: After migration, verify `projects` table has no `active` column. Verify `POST /api/projects/:id/activate` returns 404. Verify `GET /api/projects` still lists all projects.

**Acceptance Scenarios**:

1. **Given** the migration has run, **When** I query the `projects` table schema, **Then** the `active` column does not exist
2. **Given** the server starts, **When** `discoverLocalProjects()` runs, **Then** it registers projects without marking any as "active"
3. **Given** an agent calls MCP tools without explicit `projectId`, **When** the tool resolves project context, **Then** it uses the agent's session-bound project context (not a global active project)
4. **Given** a `GET /api/overview` request with `?projectId=<uuid>`, **When** the server processes it, **Then** it returns overview data for that specific project

---

### User Story 3 - Overview Supports Multi-Project (Priority: P1)

As a user, I want the overview dashboard to show data for my selected project (or aggregated data for all projects) without relying on a backend "active" flag.

**Why this priority**: The overview page is the primary landing page — it must work without `projects.active`.

**Independent Test**: Call `GET /api/overview?projectId=<uuid>` and verify it returns scoped data. Call `GET /api/overview` without a projectId and verify it returns aggregated or default data.

**Acceptance Scenarios**:

1. **Given** the overview endpoint, **When** called with `?projectId=<uuid>`, **Then** it returns beads/epics/agents data scoped to that project
2. **Given** the overview endpoint, **When** called without `projectId`, **Then** it returns aggregated data across all projects (or a sensible default)
3. **Given** two projects with beads, **When** I select each in the frontend, **Then** the overview dashboard updates to show the selected project's stats

---

### User Story 4 - iOS Client-Side Project Selection (Priority: P2)

As an iOS user, I want a global project selector in the app that persists my choice locally, so I don't trigger backend state changes when switching projects.

**Why this priority**: iOS currently has no global project state — each tab independently fetches the "active" project. This is both wasteful (3 redundant API calls) and fragile (depends on backend active flag).

**Independent Test**: Select a project in the iOS app. Navigate between Beads, Epics, and Proposals tabs. All should show the selected project's data without making `getProjects()` calls on each tab appear.

**Acceptance Scenarios**:

1. **Given** the iOS app loads, **When** AppState initializes, **Then** it restores the last selected project from UserDefaults
2. **Given** I select a project in the project picker, **When** I switch to the Beads tab, **Then** it shows that project's beads without calling `getProjects()` to find the "active" one
3. **Given** I have multiple projects registered, **When** I open Proposals tab, **Then** it uses the global selection from AppState, not a separate `getProjects()` call

---

### User Story 5 - Bead Lookup Without Active Fallback (Priority: P2)

As a developer, I want `getBead()` to resolve beads by prefix and explicit project context only — not fall back to an "active project" — so bead lookups are deterministic.

**Why this priority**: The active-project fallback in `getBead()` is a subtle bug source — it returns different results depending on which project is "active."

**Independent Test**: Call `getBead("adj-001")` without specifying a project. Verify it resolves via the `adj-` prefix to the correct database, without consulting any "active project" state.

**Acceptance Scenarios**:

1. **Given** a bead with prefix `adj-`, **When** `getBead("adj-001")` is called, **Then** it resolves to the database matching the `adj-` prefix
2. **Given** a bead with prefix `auto-tank-`, **When** `getBead("auto-tank-007")` is called, **Then** it resolves to the auto-tank project database
3. **Given** an ambiguous bead ID with no matching prefix, **When** `getBead("xyz-001")` is called, **Then** it tries all registered project databases (not just the "active" one)

---

### Edge Cases

- What happens during migration if no project was previously active? → All projects start as equals; frontend/iOS default to first project or "ALL"
- What if an agent connects without project context? → Existing `resolveProjectContext()` fallback to CWD project still works (doesn't depend on `active` column)
- What if the overview is called without `projectId` and there are 10 projects? → Aggregate view with timeout protection (parallel bd calls, not serial)

## Requirements

### Functional Requirements

- **FR-001**: System MUST NOT have any global "active project" state on the backend
- **FR-002**: System MUST support client-side project selection in both web frontend and iOS
- **FR-003**: System MUST persist project selection locally (localStorage / UserDefaults) per client
- **FR-004**: System MUST support an "ALL PROJECTS" view mode showing aggregated data
- **FR-005**: `GET /api/overview` MUST accept optional `projectId` query parameter for scoped data
- **FR-006**: `getBead()` MUST resolve beads by prefix matching, not active project fallback
- **FR-007**: `GET /api/projects` MUST NOT return an `active` field (or always return `false`)
- **FR-008**: MCP agent tools MUST continue to resolve project via session context (unchanged)

### Key Entities

- **Project**: Registered repository with id (UUID), name, path, git_remote. No longer has `active` field.
- **ProjectSelection**: Client-side state (web: localStorage, iOS: UserDefaults) tracking the user's current view filter.

## Success Criteria

- **SC-001**: Zero references to `getActiveProjectName()` or `activateProject()` in backend codebase
- **SC-002**: No `active` column in `projects` table after migration
- **SC-003**: No `POST /api/projects/:id/activate` endpoint
- **SC-004**: Frontend `ProjectContext` never calls backend to set active project
- **SC-005**: iOS ViewModels don't call `getProjects()` to find active project on appear
- **SC-006**: All existing tests pass after refactoring
- **SC-007**: New tests cover the refactored code paths (bead lookup, overview scoping, project selection)
