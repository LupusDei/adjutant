# Decompose beads-repository.ts - Beads

**Feature**: 021-beads-repository-decompose
**Generated**: 2026-02-25
**Source**: specs/021-beads-repository-decompose/tasks.md

## Root Epic

- **ID**: adj-022
- **Title**: Decompose beads-repository.ts god object
- **Type**: epic
- **Priority**: 1
- **Description**: Split the 1,738-line beads-repository.ts into 7 focused modules, eliminate ~500 lines of inline duplication, delete the original, and unify MCP autoCompleteEpics. Proposal d5654fb1.

## Epics

### Phase 1 — Foundational: Prefix Map & Transform
- **ID**: adj-022.1
- **Type**: epic
- **Priority**: 1
- **Tasks**: 2

### Phase 2 — Core: Database, Epics, Mutations
- **ID**: adj-022.2
- **Type**: epic
- **Priority**: 1
- **Blocks**: Phase 3
- **Tasks**: 3

### Phase 3 — Queries: Query & Project Modules
- **ID**: adj-022.3
- **Type**: epic
- **Priority**: 1
- **Tasks**: 2

### Phase 4 — Cleanup: Barrel, Tests, Delete, Unify
- **ID**: adj-022.4
- **Type**: epic
- **Priority**: 1
- **Depends**: Phase 1, Phase 2, Phase 3
- **Tasks**: 2

## Tasks

### Phase 1 — Foundational

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T001 | Extract beads-prefix-map module | `backend/src/services/beads/beads-prefix-map.ts` | adj-022.1.1 |
| T002 | Extract beads-transform module | `backend/src/services/beads/beads-transform.ts` | adj-022.1.2 |

### Phase 2 — Core

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T003 | Extract beads-database module (+ buildDatabaseList) | `backend/src/services/beads/beads-database.ts` | adj-022.2.1 |
| T004 | Extract beads-epics module | `backend/src/services/beads/beads-epics.ts` | adj-022.2.2 |
| T005 | Extract beads-mutations module | `backend/src/services/beads/beads-mutations.ts` | adj-022.2.3 |

### Phase 3 — Queries

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T006 | Extract beads-queries module | `backend/src/services/beads/beads-queries.ts` | adj-022.3.1 |
| T007 | Extract beads-project module | `backend/src/services/beads/beads-project.ts` | adj-022.3.2 |

### Phase 4 — Cleanup

| T-ID | Title | Path | Bead |
|------|-------|------|------|
| T008 | Update barrel index.ts and test imports | `backend/src/services/beads/index.ts` | adj-022.4.1 |
| T009 | Delete beads-repository.ts + unify MCP autoCompleteEpics | `backend/src/services/beads/beads-repository.ts`, `backend/src/services/mcp-tools/beads.ts` | adj-022.4.2 |

## Summary

| Phase | Tasks | Priority | Bead |
|-------|-------|----------|------|
| 1: Foundational | 2 | 1 | adj-022.1 |
| 2: Core | 3 | 1 | adj-022.2 |
| 3: Queries | 2 | 1 | adj-022.3 |
| 4: Cleanup | 2 | 1 | adj-022.4 |
| **Total** | **9** | | |

## Dependency Graph

```
Phase 1: Foundational (adj-022.1)
  T001 -> T002 (transform depends on prefix-map)
    |
Phase 2: Core (adj-022.2)
  T003 (database) -> T004 (epics) -> T005 (mutations)
    |
Phase 3: Queries (adj-022.3)
  T006 [P] T007 [P]  (parallel — different files)
    |
Phase 4: Cleanup (adj-022.4)
  T008 -> T009 (barrel update before delete)
```

## Improvements

Improvements (Level 4: adj-022.N.M.P) are NOT pre-planned here. They are created
during implementation when bugs, refactors, or extra tests are discovered.
