# Implementation Plan: JSON-to-SQLite Migration

**Branch**: `044-json-to-sqlite` | **Date**: 2026-03-17
**Epic**: `adj-110` | **Priority**: P1

## Summary

Migrate `~/.adjutant/projects.json` and `sessions.json` to SQLite tables in `adjutant.db`, replacing the JSON read-modify-write anti-pattern with proper SQL queries. Uses the existing migration system (SQL files numbered 021+). `hasBeads` becomes computed-on-read. All REST API contracts preserved.

## Bead Map

- `adj-110` - Root: JSON-to-SQLite Migration
  - `adj-110.1` - Schema & Migration: DDL + data import
    - `adj-110.1.1` - Migration 021: projects table DDL + JSON import
    - `adj-110.1.2` - Migration 022: sessions table DDL + JSON import
  - `adj-110.2` - US1: Projects in SQLite
    - `adj-110.2.1` - Rewrite projects-service.ts to use SQL
    - `adj-110.2.2` - Update SwarmProvider.loadRegisteredProjects() to use DB
    - `adj-110.2.3` - Update/write unit tests for projects-service
  - `adj-110.3` - US2: Sessions in SQLite
    - `adj-110.3.1` - Rewrite SessionRegistry persistence to use SQL
    - `adj-110.3.2` - Update/write unit tests for SessionRegistry
  - `adj-110.4` - Polish: Cleanup & verification
    - `adj-110.4.1` - Remove JSON file reads/writes, update imports
    - `adj-110.4.2` - Integration verification (all routes return same shapes)

## Technical Context

**Stack**: TypeScript, better-sqlite3, Express
**Storage**: `~/.adjutant/adjutant.db` (existing message store DB)
**Testing**: Vitest
**Constraints**: Must be backward-compatible (API shapes unchanged). Must handle first-run import from JSON.

## Architecture Decision

Use the **existing** `adjutant.db` (already used for messages/FTS5) rather than a new database file. This:
- Avoids managing multiple SQLite connections
- Leverages the existing migration runner in `database.ts`
- Keeps all backend state in one place

The `adjutant.db` path is `~/.adjutant/adjutant.db` — same directory as the JSON files being replaced.

**Database access**: Use the existing `getDb()` function from `database.ts`. Projects-service and SessionRegistry will import it directly, replacing their file I/O.

**hasBeads computation**: Instead of storing `hasBeads` in the table, compute it via `hasBeadsDb(path)` on every `listProjects()` call. This eliminates stale state. For performance, we can cache with a short TTL if needed (but 12 projects × existsSync is <1ms total, so unlikely).

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/migrations/021-projects-table.sql` | New: CREATE TABLE + import trigger |
| `backend/src/services/migrations/022-sessions-table.sql` | New: CREATE TABLE + import trigger |
| `backend/src/services/projects-service.ts` | Rewrite: JSON → SQL queries |
| `backend/src/services/workspace/swarm-provider.ts` | Update: loadRegisteredProjects() → DB query |
| `backend/src/services/session-registry.ts` | Rewrite: JSON persistence → SQL |
| `backend/tests/unit/projects-service.test.ts` | New/update: test SQL-backed service |
| `backend/tests/unit/session-registry.test.ts` | New/update: test SQL-backed registry |
| `backend/tests/unit/overview-routes.test.ts` | Update: mock changes if needed |
| `backend/tests/unit/swarm-provider.test.ts` | Update: mock changes for DB query |

## Phase 1: Schema & Migration

Create SQL migration files. The migration runner auto-applies them on startup.

**Migration 021 (projects)**:
- CREATE TABLE projects (id TEXT PK, name TEXT, path TEXT UNIQUE, gitRemote TEXT, mode TEXT, createdAt TEXT, active INTEGER)
- Note: `sessions` (JSON array of session names) stored as JSON column or normalized — prefer JSON column for simplicity since it's just names
- Import function: on first run, read `projects.json` if exists, INSERT each project

**Migration 022 (sessions)**:
- CREATE TABLE sessions (id TEXT PK, name TEXT UNIQUE, tmuxSession TEXT, tmuxPane TEXT, projectPath TEXT, mode TEXT, status TEXT, workspaceType TEXT, pipeActive INTEGER, createdAt TEXT, lastActivity TEXT)
- Import function: on first run, read `sessions.json` if exists, INSERT each session

**JSON import strategy**: SQL migrations can't run JS. So the import logic goes in `database.ts` — after `runMigrations()`, call `importJsonIfNeeded()` which checks for JSON files and inserts data if the tables are empty.

## Phase 2: US1 — Projects in SQLite

Rewrite `projects-service.ts`:
- Remove `loadStore()`/`saveStore()` (JSON I/O)
- Replace with direct SQL via `getDb()`
- `listProjects()` → `SELECT * FROM projects` + compute `hasBeads` on each row
- `createProject()` → `INSERT INTO projects`
- `activateProject()` → `UPDATE projects SET active = 0; UPDATE projects SET active = 1 WHERE id = ?`
- `deleteProject()` → `DELETE FROM projects WHERE id = ?`

Update `SwarmProvider.loadRegisteredProjects()` to query the DB instead of reading `projects.json` directly.

## Phase 3: US2 — Sessions in SQLite

Rewrite `SessionRegistry` persistence:
- Remove `loadFromDisk()`/`saveToDisk()` (JSON I/O)
- `initialize()` → `SELECT * FROM sessions` to hydrate in-memory map
- Session create/update/delete → SQL mutations + in-memory cache update
- Keep in-memory `Map<string, ManagedSession>` for runtime (outputBuffer, connectedClients are runtime-only, not persisted)

## Phase 4: Polish

- Remove dead JSON file code paths
- Verify all routes return identical response shapes
- Run full test suite

## Parallel Execution

- Phase 1 tasks (migration 021, 022) can run in parallel
- Phase 2 and Phase 3 can run in parallel (different services, different files)
- Phase 4 depends on both Phase 2 and Phase 3

## Verification Steps

- [ ] `npm run build` passes
- [ ] `npm test` passes (all existing + new tests)
- [ ] `curl /api/overview` returns same shape
- [ ] `curl /api/projects` returns same shape
- [ ] `curl /api/sessions` returns same shape
- [ ] Fresh start with only `projects.json` → data imported to SQLite
- [ ] Fresh start with existing `adjutant.db` → no duplicate imports
