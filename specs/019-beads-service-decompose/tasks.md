# Tasks: Decompose beads-service.ts into Focused Modules

**Feature**: 019-beads-service-decompose
**Branch**: `019-beads-service-decompose`
**Generated**: 2026-02-25

## Phases

### Phase 1: Setup — Create module scaffolding and shared types
*Purpose: Create the beads/ directory structure and extract shared type definitions. This is the foundation all other phases build on.*

- [ ] T001 [US1] Create beads directory and types module in backend/src/services/beads/types.ts
- [ ] T002 [US1] Write tests for type re-exports in backend/tests/unit/beads/types.test.ts

### Phase 2: US1 — Extract repository module (CLI access isolation)
*Purpose: Move all bd CLI calls into beads-repository.ts. Prefix map, multi-DB orchestration, event emission, and CRUD operations.*

- [ ] T003 [US1] Write repository unit tests in backend/tests/unit/beads/beads-repository.test.ts
- [ ] T004 [US1] Extract getBead, updateBead, updateBeadStatus to beads-repository.ts in backend/src/services/beads/beads-repository.ts
- [ ] T005 [US1] Extract listBeadSources, prefix map functions to beads-repository.ts in backend/src/services/beads/beads-repository.ts
- [ ] T006 [US1] Extract extractRig, prefixToSource, multi-DB helpers to beads-repository.ts in backend/src/services/beads/beads-repository.ts
- [ ] T007 [US1] Extract raw list/fetch functions (single-DB and multi-DB) to beads-repository.ts in backend/src/services/beads/beads-repository.ts

### Phase 3: US2 — Extract filter and sorter modules (pure functions)
*Purpose: Move all filtering logic (status, type, wisp, dedup) and sorting logic into dedicated pure-function modules.*

- [ ] T008 [P] [US2] Write filter unit tests in backend/tests/unit/beads/beads-filter.test.ts
- [ ] T009 [P] [US2] Extract status filtering, wisp exclusion, deduplication to beads-filter.ts in backend/src/services/beads/beads-filter.ts
- [ ] T010 [P] [US2] Write sorter unit tests in backend/tests/unit/beads/beads-sorter.test.ts
- [ ] T011 [P] [US2] Extract sort comparators to beads-sorter.ts in backend/src/services/beads/beads-sorter.ts

### Phase 4: US3 — Extract dependency module (graph and epic logic)
*Purpose: Move graph construction, edge extraction/dedup, epic progress, epic children, and auto-complete into beads-dependency.ts.*

- [ ] T012 [US3] Write dependency unit tests in backend/tests/unit/beads/beads-dependency.test.ts
- [ ] T013 [US3] Extract edge extraction, deduplication, graph building to beads-dependency.ts in backend/src/services/beads/beads-dependency.ts
- [ ] T014 [US3] Extract getEpicChildren, isBeadEpic, autoCompleteEpics to beads-dependency.ts in backend/src/services/beads/beads-dependency.ts
- [ ] T015 [US3] Extract computeEpicProgress, getRecentlyCompletedEpics to beads-dependency.ts in backend/src/services/beads/beads-dependency.ts

### Phase 5: US4 — Compose barrel index and update consumers
*Purpose: Create the barrel index.ts with composed high-level functions, update all imports, delete the original file.*

- [ ] T016 [US4] Create barrel index.ts with composed functions in backend/src/services/beads/index.ts
- [ ] T017 [US4] Update route handler imports from beads-service to beads in backend/src/routes/beads.ts
- [ ] T018 [US4] Update route handler imports in backend/src/routes/projects.ts
- [ ] T019 [US4] Update existing test imports from beads-service to beads in backend/tests/unit/beads-service.test.ts
- [ ] T020 [US4] Update existing test imports in backend/tests/unit/beads-graph.test.ts
- [ ] T021 [US4] Update any remaining imports across backend in backend/src/index.ts

### Phase 6: Polish — Cleanup and verification
*Purpose: Remove the original file, verify all tests pass, verify no stale references remain.*

- [ ] T022 Delete original beads-service.ts in backend/src/services/beads-service.ts
- [ ] T023 Verify all 87+ existing tests pass without logic changes
- [ ] T024 Verify no file imports from beads-service (grep check)
- [ ] T025 Verify only beads-repository.ts imports from bd-client within beads/
- [ ] T026 Verify no module in beads/ exceeds 400 lines

## Dependencies

- Phase 2 depends on Phase 1 (types must exist before repository can import them)
- Phase 3 depends on Phase 1 (types must exist before filter/sorter can import them)
- Phase 4 depends on Phase 1 (types must exist before dependency module can import them)
- Phase 5 depends on Phases 2, 3, 4 (all sub-modules must exist before barrel can compose them)
- Phase 6 depends on Phase 5 (all imports updated before deleting original)
- Phases 2, 3, 4 can run in parallel after Phase 1 completes
