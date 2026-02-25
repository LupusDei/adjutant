# Feature Specification: Decompose beads-service.ts into Focused Modules

**Feature Branch**: `019-beads-service-decompose`
**Created**: 2026-02-25
**Status**: Draft
**Input**: Decompose the monolithic beads-service.ts (1,395 lines) into 4-5 single-responsibility modules under backend/src/services/beads/

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Zero Breaking Changes After Decomposition (Priority: P1)

A developer working on the Adjutant codebase imports beads service functions from the existing module path. After the decomposition, all existing imports and function signatures continue to work identically — no route handler, test file, or consuming module requires any change.

**Why this priority**: If the refactoring breaks existing functionality, it provides negative value. This is the foundational constraint.

**Independent Test**: Run the full existing test suite (87+ tests across beads-service.test.ts, beads-graph.test.ts, beads-graph-route.test.ts, beads-routes.test.ts) and verify all pass without modification. Build succeeds. All API endpoints return identical responses.

**Acceptance Scenarios**:

1. **Given** the existing beads-service test suite, **When** the decomposition is complete, **Then** all 87+ existing tests pass without modification
2. **Given** route handlers importing from beads-service, **When** the module is decomposed, **Then** existing import paths continue to resolve correctly via re-exports
3. **Given** the application build pipeline, **When** the decomposed modules are compiled, **Then** the build succeeds with zero new type errors

---

### User Story 2 - Repository Module Isolates CLI Access (Priority: P1)

All direct `bd` CLI calls (via BdClient/execBd) are consolidated into a single repository module. No other module in the beads service directory directly invokes the CLI. This makes it possible to mock CLI access at a single point for testing.

**Why this priority**: The repository boundary is the foundation that all other modules depend on. It must exist before filtering, dependency, or sorting logic can be independently tested.

**Independent Test**: Verify that only beads-repository.ts imports from bd-client. All other beads modules import from beads-repository for data access. New unit tests for the repository module pass with bd-client mocked.

**Acceptance Scenarios**:

1. **Given** the beads-repository module, **When** a developer searches for `execBd` or `bd-client` imports, **Then** only beads-repository.ts contains them (within the beads/ directory)
2. **Given** a test for the filtering module, **When** the test runs, **Then** it can mock the repository layer without knowing about the `bd` CLI
3. **Given** the repository module, **When** it lists beads from a single database, **Then** it correctly invokes `bd list` with the appropriate flags and transforms raw CLI output into typed BeadInfo objects

---

### User Story 3 - Filtering Logic is Independently Testable (Priority: P2)

Status filtering (default/all/custom presets), type filtering, assignee filtering, wisp exclusion, and multi-database deduplication logic live in a dedicated filtering module. A developer can write fast unit tests for filtering without mocking the CLI.

**Why this priority**: Filtering is the most frequently modified logic as new statuses and filter presets are added. Isolating it reduces the blast radius of filter changes.

**Independent Test**: Create unit tests that pass arrays of BeadInfo objects through filter functions and verify correct output without any CLI mocking.

**Acceptance Scenarios**:

1. **Given** a list of beads with mixed statuses, **When** the "default" filter is applied, **Then** only open, hooked, in_progress, and blocked beads are returned
2. **Given** a list of beads including wisps, **When** wisp filtering is applied, **Then** beads with the wisp flag or `-wisp-` in their ID are excluded
3. **Given** beads from multiple databases with duplicate IDs, **When** deduplication runs, **Then** exactly one copy of each bead is retained

---

### User Story 4 - Dependency Graph Logic is Independently Testable (Priority: P2)

Dependency graph construction, edge deduplication, epic children queries, epic progress computation, and auto-complete logic live in a dedicated dependency module. This logic can be tested with pure data inputs.

**Why this priority**: The dependency graph is the most complex logic in the service and the most likely to need extension (e.g., new graph algorithms, transitive dependency queries). Isolation makes it safer to evolve.

**Independent Test**: Create unit tests that pass arrays of nodes and edges to dependency functions and verify correct graph output, deduplication, and progress computation.

**Acceptance Scenarios**:

