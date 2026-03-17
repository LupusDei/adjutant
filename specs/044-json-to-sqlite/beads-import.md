# JSON-to-SQLite Migration - Beads

**Feature**: 044-json-to-sqlite
**Generated**: 2026-03-17
**Source**: specs/044-json-to-sqlite/tasks.md

## Root Epic

- **ID**: adj-110
- **Title**: Migrate ~/.adjutant/ JSON to SQLite
- **Type**: epic
- **Priority**: 1
- **Description**: Replace projects.json and sessions.json with SQLite tables in adjutant.db. Eliminate read-modify-write anti-pattern, compute hasBeads on read.

## Epics

### Phase 1 — Schema & Migration
- **ID**: adj-110.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: 3

### Phase 2 — US1: Projects in SQLite
- **ID**: adj-110.2
- **Type**: epic
- **Priority**: 1
- **MVP**: true
- **Blocks**: Phase 4
- **Tasks**: 3

### Phase 3 — US2: Sessions in SQLite
- **ID**: adj-110.3
- **Type**: epic
- **Priority**: 2
- **Blocks**: Phase 4
- **Tasks**: 2

### Phase 4 — Polish: Cleanup & Verification
- **ID**: adj-110.4
- **Type**: epic
- **Priority**: 2
- **Depends**: Phase 2, Phase 3
- **Tasks**: 2

## Tasks

### Phase 1 — Schema & Migration

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Migration 021: projects table DDL | `backend/src/services/migrations/021-projects-table.sql` | adj-110.1.1 |
| T002 | Migration 022: sessions table DDL | `backend/src/services/migrations/022-sessions-table.sql` | adj-110.1.2 |
| T003 | JSON import logic in database.ts | `backend/src/services/database.ts` | adj-110.1.3 |

### Phase 2 — US1: Projects in SQLite

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T004 | Rewrite projects-service.ts to SQL | `backend/src/services/projects-service.ts` | adj-110.2.1 |
| T005 | Update SwarmProvider.loadRegisteredProjects() | `backend/src/services/workspace/swarm-provider.ts` | adj-110.2.2 |
| T006 | Unit tests for SQL-backed projects-service | `backend/tests/unit/projects-service.test.ts` | adj-110.2.3 |

### Phase 3 — US2: Sessions in SQLite

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T007 | Rewrite SessionRegistry persistence to SQL | `backend/src/services/session-registry.ts` | adj-110.3.1 |
| T008 | Unit tests for SQL-backed SessionRegistry | `backend/tests/unit/session-registry.test.ts` | adj-110.3.2 |

### Phase 4 — Polish

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T009 | Remove dead JSON file code paths | various | adj-110.4.1 |
| T010 | Full build + test verification | all | adj-110.4.2 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Schema & Migration | 3 | 1 | adj-110.1 |
| 2: US1 Projects (MVP) | 3 | 1 | adj-110.2 |
| 3: US2 Sessions | 2 | 2 | adj-110.3 |
| 4: Polish | 2 | 2 | adj-110.4 |
| **Total** | **10** | | |

## Dependency Graph

```
Phase 1: Schema & Migration (adj-110.1)
    |
    +---> Phase 2: Projects in SQLite (adj-110.2, MVP)  [parallel]
    |
    +---> Phase 3: Sessions in SQLite (adj-110.3)       [parallel]
    |                               |
    +-------+-----------------------+
            |
    Phase 4: Polish (adj-110.4)
```

## Improvements

Improvements (Level 4: adj-110.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered.
