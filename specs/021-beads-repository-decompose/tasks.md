# Tasks: Decompose beads-repository.ts

**Input**: Design documents from `/specs/021-beads-repository-decompose/`
**Epic**: `adj-022`

## Format: `[ID] [P?] [Story] Description`

- **T-IDs** (T001, T002): Sequential authoring IDs for this document
- **Bead IDs** (adj-022.N.M): Assigned in beads-import.md after bead creation
- **[P]**: Can run in parallel (different files, no deps)
- **[Story]**: User story label (US1=zero breaking changes, US2=eliminate duplication, US3=unify MCP)

## Phase 1: Foundational — Prefix Map & Transform

**Purpose**: Extract the foundational modules that all other new modules depend on

- [ ] T001 [US1] Extract beads-prefix-map module from beads-repository.ts in `backend/src/services/beads/beads-prefix-map.ts`
  - Move: prefixToSourceMap state, prefixMapRefreshIntervalId, DEFAULT_PREFIX_MAP_REFRESH_INTERVAL_MS
  - Move private: readPrefixFromConfig, buildPrefixMap, loadPrefixMap, ensurePrefixMap
  - Move public: prefixToSource, refreshPrefixMap, startPrefixMapRefreshScheduler, stopPrefixMapRefreshScheduler
  - Move test exports: _prefixToSource, _resetPrefixMap
  - Import: readFileSync/join, listAllBeadsDirs from workspace, logInfo
  - Export loadPrefixMap + ensurePrefixMap + prefixToSource for sibling modules
  - ~130 lines

- [ ] T002 [US1] Extract beads-transform module from beads-repository.ts in `backend/src/services/beads/beads-transform.ts`
  - Move: extractRig(assignee), transformBead(issue, _dbSource)
  - Move test export: _extractRig
  - Import: prefixToSource from beads-prefix-map, types from types.ts
  - ~60 lines

**Checkpoint**: Foundational modules exist and build passes. beads-repository.ts still has its own copies (temporary duplication OK).

---

## Phase 2: Core — Database, Epics, Mutations

**Purpose**: Extract modules that handle database routing, epic operations, and write operations

- [ ] T003 [US1] [US2] Extract beads-database module from beads-repository.ts in `backend/src/services/beads/beads-database.ts`
  - Move: resolveBeadDatabase(beadId)
  - Move: fetchBeadsFromDatabase(...) — replace inline wisp filter (lines 278-283) with excludeWisps() from beads-filter, use parseStatusFilter from beads-filter (not the duplicate)
  - Move: fetchGraphBeadsFromDatabase(...) — replace inline wisp filter (lines 336-340) with excludeWisps()
  - Move: listBeadSources()
  - NEW: buildDatabaseList(rig?) — extract from 3 repeated patterns (listAllBeads:870-884, listRecentlyClosed:1247-1259, getBeadsGraph:1603-1638)
  - Import: execBd/resolveBeadsDir from bd-client, workspace, prefix-map, transform, beads-filter
  - ~220 lines

- [ ] T004 [US1] [US2] Extract beads-epics module from beads-repository.ts in `backend/src/services/beads/beads-epics.ts`
  - Move: isBeadEpic(beadId, dbInfo?) — use resolveBeadDatabase from beads-database
  - Move: getEpicChildren(epicId) — replace inline db resolution (lines 997-1026) with resolveBeadDatabase(), replace inline wisp+sort with processEpicChildren() from beads-dependency
  - Move: listEpicsWithProgress(options?) — replace inline db mapping (lines 1119-1135) with resolveBeadDatabase(), replace inline sort (lines 1202-1206) with sortByUpdatedAtDesc(), replace inline progress (lines 1184-1190) with buildEpicWithChildren()
  - Import: execBd from bd-client, resolveBeadDatabase from beads-database, prefix-map, transform, beads-filter, beads-sorter, beads-dependency
  - ~200 lines

- [ ] T005 [US1] [US2] Extract beads-mutations module from beads-repository.ts in `backend/src/services/beads/beads-mutations.ts`
  - Move: autoCompleteEpics(workDir?, beadsDir?) — make params optional (default to resolveWorkspaceRoot() + resolveBeadsDir())
  - Move: updateBead(beadId, options) — use resolveBeadDatabase from beads-database, isBeadEpic from beads-epics
  - Move: updateBeadStatus(beadId, status) — thin wrapper
  - Import: execBd from bd-client, event-bus, resolveBeadDatabase from beads-database, isBeadEpic from beads-epics
  - ~170 lines

