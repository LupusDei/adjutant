# Feature Specification: Migrate ~/.adjutant/ JSON Files to SQLite

**Feature Branch**: `044-json-to-sqlite`
**Created**: 2026-03-17
**Status**: Draft

## User Scenarios & Testing

### User Story 1 - Projects in SQLite (Priority: P1)

Replace `~/.adjutant/projects.json` read-modify-write pattern with proper SQL queries in an `adjutant.db` SQLite database. The 12 registered projects with their metadata (id, name, path, gitRemote, mode, sessions[], createdAt, active, hasBeads) move from JSON to a `projects` table.

`hasBeads` should be computed on read (via `hasBeadsDb()`) rather than cached, eliminating stale state.

**Why this priority**: projects.json is the most widely consumed file (10+ importers). The read-modify-write pattern has no concurrent write safety and is the primary source of stale `hasBeads` data.

**Independent Test**: All 10+ consumers of `listProjects()`, `createProject()`, `activateProject()`, `deleteProject()` return identical shapes. Overview route and beads routes work as before.

**Acceptance Scenarios**:

1. **Given** the backend starts fresh with no adjutant.db, **When** it initializes, **Then** it creates the `projects` table via migration and imports any existing `projects.json` data.
2. **Given** a project is registered, **When** `listProjects()` is called, **Then** `hasBeads` is computed live (not read from a cached column).
3. **Given** two agents call `activateProject()` concurrently, **When** both writes complete, **Then** exactly one project is active (SQLite serialization).
4. **Given** existing REST endpoints, **When** called after migration, **Then** response shapes are identical to pre-migration.

---

### User Story 2 - Sessions in SQLite (Priority: P2)

Replace `~/.adjutant/sessions.json` with a `sessions` table in the same `adjutant.db`. The `SessionRegistry` class currently uses `loadFromDisk()`/`saveToDisk()` with the same JSON anti-pattern.

**Why this priority**: sessions.json has fewer consumers (SessionRegistry + 6 services) and is lower risk. It also benefits from SQL queries for status filtering.

**Independent Test**: `SessionRegistry.initialize()` reads from SQLite. `lifecycle-manager.ts` session creation/destruction persists correctly. Agent status endpoints return same data.

**Acceptance Scenarios**:

1. **Given** the backend starts with an existing `sessions.json`, **When** migration 021 runs, **Then** existing sessions are imported into the `sessions` table.
2. **Given** a session is created via `lifecycle-manager`, **When** stored, **Then** it persists in SQLite (not JSON file).
3. **Given** the backend restarts, **When** `SessionRegistry.initialize()` runs, **Then** it loads sessions from SQLite with correct types.

---

### Edge Cases

- What happens when `projects.json` exists but `adjutant.db` doesn't? → Migration creates DB and imports.
- What happens when `adjutant.db` already has the tables but `projects.json` still exists? → Skip import (idempotent migration).
- What happens when `hasBeadsDb()` is slow for a project with unreachable path? → Timeout/skip that project, don't block the list.
- What about `SwarmProvider.loadRegisteredProjects()` which reads `projects.json` directly? → Must be updated to use the service or a shared query function.

## Requirements

### Functional Requirements

- **FR-001**: System MUST store projects in a `projects` table in `~/.adjutant/adjutant.db`
- **FR-002**: System MUST store sessions in a `sessions` table in the same database
- **FR-003**: System MUST compute `hasBeads` on read, not cache it
- **FR-004**: System MUST maintain identical REST API response shapes
- **FR-005**: System MUST auto-import existing JSON data on first migration
- **FR-006**: System MUST use the existing migration system (numbered SQL files in `backend/src/services/migrations/`)
- **FR-007**: `SwarmProvider.loadRegisteredProjects()` MUST read from the database, not `projects.json`

### Key Entities

- **Project**: id, name, path, gitRemote, mode, sessions[], createdAt, active — `hasBeads` computed on read
- **ManagedSession**: id, name, tmuxSession, tmuxPane, projectPath, mode, status, workspaceType, pipeActive, createdAt, lastActivity

## Success Criteria

- **SC-001**: Zero `readFileSync`/`writeFileSync` calls for projects or sessions data
- **SC-002**: All existing unit tests pass (or are updated to match new internals)
- **SC-003**: `projects.json` and `sessions.json` are no longer written to by the backend
- **SC-004**: REST API responses are byte-for-byte compatible (same JSON shapes)
- **SC-005**: `hasBeads` reflects reality on every read without manual refresh