1. **Given** raw bead data with dependency arrays, **When** graph edges are extracted, **Then** duplicate edges are eliminated using `issueId->dependsOnId` keys
2. **Given** an epic with 5 child tasks (3 closed, 2 open), **When** progress is computed, **Then** the result shows 60% completion
3. **Given** an epic where all children are closed, **When** auto-complete eligibility is checked, **Then** the epic is identified as eligible for closure

---

### User Story 5 - Sorting Logic is Independently Testable (Priority: P3)

Bead ordering logic (by priority, date, assignee, status) is extracted into a dedicated sorting module with pure functions that take arrays and return sorted arrays.

**Why this priority**: Sorting is the simplest and most stable logic. Extracting it improves clarity but has lower impact than repository, filter, or dependency extraction.

**Independent Test**: Pass unsorted bead arrays to sorting functions and verify correct ordering.

**Acceptance Scenarios**:

1. **Given** beads with priorities 4, 0, 2, 1, **When** sorted by priority, **Then** the order is 0, 1, 2, 4 (lower = higher priority)
2. **Given** beads with various statuses, **When** sorted by status, **Then** in-progress beads appear before open beads, which appear before closed beads

---

### Edge Cases

- What happens when a consuming module imports a function that was moved to a sub-module? The barrel index.ts must re-export everything.
- What happens when the prefix map scheduler (a singleton with side effects) is decomposed? It must remain a module-level singleton, not duplicated across sub-modules.
- How does the event bus integration (bead:closed, bead:updated events) work after decomposition? Events should be emitted from the repository layer where state changes occur.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST create a `backend/src/services/beads/` directory with sub-modules that collectively replace the monolithic beads-service.ts
- **FR-002**: System MUST provide a `backend/src/services/beads/index.ts` barrel file that re-exports all public functions, preserving the existing import API
- **FR-003**: The repository module MUST be the sole module that imports from bd-client within the beads directory
- **FR-004**: The filter module MUST export pure functions that accept bead arrays and return filtered arrays, with no CLI or I/O dependencies
- **FR-005**: The dependency module MUST consolidate graph construction, edge deduplication, epic children queries, epic progress computation, and auto-complete eligibility logic
- **FR-006**: The sorter module MUST export pure functions that accept bead arrays and return sorted arrays
- **FR-007**: All existing route handlers MUST continue to work without modification after decomposition
- **FR-008**: All existing tests (87+) MUST pass after decomposition with only import path updates (no logic changes)
- **FR-009**: The prefix map singleton (scheduler, cache, refresh) MUST remain a single instance — not duplicated across modules
- **FR-010**: Event bus emissions (bead:closed, bead:updated) MUST continue to fire from the appropriate module after decomposition
- **FR-011**: Each new sub-module MUST have its own focused unit test file under `backend/tests/unit/beads/`
- **FR-012**: The original `backend/src/services/beads-service.ts` MUST be removed after migration is complete (no dead code)

### Key Entities

- **BeadsRepository**: Wraps all bd CLI calls. Handles raw CLI invocation, JSON parsing, error translation, multi-database orchestration, and prefix map management.
- **BeadsFilter**: Pure functions for status filtering (default/all/custom), type filtering, assignee filtering, wisp exclusion, and cross-database deduplication.
- **BeadsDependency**: Graph construction from raw bead data, edge extraction and deduplication, epic children resolution, epic progress computation, and auto-complete eligibility.
- **BeadsSorter**: Ordering functions for priority, date, assignee, and status-based sorting.
- **BeadsService (index.ts)**: Barrel re-exports and composed high-level functions that orchestrate repository + filter + dependency + sorter to preserve the existing API surface.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 87+ existing beads tests pass after decomposition without logic changes
- **SC-002**: No file in `backend/src/services/beads/` exceeds 400 lines (each module is focused)
- **SC-003**: The build completes with zero new type errors or warnings
- **SC-004**: Each sub-module (repository, filter, dependency, sorter) has at least 5 dedicated unit tests
- **SC-005**: Only one file in `backend/src/services/beads/` imports from bd-client (the repository module)
- **SC-006**: The original beads-service.ts file is deleted with zero remaining references
- **SC-007**: All existing API endpoints return identical responses before and after decomposition