**Checkpoint**: All core modules exist. Build passes.

---

## Phase 3: Queries — Query & Project Modules

**Purpose**: Extract the remaining read-only query orchestration functions

- [ ] T006 [P] [US1] [US2] Extract beads-queries module from beads-repository.ts in `backend/src/services/beads/beads-queries.ts`
  - Move: listBeads(options?) — replace inline sort with sortByPriorityThenDate(), assignee filter with filterByAssignee(), limit with applyLimit()
  - Move: listAllBeads(options?) — use buildDatabaseList(), replace inline dedup with deduplicateById(), sort with sortByPriorityThenDate(), assignee with filterByAssignee(), prefix exclusion with excludePrefixes(), limit with applyLimit()
  - Move: listRecentlyClosed(hours?) — use buildDatabaseList(), replace inline dedup with deduplicateById(), wisp with excludeWisps(), sort with sortByClosedAtDesc()
  - Move: getBeadsGraph(options?) — use buildDatabaseList(), replace inline dedup with deduplicateById(), edge extraction with extractGraphEdges(), node building with buildGraphNodes()
  - Import: beads-database (fetchBeadsFromDatabase, fetchGraphBeadsFromDatabase, buildDatabaseList), beads-filter, beads-sorter, beads-dependency, prefix-map, transform
  - ~280 lines

- [ ] T007 [P] [US1] [US2] Extract beads-project module from beads-repository.ts in `backend/src/services/beads/beads-project.ts`
  - Move: getProjectOverview(projectPath) — replace inline filterWisps (lines 1372-1373) with excludeWisps()
  - Move: computeEpicProgress(projectPath) — replace inline progress (lines 1488-1495) with computeEpicProgressFromDeps()
  - Move: getRecentlyCompletedEpics(projectPath, limit?) — replace inline transform (lines 1546-1562) with transformClosedEpics()
  - Import: execBd/resolveBeadsDir from bd-client, transform, beads-filter, beads-dependency
  - ~190 lines

**Checkpoint**: All 7 new modules exist. Build passes. beads-repository.ts still exists but is now dead code.

---

## Phase 4: Cleanup — Barrel, Tests, Delete, Unify

**Purpose**: Switch over to new modules, delete the original, and unify MCP

- [ ] T008 [US1] Update barrel index.ts and test imports in `backend/src/services/beads/index.ts` and `backend/tests/unit/beads/beads-repository.test.ts`
  - Update index.ts: change all re-exports from beads-repository.js to new module files (beads-prefix-map, beads-transform, beads-database, beads-epics, beads-mutations, beads-queries, beads-project)
  - Remove _parseStatusFilter from barrel (redundant with beads-filter.ts)
  - Update beads-repository.test.ts: change import from beads-repository.js to index.js
  - Remove _parseStatusFilter tests from repository test (already in beads-filter.test.ts)
  - Verify: npm run build && npm test

- [ ] T009 [US1] [US3] Delete beads-repository.ts and unify MCP autoCompleteEpics in `backend/src/services/beads/beads-repository.ts` and `backend/src/services/mcp-tools/beads.ts`
  - Delete backend/src/services/beads/beads-repository.ts
  - In mcp-tools/beads.ts: remove local autoCompleteEpics function (lines 69-84), import autoCompleteEpics from ../beads/index.js, call with no args
  - Verify: grep -r "beads-repository" backend/src/ returns nothing
  - Verify: npm run build && npm test

---

## Dependencies

- Phase 1 → Phase 2 (T003-T005 depend on T001-T002)
- T004 depends on T003 (epics imports resolveBeadDatabase from database)
- T005 depends on T003 + T004 (mutations imports from database + epics)
- Phase 2 → Phase 3 (T006-T007 depend on T003)
- T006 [P] and T007 [P] can run in parallel (different files, no deps)
- Phase 3 → Phase 4 (T008-T009 depend on all above)
- T009 depends on T008 (must update barrel before deleting old file)

## Parallel Opportunities

- T006 and T007 (Phase 3) can run simultaneously — they write to different files with no shared dependencies
- After Phase 1, Phases 2-3 tasks are mostly sequential due to import chains
