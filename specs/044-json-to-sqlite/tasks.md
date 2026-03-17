# Tasks: JSON-to-SQLite Migration

**Input**: Design documents from `/specs/044-json-to-sqlite/`
**Epic**: `adj-110`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-110.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1, US2, etc.)

## Phase 1: Schema & Migration

**Purpose**: Create SQLite tables and JSON import logic

- [ ] T001 [P] Create migration 021: projects table DDL in `backend/src/services/migrations/021-projects-table.sql`
- [ ] T002 [P] Create migration 022: sessions table DDL in `backend/src/services/migrations/022-sessions-table.sql`

**Note**: JSON import logic is JS, not SQL — implemented in T003 (database.ts).

- [ ] T003 Add `importJsonIfNeeded()` to `backend/src/services/database.ts` — after migrations, check if JSON files exist and tables are empty, import data

**Checkpoint**: Tables exist, JSON data imported on first run

---

## Phase 2: US1 — Projects in SQLite (Priority: P1, MVP)

**Goal**: All project CRUD operations use SQLite instead of JSON files
**Independent Test**: `listProjects()`, `createProject()`, `activateProject()`, `deleteProject()` return identical shapes

- [ ] T004 [US1] Rewrite `projects-service.ts` — replace `loadStore()`/`saveStore()` with SQL queries via `getDb()` in `backend/src/services/projects-service.ts`
- [ ] T005 [US1] Update `SwarmProvider.loadRegisteredProjects()` to query DB instead of reading `projects.json` in `backend/src/services/workspace/swarm-provider.ts`
- [ ] T006 [US1] Write/update unit tests for SQL-backed projects-service in `backend/tests/unit/projects-service.test.ts`

**Checkpoint**: Projects fully backed by SQLite, all tests pass

---

## Phase 3: US2 — Sessions in SQLite (Priority: P2)

**Goal**: SessionRegistry persists to SQLite instead of JSON files
**Independent Test**: `SessionRegistry.initialize()` hydrates from DB, session CRUD persists correctly

- [ ] T007 [US2] Rewrite `SessionRegistry` persistence — replace `loadFromDisk()`/`saveToDisk()` with SQL in `backend/src/services/session-registry.ts`
- [ ] T008 [US2] Write/update unit tests for SQL-backed SessionRegistry in `backend/tests/unit/session-registry.test.ts`

**Checkpoint**: Sessions fully backed by SQLite, all tests pass

---

## Phase 4: Polish & Verification

- [ ] T009 Remove dead JSON file code paths (loadStore, saveStore, loadFromDisk, saveToDisk) and unused imports
- [ ] T010 Run full test suite + build verification, fix any remaining issues

---

## Dependencies

- Phase 1 (T001, T002, T003): T001 and T002 are parallel; T003 depends on both
- Phase 2 (T004-T006) depends on Phase 1 (T003)
- Phase 3 (T007-T008) depends on Phase 1 (T003)
- Phase 2 and Phase 3 can run in parallel
- Phase 4 (T009-T010) depends on both Phase 2 and Phase 3

## Parallel Opportunities

- T001 and T002 within Phase 1 (different SQL files)
- Phase 2 and Phase 3 after Phase 1 completes (different services)
- T004 and T005 within Phase 2 (different files, but T005 may import from T004)
