# Decompose beads-service.ts - Beads

**Feature**: 019-beads-service-decompose
**Generated**: 2026-02-25
**Source**: specs/019-beads-service-decompose/tasks.md

## Root Epic

- **Title**: Decompose beads-service.ts into Focused Modules
- **Type**: epic
- **Priority**: 1
- **Description**: Break the monolithic beads-service.ts (1,395 lines) into 4 single-responsibility modules under backend/src/services/beads/. Zero breaking changes to routes or consumers.

## Epics

### Setup: Create module scaffolding and shared types
- **Type**: epic
- **Priority**: 1
- **Description**: Create the beads/ directory structure and extract shared type definitions as the foundation for all other phases.
- **Blocks**: US1, US2, US3, US4
- **Tasks**: 2

### US1: Repository Module — CLI Access Isolation
- **Type**: epic
- **Priority**: 1
- **Description**: Move all bd CLI calls into beads-repository.ts. Prefix map, multi-DB orchestration, event emission, and CRUD operations. Only this module imports from bd-client.
- **MVP**: true
- **Blocks**: US4
- **Tasks**: 5

### US2: Filter and Sorter Modules — Pure Functions
- **Type**: epic
- **Priority**: 2
- **Description**: Extract status/type/wisp filtering, deduplication, and sort comparators into pure-function modules with no CLI or I/O dependencies.
- **Blocks**: US4
- **Tasks**: 4

### US3: Dependency Module — Graph and Epic Logic
- **Type**: epic
- **Priority**: 2
- **Description**: Extract graph construction, edge deduplication, epic children, epic progress, and auto-complete logic into beads-dependency.ts.
- **Blocks**: US4
- **Tasks**: 4

### US4: Barrel Index and Consumer Updates
- **Type**: epic
- **Priority**: 3
- **Description**: Create barrel index.ts with composed high-level functions, update all consumer imports from beads-service to beads.
- **Depends**: US1, US2, US3
- **Blocks**: Polish
- **Tasks**: 6

### Polish: Cleanup and Verification
- **Type**: epic
- **Priority**: 4
- **Description**: Remove original beads-service.ts, verify all tests pass, verify no stale references or constraint violations remain.
- **Depends**: US4
- **Tasks**: 5

## Tasks

### Setup

| Title | Path |
|-------|------|
| Create beads directory and types module | backend/src/services/beads/types.ts |
| Write tests for type re-exports | backend/tests/unit/beads/types.test.ts |

### US1: Repository Module

| Title | Path |
|-------|------|
| Write repository unit tests | backend/tests/unit/beads/beads-repository.test.ts |
| Extract getBead, updateBead, updateBeadStatus | backend/src/services/beads/beads-repository.ts |
| Extract listBeadSources and prefix map functions | backend/src/services/beads/beads-repository.ts |
| Extract extractRig, prefixToSource, multi-DB helpers | backend/src/services/beads/beads-repository.ts |
| Extract raw list/fetch functions (single-DB and multi-DB) | backend/src/services/beads/beads-repository.ts |

### US2: Filter and Sorter Modules

| Title | Path |
|-------|------|
| Write filter unit tests | backend/tests/unit/beads/beads-filter.test.ts |
| Extract status filtering, wisp exclusion, deduplication | backend/src/services/beads/beads-filter.ts |
| Write sorter unit tests | backend/tests/unit/beads/beads-sorter.test.ts |
| Extract sort comparators | backend/src/services/beads/beads-sorter.ts |

### US3: Dependency Module

| Title | Path |
|-------|------|
| Write dependency unit tests | backend/tests/unit/beads/beads-dependency.test.ts |
| Extract edge extraction, deduplication, graph building | backend/src/services/beads/beads-dependency.ts |
| Extract getEpicChildren, isBeadEpic, autoCompleteEpics | backend/src/services/beads/beads-dependency.ts |
| Extract computeEpicProgress, getRecentlyCompletedEpics | backend/src/services/beads/beads-dependency.ts |

### US4: Barrel Index and Consumer Updates

| Title | Path |
|-------|------|
| Create barrel index.ts with composed functions | backend/src/services/beads/index.ts |
| Update route handler imports | backend/src/routes/beads.ts |
| Update project route imports | backend/src/routes/projects.ts |
| Update beads-service test imports | backend/tests/unit/beads-service.test.ts |
| Update beads-graph test imports | backend/tests/unit/beads-graph.test.ts |
| Update any remaining backend imports | backend/src/index.ts |

### Polish

| Title | Path |
|-------|------|
| Delete original beads-service.ts | backend/src/services/beads-service.ts |
| Verify all 87+ existing tests pass | - |
| Verify no file imports from beads-service | - |
| Verify only beads-repository.ts imports from bd-client | - |
| Verify no module in beads/ exceeds 400 lines | - |

## Summary

| Phase | Tasks | Priority |
|-------|-------|----------|
| Setup | 2 | 1 |
| US1: Repository (MVP) | 5 | 1 |
| US2: Filter & Sorter | 4 | 2 |
| US3: Dependency | 4 | 2 |
| US4: Barrel & Consumers | 6 | 3 |
| Polish | 5 | 4 |
| **Total** | **26** | |

## MVP Scope

- Setup: 2 tasks
- US1 (Repository): 5 tasks
- **Total MVP**: 7 tasks

## Notes

- Constitution requires TDD: write tests before implementation (Phases 2-4 have test tasks first)
- Constitution requires TypeScript strict mode: all new modules must compile under strict
- Constitution requires JSDoc on public functions: preserve existing docs when moving code
- Phases 2, 3, 4 can run in parallel after Phase 1 (ideal for multi-agent execution)
- Phase 5 (US4) is a serial bottleneck — requires all sub-modules to exist
- Phase 6 (Polish) is the verification gate — do not close root epic until all checks pass
