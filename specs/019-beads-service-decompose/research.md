# Research: Decompose beads-service.ts

**Feature**: 019-beads-service-decompose
**Date**: 2026-02-25

## Decision 1: Module Boundary Strategy

**Decision**: Split by logical responsibility (repository, filter, dependency, sorter) rather than by entity or by route.

**Rationale**: The existing code already has implicit clusters:
- Lines ~1-200: Imports, types, prefix map management, utility functions
- Lines ~200-500: CRUD operations (listBeads, getBead, updateBead) that call execBd
- Lines ~500-800: Filtering logic (status presets, wisp exclusion, deduplication)
- Lines ~800-1200: Dependency graph logic (getBeadsGraph, getEpicChildren, listEpicsWithProgress, computeEpicProgress, autoCompleteEpics)
- Lines ~1200-1395: Sorting and source listing

**Alternatives considered**:
- *Split by entity (beads vs epics)*: Rejected — epic logic depends heavily on the same bead data structures, creating circular dependencies
- *Split by route handler*: Rejected — many route handlers compose multiple responsibilities (e.g., listBeads uses repository + filter + sort)
- *Extract only graph logic*: Rejected — addresses the immediate pain point but leaves an 1,100-line monolith

## Decision 2: Barrel Re-export Strategy

**Decision**: The `index.ts` barrel file re-exports everything from all sub-modules and also contains the composed high-level functions (like `listBeads` which orchestrates repository + filter + sort).

**Rationale**: Consumers currently import `{ listBeads, getBead, ... } from '../services/beads-service'`. The barrel at `backend/src/services/beads/index.ts` must be importable as `'../services/beads'` (Node resolves index.ts automatically). This preserves all existing import paths with a single search-and-replace from `beads-service` → `beads`.

**Alternatives considered**:
- *Keep beads-service.ts as a thin façade*: Rejected — adds an unnecessary layer. The barrel index.ts serves the same purpose without the extra file.
- *Update all import paths individually*: Rejected — high effort, high risk. The barrel approach requires only updating the import source, not the imported names.

## Decision 3: Prefix Map Singleton Placement

**Decision**: Place the prefix map cache, scheduler, and refresh logic in `beads-repository.ts` since it's fundamentally about mapping bead IDs to their source databases (a data access concern).

**Rationale**: The prefix map is used exclusively for resolving which database to query for a given bead ID. It reads config files from rig directories — this is I/O that belongs in the repository layer. Other modules consume the source field on BeadInfo objects but don't need to know how it was resolved.

**Alternatives considered**:
- *Separate prefix-map.ts module*: Rejected — over-splitting. The prefix map is tightly coupled to the repository's multi-database orchestration.
- *Place in types.ts or index.ts*: Rejected — these should be pure declarations/re-exports, not contain I/O or scheduling logic.

## Decision 4: Event Bus Placement

**Decision**: Event emissions (`bead:closed`, `bead:updated`) remain in the repository module where state-changing CLI commands execute.

**Rationale**: Events fire after `bd update` or `bd close` succeeds. The repository is the only module that knows when a CLI write operation succeeded, making it the natural place for event emission.

## Decision 5: Type Definitions Placement

**Decision**: Extract shared types (BeadInfo, BeadDetail, BeadStatus, options interfaces, result types) into `beads/types.ts`.

**Rationale**: Multiple sub-modules need these types. Placing them in a dedicated types file avoids circular imports between modules and follows the existing project pattern (types/ directories elsewhere in the codebase).

**Alternatives considered**:
- *Keep types in each module*: Rejected — would create duplicate or circular type definitions
- *Use existing backend/src/types/beads.ts*: That file only contains graph-specific Zod schemas. The service-level types (BeadInfo, BeadDetail, etc.) are different and more numerous.

## Decision 6: Test Migration Strategy

**Decision**: Create new per-module test files in `backend/tests/unit/beads/`. Update import paths in existing test files but do not change test logic.

**Rationale**: Existing tests validate end-to-end behavior through the service interface. They should continue to work by importing from the new barrel. New per-module tests validate each sub-module in isolation (filter functions without CLI mocks, sorting without any mocks, etc.).

**Alternatives considered**:
- *Move existing tests into per-module files*: Rejected — existing tests test composed behavior (repository + filter + sort together). Splitting them would require rewriting test setup, violating the "no logic changes" constraint.
- *Only keep existing tests*: Rejected — misses the opportunity for focused unit tests on pure functions.
