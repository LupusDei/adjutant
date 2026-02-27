# Implementation Plan: Decompose beads-repository.ts

**Branch**: `021-beads-repository-decompose` | **Date**: 2026-02-25
**Epic**: `adj-022` | **Priority**: P1

## Summary

Split the 1,738-line `backend/src/services/beads/beads-repository.ts` into 7 focused modules under the same directory, eliminating ~500 lines of inline duplication by using existing pure helpers. Unify the duplicated `autoCompleteEpics` between repository and MCP tools. All consumers import from the barrel — zero breaking changes.

## Bead Map

- `adj-022` - Root: Decompose beads-repository.ts god object
  - `adj-022.1` - Foundational: Extract prefix-map and transform modules
    - `adj-022.1.1` - Extract beads-prefix-map module
    - `adj-022.1.2` - Extract beads-transform module
  - `adj-022.2` - Core: Extract database, epics, and mutations modules
    - `adj-022.2.1` - Extract beads-database module
    - `adj-022.2.2` - Extract beads-epics module
    - `adj-022.2.3` - Extract beads-mutations module
  - `adj-022.3` - Queries: Extract query and project modules
    - `adj-022.3.1` - Extract beads-queries module
    - `adj-022.3.2` - Extract beads-project module
  - `adj-022.4` - Cleanup: Update barrel, tests, delete original, unify MCP
    - `adj-022.4.1` - Update barrel and test imports
    - `adj-022.4.2` - Delete beads-repository.ts and unify MCP autoCompleteEpics

## Technical Context

**Stack**: TypeScript 5.x (strict mode), Node.js, ESM (.js extensions in imports)
**Testing**: Vitest (backend/tests/unit/beads/)
**Constraints**: Build must pass after every step. No circular deps. Barrel remains sole public API.

## Architecture Decision

The existing decomposition (019) extracted pure functions into filter/sorter/dependency modules but left all I/O in a single 1,738-line file. This next phase splits the I/O functions by domain while making them USE the existing pure helpers instead of duplicating them inline.

New modules import `execBd` directly where needed (beads-database for fetching, beads-mutations for writing, beads-epics and beads-project for `bd show` calls). The "single CLI gateway" constraint from 019 is relaxed — the new constraint is that each module has a clear domain boundary and no function duplication.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/beads/beads-prefix-map.ts` | **NEW** — prefix map state, lifecycle, helpers |
| `backend/src/services/beads/beads-transform.ts` | **NEW** — extractRig, transformBead |
| `backend/src/services/beads/beads-database.ts` | **NEW** — resolveBeadDatabase, fetch*, buildDatabaseList, listBeadSources |
| `backend/src/services/beads/beads-epics.ts` | **NEW** — isBeadEpic, getEpicChildren, listEpicsWithProgress |
| `backend/src/services/beads/beads-mutations.ts` | **NEW** — autoCompleteEpics, updateBead, updateBeadStatus |
| `backend/src/services/beads/beads-queries.ts` | **NEW** — listBeads, listAllBeads, listRecentlyClosed, getBeadsGraph |
| `backend/src/services/beads/beads-project.ts` | **NEW** — getProjectOverview, computeEpicProgress, getRecentlyCompletedEpics |
| `backend/src/services/beads/index.ts` | **MODIFIED** — re-export from new modules |
| `backend/src/services/mcp-tools/beads.ts` | **MODIFIED** — import autoCompleteEpics from barrel |
| `backend/tests/unit/beads/beads-repository.test.ts` | **MODIFIED** — import from barrel |
| `backend/src/services/beads/beads-repository.ts` | **DELETED** |

## Phase 1: Foundational — Extract prefix-map and transform

These modules have no dependency on other new modules. They must exist first because all other modules import from them.

- `beads-prefix-map.ts`: Owns the module-level mutable state (`prefixToSourceMap`, scheduler interval). Exports `prefixToSource`, `ensurePrefixMap`, `loadPrefixMap` for sibling use.
- `beads-transform.ts`: `extractRig` + `transformBead`. Imports `prefixToSource` from prefix-map.

## Phase 2: Core — Extract database, epics, and mutations

These modules have sequential dependencies: database first, then epics (uses resolveBeadDatabase), then mutations (uses both resolveBeadDatabase and isBeadEpic).

- `beads-database.ts`: Encapsulates database resolution and raw fetching. New `buildDatabaseList(rig?)` helper replaces 3 repeated multi-db aggregation patterns. Replace inline wisp filter with `excludeWisps()`, inline parseStatusFilter with import from beads-filter.
- `beads-epics.ts`: Replace inline db resolution in `getEpicChildren` with `resolveBeadDatabase()`. Replace inline wisp+sort with `processEpicChildren()` from beads-dependency. Replace inline sort in `listEpicsWithProgress` with `sortByUpdatedAtDesc()`.
- `beads-mutations.ts`: Make `autoCompleteEpics` params optional. Uses `resolveBeadDatabase` and `isBeadEpic`.

## Phase 3: Queries — Extract query and project modules

These modules depend on Phase 1 + 2 modules but not on each other (can be parallel).

- `beads-queries.ts`: Replace ALL inline dedup/sort/filter/assignee/prefix/limit with pure helper imports. Use `buildDatabaseList()`.
- `beads-project.ts`: Replace inline duplicates with `excludeWisps()`, `computeEpicProgressFromDeps()`, `transformClosedEpics()`.

## Phase 4: Cleanup — Update barrel, tests, delete original, unify MCP

- Update `index.ts` barrel to re-export from new modules.
- Update test imports from `beads-repository.js` to `index.js`.
- Remove `_parseStatusFilter` test alias (redundant with beads-filter.test.ts).
- Delete `beads-repository.ts`.
- In mcp-tools/beads.ts: remove local `autoCompleteEpics`, import from barrel.

## Parallel Execution

- Phase 1 tasks are sequential (transform depends on prefix-map)
- Phase 2: database first, then epics and mutations can be sequential
- Phase 3: queries and project are independent — can run in parallel
- Phase 4: must run after all others

## Verification Steps

- [ ] `npm run build` passes after every new module
- [ ] `npm test` passes after every step
- [ ] `grep -r "beads-repository" backend/src/` returns nothing after cleanup
- [ ] No inline dedup/wisp/sort patterns in new modules
- [ ] `bd show adj-022` shows all sub-epics wired
